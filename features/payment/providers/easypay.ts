/**
 * 支付功能模块 - 易支付兼容 Provider
 *
 * 来源：从 cf-shop 已跑通的 `src/services/payments/easypay.ts` 提炼到 cf-core。
 * 这里保留 cf-shop 的生产语义，只替换项目私有依赖：
 * - `md5Hex` 内置到本文件
 * - `payment-url` 的 HTTPS/本地回环校验内置到本文件
 * - `shared/money` 改用 cf-core payment currency 原语
 *
 * Provider 名称统一为 `easypay`。ZPay 是兼容易支付协议的网关实例，
 * 通过 `EASYPAY_API_BASE` 指向服务商地址，不单独定义 `zpay` provider。
 */

import type {
  CreatePaymentInput,
  CreatePaymentResult,
  CallbackResult,
  QueryStatusResult,
  PaymentProvider,
  ProviderFactory,
} from "../types.js";
import {
  formatProviderMajorAmount,
  parseProviderMajorAmount,
} from "../currency.js";

const EASYPAY_ENDPOINT_SUFFIXES = ["/submit.php", "/mapi.php", "/api.php"] as const;
const EASYPAY_SUPPORTED_CURRENCIES = ["CNY"] as const;
const EASYPAY_CURRENCY_EXPONENTS = { CNY: 2 } as const;
const EASY_PAY_PAY_TYPES = ["alipay", "wxpay", "qqpay"] as const;
const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const RETRY_DELAYS = [500, 1500] as const;

export type EasyPayPayType = typeof EASY_PAY_PAY_TYPES[number];
export type EasyPayProviderErrorKind = "deterministic" | "ambiguous";
export type EasyPayQueryStatusResult = QueryStatusResult;

export interface EasyPayConfig {
  /** 商户唯一标识（易支付服务商后台获取） */
  pid: string;
  /** 商户密钥（易支付服务商后台获取） */
  key: string;
  /** 易支付接口基础地址；不要在业务代码里直接拼用户输入的 submit.php/mapi.php/api.php */
  apiBase: string;
  /** 异步通知 URL；通常由路由层按当前域名生成并传入 createPayment */
  notifyUrl?: string;
  /** 支付完成跳转 URL */
  returnUrl?: string;
  /** 默认易支付 type 参数：alipay / wxpay / qqpay */
  payType?: string;
  /** 后台明确启用的易支付 type 列表；留空时兼容旧配置，仅启用默认收款方式 */
  enabledPayTypes?: string | string[];
}

export class EasyPayProviderError extends Error {
  readonly kind: EasyPayProviderErrorKind;
  readonly httpStatus?: number;
  readonly providerMessage?: string;

  constructor(
    kind: EasyPayProviderErrorKind,
    message: string,
    details: { httpStatus?: number; providerMessage?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "EasyPayProviderError";
    this.kind = kind;
    this.httpStatus = details.httpStatus;
    this.providerMessage = details.providerMessage;
    if (details.cause) {
      (this as Error & { cause?: unknown }).cause = details.cause;
    }
  }
}

export function isAmbiguousEasyPayProviderError(error: unknown): boolean {
  return error instanceof EasyPayProviderError && error.kind === "ambiguous";
}

/** Payment URLs must use TLS except for explicit loopback development endpoints. */
function normalizeSecurePaymentUrl(value: string | undefined): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const localHttp = url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(url.hostname);
    return url.protocol === "https:" || localHttp ? trimmed : "";
  } catch {
    return "";
  }
}

function isSecurePaymentUrl(value: unknown): boolean {
  return typeof value === "string" && normalizeSecurePaymentUrl(value) !== "";
}

async function fetchWithEasyPayRetry(
  url: string,
  options: RequestInit & { retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const maxRetries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 10_000;
  let lastError = "";

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, { ...options, signal: controller.signal });
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) return resp;
      if (!resp.ok && attempt <= maxRetries) {
        lastError = `HTTP ${resp.status}`;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1] ?? 1000));
        continue;
      }
      return resp;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt <= maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1] ?? 1000));
        continue;
      }
      throw new EasyPayProviderError(
        "ambiguous",
        `EasyPay 网络请求中断或超时：${lastError}`,
        { cause: err },
      );
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
  throw new EasyPayProviderError("ambiguous", `EasyPay 网络请求结果不确定：${lastError}`);
}

/** 构建易支付签名字符串：过滤 sign/sign_type/空值，按参数名升序拼接，不做 URL 编码。 */
export function buildSignString(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== "" && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = a || "";
  const right = b || "";
  const len = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    const ca = i < left.length ? left.charCodeAt(i) : 0;
    const cb = i < right.length ? right.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

function leftRotate(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift));
}

const MD5_S = [
  7, 12, 17, 22,
  5, 9, 14, 20,
  4, 11, 16, 23,
  6, 10, 15, 21,
] as const;

const MD5_T = Array.from(
  { length: 64 },
  (_value, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0,
);

function md5Hex(message: string): string {
  const input = new TextEncoder().encode(message);
  const bitLength = input.length * 8;
  const paddedLength = (((input.length + 8) >>> 6) + 1) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(input);
  buffer[input.length] = 0x80;

  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;

      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const m = view.getUint32(offset + g * 4, true);
      const rotate = MD5_S[Math.floor(i / 16) * 4 + (i % 4)];
      const temp = d;
      d = c;
      c = b;
      b = (b + leftRotate((a + f + MD5_T[i] + m) >>> 0, rotate)) >>> 0;
      a = temp;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0]
    .map((word) => word.toString(16).padStart(8, "0").match(/../g)?.reverse().join("") ?? "")
    .join("");
}

/** 验证易支付回调签名。保留 Promise 返回形状，兼容 cf-shop 调用习惯。 */
export async function verifyEasyPaySign(
  params: Record<string, string>,
  key: string,
): Promise<boolean> {
  const received = (params.sign || "").toLowerCase();
  if (!received) return false;
  const signStr = buildSignString(params);
  const calculated = md5Hex(signStr + key);
  return timingSafeEqualString(calculated, received);
}

/** 归一化易支付接口基础地址。 */
export function normalizeEasyPayApiBaseUrl(value: string | undefined): string {
  const secureUrl = normalizeSecurePaymentUrl(value);
  if (!secureUrl) return "";

  try {
    const parsed = new URL(secureUrl);
    parsed.search = "";
    parsed.hash = "";
    const rawPath = parsed.pathname.replace(/\/+$/, "");
    const lowerPath = rawPath.toLowerCase();
    const endpointSuffix = EASYPAY_ENDPOINT_SUFFIXES.find((suffix) => lowerPath.endsWith(suffix));
    const basePath = endpointSuffix
      ? rawPath.slice(0, rawPath.length - endpointSuffix.length).replace(/\/+$/, "")
      : rawPath;
    return `${parsed.origin}${basePath === "/" ? "" : basePath}`.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function buildEasyPaySubmitUrl(value: string | undefined): string {
  const baseUrl = normalizeEasyPayApiBaseUrl(value);
  return baseUrl ? `${baseUrl}/submit.php` : "";
}

export function buildEasyPayPaymentApiUrl(value: string | undefined): string {
  const baseUrl = normalizeEasyPayApiBaseUrl(value);
  return baseUrl ? `${baseUrl}/mapi.php` : "";
}

export function buildEasyPayQueryApiUrl(value: string | undefined): string {
  const baseUrl = normalizeEasyPayApiBaseUrl(value);
  return baseUrl ? `${baseUrl}/api.php` : "";
}

export function normalizeEasyPayPayType(value: unknown): EasyPayPayType {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "wxpay" || normalized === "qqpay" ? normalized : "alipay";
}

export function normalizeEasyPayEnabledPayTypes(value: unknown, fallback: unknown = "alipay"): EasyPayPayType[] {
  const fallbackPayType = normalizeEasyPayPayType(fallback);
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const enabled: EasyPayPayType[] = [];
  for (const raw of rawValues) {
    if (typeof raw !== "string") continue;
    const normalized = raw.trim().toLowerCase();
    if (!EASY_PAY_PAY_TYPES.includes(normalized as EasyPayPayType)) continue;
    if (!enabled.includes(normalized as EasyPayPayType)) enabled.push(normalized as EasyPayPayType);
  }
  return enabled.length > 0 ? enabled : [fallbackPayType];
}

export function easyPayPayTypeLabel(value: unknown): string {
  const payType = normalizeEasyPayPayType(value);
  if (payType === "wxpay") return "微信支付";
  if (payType === "qqpay") return "QQ 支付";
  return "支付宝";
}

function responseCodeIsSuccess(value: unknown): boolean {
  if (value === 1) return true;
  if (typeof value === "string") return value.trim() === "1";
  return false;
}

function statusIsPaid(value: unknown): boolean {
  if (value === 1) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toUpperCase();
  return normalized === "1" || normalized === "TRADE_SUCCESS" || normalized === "SUCCESS";
}

function moneyToCents(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  try {
    return parseProviderMajorAmount(String(value), "CNY", EASYPAY_SUPPORTED_CURRENCIES, EASYPAY_CURRENCY_EXPONENTS);
  } catch {
    return undefined;
  }
}

export class EasyPayProvider implements PaymentProvider {
  readonly name = "easypay";
  readonly displayName = "易支付";
  readonly supportedCurrencies = [...EASYPAY_SUPPORTED_CURRENCIES];
  readonly defaultPayType: EasyPayPayType;
  readonly enabledPayTypes: EasyPayPayType[];

  constructor(private readonly config: EasyPayConfig) {
    this.defaultPayType = normalizeEasyPayPayType(config.payType);
    this.enabledPayTypes = normalizeEasyPayEnabledPayTypes(config.enabledPayTypes, this.defaultPayType);
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const { pid, key, apiBase } = this.config;
    const amount = formatProviderMajorAmount(
      input.amountCents,
      input.currency,
      EASYPAY_SUPPORTED_CURRENCIES,
      EASYPAY_CURRENCY_EXPONENTS,
    );

    const requestedPayType = input.metadata?.payType
      ? normalizeEasyPayPayType(input.metadata.payType)
      : this.defaultPayType;
    if (!this.enabledPayTypes.includes(requestedPayType)) {
      throw new EasyPayProviderError(
        "deterministic",
        `EasyPay: ${easyPayPayTypeLabel(requestedPayType)}未在后台启用`,
        { providerMessage: "pay_type_disabled" },
      );
    }
    const payType = requestedPayType;

    const effectiveNotifyUrl = input.notifyUrl || this.config.notifyUrl || "";
    const effectiveReturnUrl = input.returnUrl || this.config.returnUrl || "";

    const params: Record<string, string> = {
      pid,
      type: payType,
      out_trade_no: input.orderNo,
      notify_url: effectiveNotifyUrl,
      return_url: effectiveReturnUrl,
      name: input.metadata?.subject || input.description || "商品购买",
      money: amount,
      device: payType === "alipay" ? "alipay" : payType === "wxpay" ? "wechat" : "pc",
      clientip: input.metadata?.clientIp || input.metadata?.clientip || "",
      param: input.orderNo,
      sign_type: "MD5",
    };

    params.sign = md5Hex(buildSignString(params) + key);

    const resp = await fetchWithEasyPayRetry(buildEasyPayPaymentApiUrl(apiBase), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      timeoutMs: 8_000,
      retries: 2,
    });

    if (!resp.ok) {
      const ambiguous = resp.status >= 500 || resp.status === 429;
      throw new EasyPayProviderError(
        ambiguous ? "ambiguous" : "deterministic",
        `EasyPay HTTP ${resp.status}`,
        { httpStatus: resp.status },
      );
    }

    type EasyPayCreateResponse = {
      code?: number | string;
      msg?: string;
      payurl?: string;
      qrcode?: string;
      img?: string;
      urlscheme?: string;
      trade_no?: string;
    };
    let data: EasyPayCreateResponse;
    try {
      data = await resp.json() as EasyPayCreateResponse;
    } catch (error) {
      throw new EasyPayProviderError("deterministic", "EasyPay 响应不是有效 JSON", { cause: error });
    }

    if (!responseCodeIsSuccess(data.code)) {
      throw new EasyPayProviderError(
        "deterministic",
        `EasyPay: ${data.msg || "unknown"}`,
        { providerMessage: data.msg || "unknown" },
      );
    }

    const qrcode = typeof data.qrcode === "string" ? data.qrcode.trim() : "";
    const img = typeof data.img === "string" ? data.img.trim() : "";

    return {
      providerTradeNo: data.trade_no || undefined,
      qrCode: img || qrcode,
      redirectUrl: data.payurl || data.urlscheme || "",
      raw: {
        ...data,
        payType,
        payTypeLabel: easyPayPayTypeLabel(payType),
        qrcode,
        img,
        qrContent: qrcode,
        qrImageUrl: img,
      },
    };
  }

  async verifyCallback(params: Record<string, string>): Promise<CallbackResult> {
    if (!(await verifyEasyPaySign(params, this.config.key))) {
      throw new Error("EasyPay signature invalid");
    }

    const tradeStatus = params.trade_status || params.status || "";
    if (tradeStatus !== "TRADE_SUCCESS" && tradeStatus !== "SUCCESS") {
      throw new Error(`Unexpected trade_status: ${tradeStatus}`);
    }

    const moneyStr = params.money || params.total_fee || "0";
    const amountCents = parseProviderMajorAmount(
      moneyStr,
      "CNY",
      EASYPAY_SUPPORTED_CURRENCIES,
      EASYPAY_CURRENCY_EXPONENTS,
    );
    const orderNo = params.out_trade_no || "";
    const providerTradeNo = params.trade_no?.trim() || "";
    if (!providerTradeNo) throw new Error("EasyPay callback missing trade_no");

    return {
      orderNo,
      providerTradeNo,
      amountCents,
      currency: "CNY",
      paidAt: params.time || params.endtime || new Date().toISOString(),
      raw: params,
    };
  }

  async queryStatus(outTradeNo: string): Promise<EasyPayQueryStatusResult> {
    const { pid, key, apiBase } = this.config;
    const queryUrl = `${buildEasyPayQueryApiUrl(apiBase)}?act=order&pid=${encodeURIComponent(pid)}&key=${encodeURIComponent(key)}&out_trade_no=${encodeURIComponent(outTradeNo)}`;

    const resp = await fetchWithEasyPayRetry(queryUrl, { method: "GET", timeoutMs: 3_000, retries: 0 });
    if (!resp.ok) return { paid: false };

    const data = await resp.json() as {
      code?: number | string;
      status?: number | string;
      trade_status?: string;
      trade_no?: string;
      money?: string;
      addtime?: string;
      endtime?: string;
      data?: {
        status?: number | string;
        trade_status?: string;
        trade_no?: string;
        money?: string;
        addtime?: string;
        endtime?: string;
      };
    };
    const nested = data.data || {};
    const paidByStatus = statusIsPaid(data.trade_status)
      || statusIsPaid(data.status)
      || statusIsPaid(nested.trade_status)
      || statusIsPaid(nested.status);
    return {
      paid: responseCodeIsSuccess(data.code) && paidByStatus,
      providerTradeNo: data.trade_no || nested.trade_no || undefined,
      providerCreatedAt: data.addtime || nested.addtime || undefined,
      paidAt: data.endtime || nested.endtime || undefined,
      amountCents: moneyToCents(data.money || nested.money),
      currency: "CNY",
    };
  }
}

export const easyPayFactory: ProviderFactory = {
  name: "easypay",
  priority: 40,
  isAvailable(env) {
    const apiBase = normalizeEasyPayApiBaseUrl(String(env.EASYPAY_API_BASE || ""));
    return !!(
      env.EASYPAY_PID
      && env.EASYPAY_KEY
      && apiBase
      && isSecurePaymentUrl(apiBase)
    );
  },
  create(env) {
    const apiBase = normalizeEasyPayApiBaseUrl(String(env.EASYPAY_API_BASE || ""));
    return new EasyPayProvider({
      pid: String(env.EASYPAY_PID),
      key: String(env.EASYPAY_KEY),
      apiBase,
      notifyUrl: "",
      returnUrl: normalizeSecurePaymentUrl(String(env.EASYPAY_RETURN_URL || "")),
      payType: normalizeEasyPayPayType(env.EASYPAY_PAY_TYPE),
      enabledPayTypes: normalizeEasyPayEnabledPayTypes(env.EASYPAY_ENABLED_PAY_TYPES, env.EASYPAY_PAY_TYPE),
    });
  },
};

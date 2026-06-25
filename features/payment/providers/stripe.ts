/**
 * 支付功能模块 — Stripe Provider
 *
 * 包含：
 * - Stripe Checkout Sessions（单次支付）
 * - Webhook 签名验证（HMAC-SHA256）
 * - stripeFactory 工厂
 */

import type {
  CreatePaymentInput,
  CreatePaymentResult,
  CallbackResult,
  QueryStatusResult,
  PaymentProvider,
  ProviderFactory,
} from "../types.js";
import { fetchWithRetry } from "../fetch-utils.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Stripe API 常量
// ═══════════════════════════════════════════════════════════════════════════════

const STRIPE_API_BASE = "https://api.stripe.com/v1";

/**
 * 验证 Stripe webhook 签名（HMAC-SHA256）。
 *
 * Stripe webhook 签名机制：
 * - 每个 webhook 请求携带 Stripe-Signature 头
 * - 格式: t=timestamp,v1=signature
 * - 签名 = HMAC-SHA256(webhookSecret, timestamp.rawBody)
 *
 * 参考 https://docs.stripe.com/webhooks/signatures
 */
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  webhookSecret: string,
): Promise<boolean> {
  const parts = sigHeader.split(",");
  let timestamp = "";
  let signature = "";
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") timestamp = value;
    if (key === "v1") signature = value;
  }
  if (!timestamp || !signature) return false;

  // 时间戳偏差校验（±5 分钟，防止重放攻击）
  const sigTime = parseInt(timestamp, 10) * 1000;
  if (isNaN(sigTime) || Math.abs(Date.now() - sigTime) > 5 * 60 * 1000) return false;

  // HMAC-SHA256(webhookSecret, timestamp.payload)
  const encoder = new TextEncoder();
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = new Uint8Array(
    signature.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [],
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(signedPayload));
}

// ═══════════════════════════════════════════════════════════════════════════════
// StripeProvider — 国际信用卡支付
// ═══════════════════════════════════════════════════════════════════════════════

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly displayName = "Stripe";
  readonly supportedCurrencies = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"];

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
  ) {}

  /**
   * 创建 Stripe Checkout Session。
   *
   * 使用 URLSearchParams（非 stripe-node SDK）构建请求，
   * 兼容 Workers 环境（无 Node.js 内置模块）。
   */
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const origin = (() => {
      try { return new URL(input.notifyUrl).origin; } catch { return "https://localhost"; }
    })();

    const params = new URLSearchParams({
      mode: "payment",
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][product_data][name]": input.metadata?.subject || "商品购买",
      "line_items[0][price_data][unit_amount]": String(input.amountCents),
      "line_items[0][quantity]": "1",
      "metadata[order_no]": input.orderNo,
      success_url: `${origin}/lookup?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/shop`,
    });
    if (input.returnUrl) params.set("success_url", input.returnUrl);
    if (input.notifyUrl) params.set("metadata[notify_url]", input.notifyUrl);

    const resp = await fetchWithRetry(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      timeoutMs: 10_000,
      retries: 2,
    });
    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Stripe API error: ${resp.status} - ${errorBody}`);
    }
    const session = (await resp.json()) as { id: string; url?: string };
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return { redirectUrl: session.url, providerTradeNo: session.id };
  }

  /**
   * 验证 Stripe webhook 回调。
   *
   * 路由层需传递 _raw_body（原始请求体）和 _stripe_signature（Stripe-Signature 头）。
   */
  async verifyCallback(params: Record<string, string>): Promise<CallbackResult> {
    const rawPayload = params["_raw_body"];
    const sigHeader = params["_stripe_signature"];
    if (!rawPayload || !sigHeader) {
      throw new Error("Stripe callback missing signature headers");
    }
    if (!(await verifyStripeSignature(rawPayload, sigHeader, this.webhookSecret))) {
      throw new Error("Stripe webhook signature invalid");
    }
    const event = JSON.parse(rawPayload) as {
      type?: string;
      data?: { object?: { metadata?: Record<string, string>; amount_total?: number; currency?: string; payment_intent?: string; id?: string } };
    };
    if (event.type !== "checkout.session.completed") {
      throw new Error(`Unexpected Stripe event type: ${event.type}`);
    }
    const session = event.data?.object;
    if (!session) throw new Error("Stripe event missing session object");
    const orderNo = session.metadata?.order_no;
    if (!orderNo) throw new Error("Stripe session missing order_no metadata");
    return {
      orderNo,
      providerTradeNo: session.payment_intent || session.id || "",
      amountCents: session.amount_total || 0,
      currency: (session.currency || "usd").toUpperCase(),
      paidAt: new Date().toISOString(),
    };
  }

  /** 查询 Checkout Session 支付状态 */
  async queryStatus(tradeNo: string): Promise<QueryStatusResult> {
    const resp = await fetchWithRetry(`${STRIPE_API_BASE}/checkout/sessions/${tradeNo}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
      timeoutMs: 8_000,
      retries: 2,
    });
    if (!resp.ok) return { paid: false };
    const session = (await resp.json()) as { payment_status?: string; payment_intent?: string };
    return {
      paid: session.payment_status === "paid",
      providerTradeNo: session.payment_intent,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stripe 工厂
// ═══════════════════════════════════════════════════════════════════════════════

export const stripeFactory: ProviderFactory = {
  name: "stripe",
  priority: 200,
  isAvailable(env) { return !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET); },
  create(env) {
    return new StripeProvider(
      env.STRIPE_SECRET_KEY as string,
      env.STRIPE_WEBHOOK_SECRET as string,
    );
  },
};

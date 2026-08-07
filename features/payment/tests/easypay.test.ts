import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProviderRegistry,
  EasyPayProvider,
  EasyPayProviderError,
  easyPayFactory,
  buildEasyPayPaymentApiUrl,
  buildEasyPayQueryApiUrl,
  buildEasyPaySubmitUrl,
  buildSignString,
  easyPayPayTypeLabel,
  isAmbiguousEasyPayProviderError,
  normalizeEasyPayApiBaseUrl,
  normalizeEasyPayEnabledPayTypes,
  normalizeEasyPayPayType,
  verifyEasyPaySign,
} from "../index.js";

const PID = "1001";
const KEY = "merchant-secret";
const API_BASE = "https://zpayz.cn";

function withSign(params: Record<string, string>): Record<string, string> {
  return {
    ...params,
    sign_type: "MD5",
    sign: createHash("md5").update(`${buildSignString(params)}${KEY}`).digest("hex"),
  };
}

function provider() {
  return new EasyPayProvider({
    pid: PID,
    key: KEY,
    apiBase: API_BASE,
    payType: "alipay",
    enabledPayTypes: "alipay,wxpay",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EasyPay URL and pay-type primitives", () => {
  it("normalizes root and endpoint URLs without keeping query/hash noise", () => {
    const inputs = [
      "https://zpayz.cn",
      "https://zpayz.cn/",
      "https://zpayz.cn/submit.php?x=1#docs",
      "https://zpayz.cn/mapi.php",
      "https://zpayz.cn/api.php?act=order",
    ];

    for (const input of inputs) {
      expect(normalizeEasyPayApiBaseUrl(input)).toBe("https://zpayz.cn");
      expect(buildEasyPayPaymentApiUrl(input)).toBe("https://zpayz.cn/mapi.php");
      expect(buildEasyPayQueryApiUrl(input)).toBe("https://zpayz.cn/api.php");
      expect(buildEasyPaySubmitUrl(input)).toBe("https://zpayz.cn/submit.php");
    }
  });

  it("rejects non-HTTPS public gateway URLs but permits localhost development", () => {
    expect(normalizeEasyPayApiBaseUrl("http://pay.example.com")).toBe("");
    expect(normalizeEasyPayApiBaseUrl("http://localhost:8787/mapi.php")).toBe("http://localhost:8787");
  });

  it("normalizes payment channels and falls back to alipay", () => {
    expect(normalizeEasyPayPayType("wxpay")).toBe("wxpay");
    expect(normalizeEasyPayPayType("qqpay")).toBe("qqpay");
    expect(normalizeEasyPayPayType("unknown")).toBe("alipay");
    expect(normalizeEasyPayEnabledPayTypes("wxpay,alipay,wxpay")).toEqual(["wxpay", "alipay"]);
    expect(easyPayPayTypeLabel("qqpay")).toBe("QQ 支付");
  });
});

describe("easyPayFactory", () => {
  it("registers only when the EasyPay protocol credentials are complete", () => {
    const env = { EASYPAY_PID: PID, EASYPAY_KEY: KEY, EASYPAY_API_BASE: API_BASE };
    expect(easyPayFactory.isAvailable(env)).toBe(true);
    expect(easyPayFactory.isAvailable({ EASYPAY_PID: PID, EASYPAY_API_BASE: API_BASE })).toBe(false);

    const registry = createProviderRegistry({}, [easyPayFactory], {
      easypay: { enabled: true, config: env },
    });
    expect(registry.get("easypay")).toBeInstanceOf(EasyPayProvider);

    const incomplete = createProviderRegistry({}, [easyPayFactory], {
      easypay: { enabled: true, config: { EASYPAY_PID: PID } },
    });
    expect(incomplete.get("easypay")).toBeUndefined();
  });
});

describe("EasyPayProvider", () => {
  it("creates mapi.php payments with signed EasyPay params", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify({ code: 1, payurl: "https://zpayz.cn/pay/EP001", trade_no: "EP001" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider().createPayment({
      orderNo: "ORDER001",
      amountCents: 9900,
      currency: "CNY",
      notifyUrl: "https://lottery.example.com/api/pay/callback/easypay",
      returnUrl: "https://lottery.example.com/result",
      description: "秒杀卡密",
      metadata: { payType: "wxpay", clientIp: "1.2.3.4" },
    });

    expect(result.providerTradeNo).toBe("EP001");
    expect(result.redirectUrl).toBe("https://zpayz.cn/pay/EP001");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://zpayz.cn/mapi.php");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("pid")).toBe(PID);
    expect(body.get("type")).toBe("wxpay");
    expect(body.get("out_trade_no")).toBe("ORDER001");
    expect(body.get("money")).toBe("99.00");
    expect(body.get("name")).toBe("秒杀卡密");
    expect(body.get("param")).toBe("ORDER001");
    expect(body.get("clientip")).toBe("1.2.3.4");
    await expect(verifyEasyPaySign(Object.fromEntries(body.entries()), KEY)).resolves.toBe(true);
  });

  it("rejects disabled payment channels before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider().createPayment({
      orderNo: "ORDER002",
      amountCents: 9900,
      currency: "CNY",
      notifyUrl: "https://lottery.example.com/api/pay/callback/easypay",
      metadata: { payType: "qqpay" },
    })).rejects.toMatchObject({
      name: "EasyPayProviderError",
      kind: "deterministic",
      providerMessage: "pay_type_disabled",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies gateway 4xx responses as deterministic failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad request", { status: 400 })));

    await expect(provider().createPayment({
      orderNo: "ORDER003",
      amountCents: 9900,
      currency: "CNY",
      notifyUrl: "https://lottery.example.com/api/pay/callback/easypay",
    })).rejects.toMatchObject({
      name: "EasyPayProviderError",
      kind: "deterministic",
      httpStatus: 400,
    });
  });

  it("keeps EasyPay qrcode content and img URL separated in raw result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => (
      new Response(JSON.stringify({
        code: 1,
        payurl: "https://zpayz.cn/pay/EP004",
        qrcode: "weixin://wxpay/bizpayurl?pr=abc",
        img: "https://zpayz.cn/qrcode/EP004.png",
        trade_no: "EP004",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )));

    const result = await provider().createPayment({
      orderNo: "ORDER004",
      amountCents: 1200,
      currency: "CNY",
      notifyUrl: "https://lottery.example.com/api/pay/callback/easypay",
    });

    expect(result.providerTradeNo).toBe("EP004");
    expect(result.qrCode).toBe("https://zpayz.cn/qrcode/EP004.png");
    expect(result.raw).toMatchObject({
      qrcode: "weixin://wxpay/bizpayurl?pr=abc",
      img: "https://zpayz.cn/qrcode/EP004.png",
      qrContent: "weixin://wxpay/bizpayurl?pr=abc",
      qrImageUrl: "https://zpayz.cn/qrcode/EP004.png",
    });
  });

  it("classifies deterministic and ambiguous provider failures", async () => {
    const deterministic = new EasyPayProviderError("deterministic", "bad request", { httpStatus: 400 });
    const ambiguous = new EasyPayProviderError("ambiguous", "timeout");

    expect(isAmbiguousEasyPayProviderError(deterministic)).toBe(false);
    expect(isAmbiguousEasyPayProviderError(ambiguous)).toBe(true);
  });

  it("verifies signed callbacks and converts CNY amount to integer minor units", async () => {
    const callback = withSign({
      pid: PID,
      type: "alipay",
      out_trade_no: "ORDER001",
      trade_no: "EP001",
      trade_status: "TRADE_SUCCESS",
      money: "99.00",
      endtime: "2026-08-07 12:00:00",
    });

    const result = await provider().verifyCallback(callback);

    expect(result.orderNo).toBe("ORDER001");
    expect(result.providerTradeNo).toBe("EP001");
    expect(result.amountCents).toBe(9900);
    expect(result.currency).toBe("CNY");
    expect(result.paidAt).toBe("2026-08-07 12:00:00");
  });

  it("rejects callback tampering and unpaid callback states", async () => {
    const good = withSign({
      pid: PID,
      out_trade_no: "ORDER001",
      trade_no: "EP001",
      trade_status: "TRADE_SUCCESS",
      money: "99.00",
    });

    await expect(provider().verifyCallback({ ...good, money: "0.01" })).rejects.toThrow("signature invalid");

    const unpaid = withSign({
      pid: PID,
      out_trade_no: "ORDER001",
      trade_no: "EP001",
      trade_status: "WAIT_BUYER_PAY",
      money: "99.00",
    });
    await expect(provider().verifyCallback(unpaid)).rejects.toThrow("Unexpected trade_status");
  });

  it("queries api.php order status without treating code=1 alone as paid", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 1, status: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 1,
        status: 1,
        trade_no: "EP001",
        money: "99.00",
        endtime: "2026-08-07 12:00:00",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider().queryStatus("ORDER001")).resolves.toMatchObject({ paid: false });
    await expect(provider().queryStatus("ORDER001")).resolves.toMatchObject({
      paid: true,
      providerTradeNo: "EP001",
      amountCents: 9900,
      currency: "CNY",
    });

    expect(String(fetchMock.mock.calls[0]![0])).toContain("https://zpayz.cn/api.php?act=order");
  });

  it("does not expose an unverified refund implementation", () => {
    expect(provider().refund).toBeUndefined();
  });
});

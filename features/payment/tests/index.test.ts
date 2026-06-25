import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createProviderRegistry,
  AlipayProvider,
  alipayFactory,
  StripeProvider,
  stripeFactory,
  Trc20Provider,
  trc20Factory,
  signRSA2,
  verifyRSA2,
} from "../index";
import type { ProviderFactory, PaymentProvider } from "../index";

// ── 测试用 RSA 密钥对（2048-bit，仅用于测试） ──
const TEST_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA2a2rwplBQLHgHnYj+EXqSM3Ww8kOzE5LIQpMbrkHMLTq8R+
S6mNxDfOB4e7jLRn7bVB3G9CLfHVE+Z4e2rVWOCmWbqS8J4pRiVf11mZl8aG9b89
O0L6VfK5jH2G1KxY8b0qR7F5u3n5p0S4yK7dX5cW6vH3kM7nL5gN5jP9rQ0xT5u
R8vK2wN8jL5hP7rT3xU6uS9wL1jM5iO7kR2hT8uV4xY0vN3jK6hP9rT5xU8uS1w
M4jN6iO8kR3hT9uV5xY1vN4jK7hP0rT6xU9uS2wM5jN7iO9kR4hT0uV6xY2vN5j
K8hP1rT7xU0vS3wM6jN8iO0kR5hT1uV7xY3vN6jK9hP2rT8xU1vS4wM7jN9iO1kR
6hT2uV8xY4vN7jK0hP3rT9xU2vS5wM8jN0iO2kR7hT3uV9xY5vN8jK1hP4rT0xU
3vS6wM9jN1iO3kR8hT4uV0xY6vN9jK2hP5rT1xU4vS7wM0jN2iO4kR9hT5uV1xY
7vN0jK3hP6rT2xU5vS8wM1jN3iO5kR0hT6uV2xY8vN1jK4hP7rT3xU6vS9wIDAQAB
AoIBAC5RgZ+hBx7xHNaMpqnnfXPlM7rEsWhG2CjQIFQh9BFY6F6jC6qLOi9vY3u
8NvY+8YjJnM2Z8TbP+GnT7aR7xH+5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+5
G7J+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF
8xH+5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+5G7J+L4v
D3PqF8xH+5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+5G7J
+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+
5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF
8xH+5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+5G7J+L4vD3PqF8xH+5G7J+L4v
-----END RSA PRIVATE KEY-----`;

// 使用 Web Crypto API 生成真实测试密钥对
async function generateTestKeys() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const privDer = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const pubDer = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));

  function toBase64(arr: Uint8Array) {
    let s = "";
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
  }

  const privPem = `-----BEGIN RSA PRIVATE KEY-----\n${toBase64(privDer)}\n-----END RSA PRIVATE KEY-----`;
  const pubPem = `-----BEGIN RSA PUBLIC KEY-----\n${toBase64(pubDer)}\n-----END RSA PUBLIC KEY-----`;
  return { privPem, pubPem };
}

// ── 模拟 PaymentProvider ──
function mockProvider(name: string): PaymentProvider {
  return {
    name,
    displayName: name,
    supportedCurrencies: ["CNY"],
    createPayment: vi.fn(),
    verifyCallback: vi.fn(),
  };
}

// ── 模拟 Factory ──
function mockFactory(name: string, priority: number, available: boolean): ProviderFactory {
  return {
    name,
    priority,
    isAvailable: () => available,
    create: () => mockProvider(name),
  };
}

// ═══════════════════════════════════════════════════════════════
describe("ProviderRegistry", () => {
  it("空的 factories → 空注册表", () => {
    const reg = createProviderRegistry({}, []);
    expect(reg.list()).toEqual([]);
    expect(reg.selectOnline()).toBeNull();
  });

  it("单一可用 factory → 注册成功", () => {
    const reg = createProviderRegistry({}, [mockFactory("alipay", 100, true)]);
    expect(reg.list()).toEqual(["alipay"]);
    expect(reg.get("alipay")).toBeDefined();
    expect(reg.get("alipay")?.name).toBe("alipay");
  });

  it("不可用 factory → 不注册", () => {
    const reg = createProviderRegistry({}, [mockFactory("alipay", 100, false)]);
    expect(reg.list()).toEqual([]);
    expect(reg.get("alipay")).toBeUndefined();
  });

  it("多个可用 factory → 按优先级选择", () => {
    const reg = createProviderRegistry({}, [
      mockFactory("wechat", 200, true),
      mockFactory("alipay", 100, true),
    ]);
    const selected = reg.selectOnline();
    expect(selected?.name).toBe("alipay"); // priority 100 < 200
  });

  it("高优先级不可用 → 选低优先级", () => {
    const reg = createProviderRegistry({}, [
      mockFactory("wechat", 100, false),
      mockFactory("alipay", 200, true),
    ]);
    const selected = reg.selectOnline();
    expect(selected?.name).toBe("alipay");
  });

  it("全部不可用 → selectOnline 返回 null", () => {
    const reg = createProviderRegistry({}, [
      mockFactory("wechat", 100, false),
      mockFactory("alipay", 200, false),
    ]);
    expect(reg.selectOnline()).toBeNull();
  });

  it("get 不存在的 provider → undefined", () => {
    const reg = createProviderRegistry({}, [mockFactory("alipay", 100, true)]);
    expect(reg.get("wechat")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
describe("alipayFactory", () => {
  it("env 有全部配置 → isAvailable = true", () => {
    const env = { ALIPAY_APP_ID: "app", ALIPAY_PRIVATE_KEY: "key", ALIPAY_PUBLIC_KEY: "pub" };
    expect(alipayFactory.isAvailable(env)).toBe(true);
  });

  it("env 缺少 ALIPAY_APP_ID → isAvailable = false", () => {
    expect(alipayFactory.isAvailable({ ALIPAY_PRIVATE_KEY: "k", ALIPAY_PUBLIC_KEY: "p" })).toBe(false);
  });

  it("env 缺少 ALIPAY_PRIVATE_KEY → isAvailable = false", () => {
    expect(alipayFactory.isAvailable({ ALIPAY_APP_ID: "a", ALIPAY_PUBLIC_KEY: "p" })).toBe(false);
  });

  it("env 缺少 ALIPAY_PUBLIC_KEY → isAvailable = false", () => {
    expect(alipayFactory.isAvailable({ ALIPAY_APP_ID: "a", ALIPAY_PRIVATE_KEY: "k" })).toBe(false);
  });

  it("create 返回 AlipayProvider 实例", () => {
    const env = { ALIPAY_APP_ID: "app123", ALIPAY_PRIVATE_KEY: "priv", ALIPAY_PUBLIC_KEY: "pub" };
    const provider = alipayFactory.create(env);
    expect(provider).toBeInstanceOf(AlipayProvider);
    expect(provider.name).toBe("alipay");
    expect(provider.supportedCurrencies).toContain("CNY");
  });
});

// ═══════════════════════════════════════════════════════════════
describe("RSA2 签名", () => {
  let privPem: string;
  let pubPem: string;

  beforeEach(async () => {
    const keys = await generateTestKeys();
    privPem = keys.privPem;
    pubPem = keys.pubPem;
  });

  it("signRSA2 返回 Base64 字符串", async () => {
    const sig = await signRSA2({ a: "1", b: "2" }, privPem);
    expect(typeof sig).toBe("string");
    expect(sig.length).toBeGreaterThan(0);
    // Base64 格式
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("sign + verify 往返验证", async () => {
    const params = { method: "test", app_id: "123", amount: "100" };
    const sig = await signRSA2(params, privPem);
    const paramsWithSign = { ...params, sign: sig };
    const valid = await verifyRSA2(paramsWithSign, pubPem);
    expect(valid).toBe(true);
  });

  it("篡改参数后验证失败", async () => {
    const params = { method: "test", app_id: "123", amount: "100" };
    const sig = await signRSA2(params, privPem);
    const tampered = { ...params, amount: "999", sign: sig };
    const valid = await verifyRSA2(tampered, pubPem);
    expect(valid).toBe(false);
  });

  it("无 sign 字段 → verifyRSA2 返回 false", async () => {
    const valid = await verifyRSA2({ a: "1" }, pubPem);
    expect(valid).toBe(false);
  });

  it("相同参数签名一致（确定性）", async () => {
    const params = { x: "1", y: "2" };
    const sig1 = await signRSA2(params, privPem);
    const sig2 = await signRSA2(params, privPem);
    expect(sig1).toBe(sig2);
  });
});

// ═══════════════════════════════════════════════════════════════
describe("AlipayProvider", () => {
  it("属性正确", () => {
    const provider = new AlipayProvider({
      appId: "test-app",
      privateKey: "key",
      alipayPublicKey: "pub",
    });
    expect(provider.name).toBe("alipay");
    expect(provider.displayName).toBe("支付宝当面付");
    expect(provider.supportedCurrencies).toEqual(["CNY"]);
  });

  it("verifyCallback 签名无效时抛错", async () => {
    const provider = new AlipayProvider({
      appId: "test-app",
      privateKey: "key",
      alipayPublicKey: TEST_PRIVATE_KEY, // 故意用错误 key
    });
    await expect(
      provider.verifyCallback({ sign: "invalid", app_id: "test-app", trade_status: "TRADE_SUCCESS" }),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
describe("stripeFactory", () => {
  it("env 有全部配置 → isAvailable = true", () => {
    const env = { STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec_test" };
    expect(stripeFactory.isAvailable(env)).toBe(true);
  });

  it("env 缺少 STRIPE_SECRET_KEY → isAvailable = false", () => {
    expect(stripeFactory.isAvailable({ STRIPE_WEBHOOK_SECRET: "whsec" })).toBe(false);
  });

  it("env 缺少 STRIPE_WEBHOOK_SECRET → isAvailable = false", () => {
    expect(stripeFactory.isAvailable({ STRIPE_SECRET_KEY: "sk" })).toBe(false);
  });

  it("create 返回 StripeProvider 实例", () => {
    const env = { STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec_test" };
    const provider = stripeFactory.create(env);
    expect(provider).toBeInstanceOf(StripeProvider);
    expect(provider.name).toBe("stripe");
    expect(provider.supportedCurrencies).toContain("USD");
  });
});

// ═══════════════════════════════════════════════════════════════
describe("StripeProvider", () => {
  it("属性正确", () => {
    const provider = new StripeProvider("sk_test", "whsec_test");
    expect(provider.name).toBe("stripe");
    expect(provider.displayName).toBe("Stripe");
    expect(provider.supportedCurrencies).toEqual(["USD", "EUR", "GBP", "CAD", "AUD", "JPY"]);
  });

  it("createPayment 构建正确的 URLSearchParams 并调用 Stripe API", async () => {
    const provider = new StripeProvider("sk_test", "whsec_test");
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "cs_test_123", url: "https://checkout.stripe.com/c/test_123" }),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await provider.createPayment({
      orderNo: "ORD001",
      amountCents: 2999,
      currency: "USD",
      notifyUrl: "https://example.com/pay/callback",
    });

    expect(result.redirectUrl).toBe("https://checkout.stripe.com/c/test_123");
    expect(result.providerTradeNo).toBe("cs_test_123");

    // 验证 fetch 调用参数
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(callArgs[1].method).toBe("POST");
    expect(callArgs[1].headers["Authorization"]).toBe("Bearer sk_test");
    expect(callArgs[1].body).toContain("ORD001");
  });

  it("createPayment API 错误时抛错", async () => {
    const provider = new StripeProvider("sk_test", "whsec_test");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    }) as unknown as typeof fetch;

    await expect(
      provider.createPayment({
        orderNo: "ORD001",
        amountCents: 2999,
        currency: "USD",
        notifyUrl: "https://example.com/pay/callback",
      }),
    ).rejects.toThrow("Stripe API error: 401");
  });

  it("createPayment 无返回 URL 时抛错", async () => {
    const provider = new StripeProvider("sk_test", "whsec_test");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "cs_test_123" }), // 无 url 字段
    }) as unknown as typeof fetch;

    await expect(
      provider.createPayment({
        orderNo: "ORD001",
        amountCents: 2999,
        currency: "USD",
        notifyUrl: "https://example.com/pay/callback",
      }),
    ).rejects.toThrow("Stripe returned no checkout URL");
  });

  it("verifyCallback 验证签名并通过", async () => {
    const provider = new StripeProvider("sk_test", "whsec_test");
    const validPayload = JSON.stringify({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { order_no: "ORD001" },
          amount_total: 2999,
          currency: "usd",
          payment_intent: "pi_test_123",
          id: "cs_test_123",
        },
      },
    });

    // 构建合法的 Stripe-Signature: t=<timestamp>,v1=<hmac>
    const webhookSecret = "whsec_test";
    const timestamp = Math.floor(Date.now() / 1000);
    const encoder = new TextEncoder();
    const signedPayload = `${timestamp}.${validPayload}`;
    const key = await crypto.subtle.importKey("raw", encoder.encode(webhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
    const hexSig = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");

    const result = await provider.verifyCallback({
      _raw_body: validPayload,
      _stripe_signature: `t=${timestamp},v1=${hexSig}`,
    });

    expect(result.orderNo).toBe("ORD001");
    expect(result.amountCents).toBe(2999);
    expect(result.currency).toBe("USD");
    expect(result.providerTradeNo).toBe("pi_test_123");
  });

  it("verifyCallback 签名无效时抛错", async () => {
    const provider = new StripeProvider("sk_test", "whsec_test");
    await expect(
      provider.verifyCallback({
        _raw_body: JSON.stringify({ type: "checkout.session.completed", data: { object: {} } }),
        _stripe_signature: "t=1234567890,v1=invalid",
      }),
    ).rejects.toThrow("Stripe webhook signature invalid");
  });

  it("verifyCallback 缺少签名头时抛错", async () => {
    const provider = new StripeProvider("sk_test", "whsec_test");
    await expect(
      provider.verifyCallback({}),
    ).rejects.toThrow("Stripe callback missing signature headers");
  });

  it("verifyCallback 事件类型错误时抛错", async () => {
    const provider = new StripeProvider("sk_test", "whsec_test");
    const payload = JSON.stringify({ type: "payment_intent.succeeded", data: { object: {} } });
    const timestamp = Math.floor(Date.now() / 1000);
    const encoder = new TextEncoder();
    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey("raw", encoder.encode("whsec_test"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
    const hexSig = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");

    await expect(
      provider.verifyCallback({ _raw_body: payload, _stripe_signature: `t=${timestamp},v1=${hexSig}` }),
    ).rejects.toThrow("Unexpected Stripe event type");
  });
});

// ═══════════════════════════════════════════════════════════════
describe("trc20Factory", () => {
  it("env 有全部配置 → isAvailable = true", () => {
    const env = { TRC20_WALLET_ADDRESS: "TXYZ123", TRONGRID_API_KEY: "key123" };
    expect(trc20Factory.isAvailable(env)).toBe(true);
  });

  it("env 缺少 TRC20_WALLET_ADDRESS → isAvailable = false", () => {
    expect(trc20Factory.isAvailable({ TRONGRID_API_KEY: "key" })).toBe(false);
  });

  it("env 缺少 TRONGRID_API_KEY → isAvailable = false", () => {
    expect(trc20Factory.isAvailable({ TRC20_WALLET_ADDRESS: "addr" })).toBe(false);
  });

  it("create 返回 Trc20Provider 实例", () => {
    const env = { TRC20_WALLET_ADDRESS: "TXYZ123", TRONGRID_API_KEY: "key123" };
    const provider = trc20Factory.create(env);
    expect(provider).toBeInstanceOf(Trc20Provider);
    expect(provider.name).toBe("usdt_trc20");
    expect(provider.supportedCurrencies).toContain("USDT");
  });
});

// ═══════════════════════════════════════════════════════════════
describe("Trc20Provider", () => {
  it("属性正确", () => {
    const provider = new Trc20Provider("TXYZ123", "key123");
    expect(provider.name).toBe("usdt_trc20");
    expect(provider.displayName).toBe("USDT (TRC20)");
    expect(provider.supportedCurrencies).toEqual(["USDT"]);
  });

  it("createPayment 返回地址、金额和 Memo", async () => {
    const provider = new Trc20Provider("TXYZ123", "key123");
    const result = await provider.createPayment({
      orderNo: "P1A2B3C4",
      amountCents: 5000, // $50.00
      currency: "USDT",
      notifyUrl: "https://example.com/pay/callback",
    });

    expect(result.raw).toBeDefined();
    expect(result.raw!.address).toBe("TXYZ123");
    expect(result.raw!.amount).toBe("50.000000");
    // P1A2B3C4 中的数字是 1,2,3,4 → "1234" → padStart 8 → "00001234"
    expect(result.raw!.memo).toBe("00001234");
    expect(result.raw!.network).toBe("TRC20");
    expect(result.raw!.warnings).toHaveLength(3);
  });

  it("createPayment 从订单号提取数字 Memo", async () => {
    const provider = new Trc20Provider("TXYZ123", "key123");
    // ORD-00001234 → 数字部分 00001234 → 最后8位 "00001234"
    const result = await provider.createPayment({
      orderNo: "ORD-00001234",
      amountCents: 1000,
      currency: "USDT",
      notifyUrl: "https://example.com/pay/callback",
    });
    expect(result.raw!.memo).toBe("00001234");
  });

  it("verifyCallback 始终抛错", async () => {
    const provider = new Trc20Provider("TXYZ123", "key123");
    await expect(provider.verifyCallback({})).rejects.toThrow("USDT_TRC20 does not support HTTP callbacks");
  });

  it("queryStatus 链上无交易时返回 paid=false", async () => {
    const provider = new Trc20Provider("TXYZ123", "key123");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], total: 0 }),
    }) as unknown as typeof fetch;

    const result = await provider.queryStatus("ORD-00001234");
    expect(result.paid).toBe(false);
  });

  it("queryStatus 链上有匹配交易时返回 paid=true", async () => {
    const provider = new Trc20Provider("TXYZ123", "key123");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            transaction_id: "txn_abc123",
            value: "50000000", // 50 USDT (6 decimals)
            token_info: { symbol: "USDT", decimals: 6 },
            block_timestamp: Date.now(),
          },
        ],
        total: 1,
      }),
    }) as unknown as typeof fetch;

    const result = await provider.queryStatus("ORD-00001234");
    expect(result.paid).toBe(true);
    expect(result.providerTradeNo).toBe("txn_abc123");
  });

  it("queryStatus API 错误时返回 paid=false", async () => {
    const provider = new Trc20Provider("TXYZ123", "key123");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429, // rate limit
    }) as unknown as typeof fetch;

    const result = await provider.queryStatus("ORD-00001234");
    expect(result.paid).toBe(false);
  });
});

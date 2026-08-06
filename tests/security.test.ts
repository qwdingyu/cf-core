import { describe, it, expect } from "vitest";
import { sha256, constantTimeEqual, timingSafeEqualHex, timingSafeEqualString, getBearerToken } from "../src/security.js";

describe("sha256", () => {
  it("空字符串", async () => {
    const hash = await sha256("");
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("hello world", async () => {
    const hash = await sha256("hello world");
    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("输出长度固定 64 字符", async () => {
    const hash = await sha256("test");
    expect(hash.length).toBe(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("constantTimeEqual", () => {
  it("相同字符串", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
  });

  it("不同字符串", () => {
    expect(constantTimeEqual("abc", "def")).toBe(false);
  });

  it("不同长度", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "a")).toBe(false);
  });

  it("空字符串", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("getBearerToken", () => {
  it("标准 Bearer Token", () => {
    const c = {
      req: { header: (name: string) => name === "authorization" ? "Bearer my-token-123" : undefined },
    } as any;
    expect(getBearerToken(c)).toBe("my-token-123");
  });

  it("无 Authorization 头", () => {
    const c = {
      req: { header: () => undefined },
    } as any;
    expect(getBearerToken(c)).toBe("");
  });

  it("非 Bearer 格式", () => {
    const c = {
      req: { header: (name: string) => name === "authorization" ? "Basic abc" : undefined },
    } as any;
    expect(getBearerToken(c)).toBe("");
  });
});

describe("timingSafeEqualHex", () => {
  it("same hex ignoring case", () => {
    expect(timingSafeEqualHex("a1b2", "A1B2")).toBe(true);
    expect(timingSafeEqualHex("", "")).toBe(true);
  });

  it("different content or length", () => {
    expect(timingSafeEqualHex("a1b2", "a1b3")).toBe(false);
    expect(timingSafeEqualHex("a1", "a1b2")).toBe(false);
  });
});

describe("timingSafeEqualString", () => {
  it("same and different strings", () => {
    expect(timingSafeEqualString("hello", "hello")).toBe(true);
    expect(timingSafeEqualString("hello", "hellp")).toBe(false);
    expect(timingSafeEqualString("a", "ab")).toBe(false);
  });
});

describe("verifyTurnstile（P1-1 增强）", () => {
  const mockCtx = (env: Record<string, unknown> = {}) => ({
    env: { TURNSTILE_SECRET_KEY: "secret", ...env },
    req: { header: () => undefined },
  }) as any;

  it("未启用时直接放行", async () => {
    const { verifyTurnstile } = await import("../src/security.js");
    const r = await verifyTurnstile(mockCtx(), undefined, { enabled: false });
    expect(r).toEqual({ ok: true });
  });

  it("strict + 无 secret 返回 503", async () => {
    const { verifyTurnstile } = await import("../src/security.js");
    const r = await verifyTurnstile(mockCtx({ TURNSTILE_SECRET_KEY: undefined }), undefined, { strict: true });
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it("strict + 无 token + bypass 放过", async () => {
    const { verifyTurnstile } = await import("../src/security.js");
    const r = await verifyTurnstile(mockCtx(), undefined, {
      strict: true, allowBypass: () => true,
    });
    expect(r).toMatchObject({ ok: true, smokeSkipped: true });
  });

  it("strict + 无 token 时 403", async () => {
    const { verifyTurnstile } = await import("../src/security.js");
    const r = await verifyTurnstile(mockCtx(), undefined, { strict: true });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("验证失败返回 fail", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ success: false }), { status: 200 });
    const { verifyTurnstile } = await import("../src/security.js");
    const r = await verifyTurnstile(mockCtx(), "t", { strict: true });
    expect(r).toMatchObject({ ok: false, message: "人机验证失败" });
    globalThis.fetch = orig;
  });

  it("验证成功返回 ok", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 });
    const { verifyTurnstile } = await import("../src/security.js");
    const r = await verifyTurnstile(mockCtx(), "t", { strict: true });
    expect(r).toMatchObject({ ok: true });
    globalThis.fetch = orig;
  });
});

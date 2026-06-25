import { describe, it, expect } from "vitest";
import { sha256, constantTimeEqual, getBearerToken } from "../src/security.js";

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

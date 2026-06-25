import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt, extractJwt } from "../src/auth/jwt";
import { hashPassword, verifyPassword } from "../src/auth/password";

describe("JWT", () => {
  const secret = "test-secret-key-must-be-at-least-32-chars-long";

  it("签发并验证", async () => {
    const token = await signJwt("user-1", "test@example.com", secret);
    const payload = await verifyJwt(token, secret);

    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-1");
    expect(payload!.email).toBe("test@example.com");
    expect(payload!.exp).toBeGreaterThan(payload!.iat);
  });

  it("错误密钥验证失败", async () => {
    const token = await signJwt("user-1", "test@example.com", secret);
    const payload = await verifyJwt(token, "wrong-secret-key-that-is-long-enough");
    expect(payload).toBeNull();
  });

  it("过期 Token 验证失败", async () => {
    const token = await signJwt("user-1", "test@example.com", secret, -1);
    const payload = await verifyJwt(token, secret);
    expect(payload).toBeNull();
  });

  it("格式错误返回 null", async () => {
    expect(await verifyJwt("not.a.valid.jwt", secret)).toBeNull();
    expect(await verifyJwt("abc", secret)).toBeNull();
    expect(await verifyJwt("", secret)).toBeNull();
  });

  it("自定义过期时间", async () => {
    const token = await signJwt("user-1", "a@b.com", secret, 3600);
    const payload = await verifyJwt(token, secret);
    expect(payload!.exp - payload!.iat).toBe(3600);
  });
});

describe("extractJwt", () => {
  it("从 Bearer 头提取", () => {
    const c = {
      req: {
        header: (name: string) => {
          if (name === "Authorization") return "Bearer eyJhbGci.test.sig";
          return undefined;
        },
      },
    };
    expect(extractJwt(c)).toBe("eyJhbGci.test.sig");
  });

  it("从 Cookie 提取", () => {
    const c = {
      req: {
        header: (name: string) => {
          if (name === "Cookie") return "session=abc; token=eyJ.test.sig";
          return undefined;
        },
      },
    };
    expect(extractJwt(c)).toBe("eyJ.test.sig");
  });

  it("无 Token 返回 null", () => {
    const c = { req: { header: () => undefined } };
    expect(extractJwt(c)).toBeNull();
  });
});

describe("Password", () => {
  it("哈希并验证", async () => {
    const { hash, salt } = await hashPassword("my-password");
    expect(hash.length).toBe(64); // 256-bit hex
    expect(salt.length).toBe(32); // 128-bit hex

    const valid = await verifyPassword("my-password", hash, salt);
    expect(valid).toBe(true);
  });

  it("错误密码验证失败", async () => {
    const { hash, salt } = await hashPassword("correct-password");
    const valid = await verifyPassword("wrong-password", hash, salt);
    expect(valid).toBe(false);
  });

  it("相同密码不同 salt 产生不同哈希", async () => {
    const r1 = await hashPassword("same-password");
    const r2 = await hashPassword("same-password");
    expect(r1.hash).not.toBe(r2.hash);
    expect(r1.salt).not.toBe(r2.salt);
  });

  it("使用指定 salt", async () => {
    const salt = "a".repeat(32);
    const r1 = await hashPassword("test", salt);
    const r2 = await hashPassword("test", salt);
    expect(r1.hash).toBe(r2.hash);
    expect(r1.salt).toBe(salt);
  });
});

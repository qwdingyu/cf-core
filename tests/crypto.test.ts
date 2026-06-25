import { describe, it, expect } from "vitest";
import { encrypt, decrypt, generateUUID, isEncryptionAvailable } from "../src/crypto";

describe("AES-256-GCM", () => {
  // 64 字符 hex = 32 字节 = 256 bit
  const key = "a".repeat(64);

  it("加密并解密", async () => {
    const data = { username: "test", password: "secret123" };
    const encrypted = await encrypt(data, key);
    expect(typeof encrypted).toBe("string");
    expect(encrypted).not.toContain("secret123");

    const decrypted = await decrypt(encrypted, key);
    expect(decrypted).toEqual(data);
  });

  it("每次加密产生不同密文（随机 IV）", async () => {
    const data = { test: "value" };
    const e1 = await encrypt(data, key);
    const e2 = await encrypt(data, key);
    expect(e1).not.toBe(e2);
  });

  it("错误密钥解密失败", async () => {
    const encrypted = await encrypt({ test: 1 }, key);
    await expect(decrypt(encrypted, "b".repeat(64))).rejects.toThrow();
  });

  it("无效密钥长度抛错", async () => {
    await expect(encrypt({}, "short")).rejects.toThrow("64 字符 hex");
  });
});

describe("generateUUID", () => {
  it("格式正确", () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("唯一性", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUUID()));
    expect(ids.size).toBe(100);
  });
});

describe("isEncryptionAvailable", () => {
  it("有效密钥", () => {
    expect(isEncryptionAvailable({ CREDENTIALS_ENCRYPTION_KEY: "a".repeat(64) })).toBe(true);
  });

  it("无效密钥", () => {
    expect(isEncryptionAvailable({ CREDENTIALS_ENCRYPTION_KEY: "short" })).toBe(false);
    expect(isEncryptionAvailable({})).toBe(false);
  });
});

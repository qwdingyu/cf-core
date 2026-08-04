import { describe, expect, it } from "vitest";
import {
  decryptSecretConfigResult,
  decryptSecretConfigValue,
  decryptSecretConfigValueObserved,
  encryptSecretConfigValue,
  encryptSecretConfigValueLegacyRaw,
  encryptSecretConfigValueLegacyV1CoreJson,
  isValidSecretEncryptionKey,
  SECRET_CONFIG_PREFIX_V1,
  SECRET_CONFIG_PREFIX_V2_CORE_JSON,
} from "../src/secret-config.js";

describe("secret-config (shipped helpers)", () => {
  const key = "a".repeat(64);

  it("new writes use v2 core-json prefix and round-trip", async () => {
    const encrypted = await encryptSecretConfigValue("private-api-key", key);
    expect(encrypted.startsWith(SECRET_CONFIG_PREFIX_V2_CORE_JSON)).toBe(true);
    expect(encrypted).not.toContain("private-api-key");
    await expect(decryptSecretConfigValue(encrypted, key)).resolves.toBe("private-api-key");
    const detailed = await decryptSecretConfigResult(encrypted, key);
    expect(detailed).toEqual({ ok: true, value: "private-api-key", layout: "v2-corejson" });
  });

  it("dual-reads shop legacy enc:v1 core-json", async () => {
    const legacy = await encryptSecretConfigValueLegacyV1CoreJson("shop-secret", key);
    expect(legacy.startsWith(SECRET_CONFIG_PREFIX_V1)).toBe(true);
    const detailed = await decryptSecretConfigResult(legacy, key);
    expect(detailed.ok).toBe(true);
    if (detailed.ok) {
      expect(detailed.value).toBe("shop-secret");
      expect(detailed.layout).toBe("v1-corejson");
    }
  });

  it("dual-reads lottery legacy enc:v1 raw-string", async () => {
    const legacy = await encryptSecretConfigValueLegacyRaw("lottery-secret", key);
    expect(legacy.startsWith(SECRET_CONFIG_PREFIX_V1)).toBe(true);
    const detailed = await decryptSecretConfigResult(legacy, key);
    expect(detailed.ok).toBe(true);
    if (detailed.ok) {
      expect(detailed.value).toBe("lottery-secret");
      expect(detailed.layout).toBe("v1-raw");
    }
  });

  it("exposes testable failure path instead of pretending success", async () => {
    const bad = await decryptSecretConfigResult("enc:v1:not-valid-ciphertext!!!", key);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.reason).toBe("decrypt_failed");
      expect(bad.value).toBe("");
    }
    const badKey = await decryptSecretConfigResult(
      await encryptSecretConfigValue("x", key),
      "z".repeat(64),
    );
    // wrong key → decrypt_failed (key format valid) or still fail
    expect(badKey.ok).toBe(false);
    const invalidKey = await decryptSecretConfigResult(
      await encryptSecretConfigValue("x", key),
      "short",
    );
    expect(invalidKey).toEqual({ ok: false, value: "", reason: "invalid_key" });
  });

  it("passes through plaintext and validates key shape", async () => {
    await expect(decryptSecretConfigValue("plain-token", key)).resolves.toBe("plain-token");
    expect(isValidSecretEncryptionKey(key)).toBe(true);
    expect(isValidSecretEncryptionKey("z".repeat(64))).toBe(false);
  });
});

describe("decryptSecretConfigValueObserved", () => {
  const key = "a".repeat(64);

  it("does not call onFail on success", async () => {
    const events: unknown[] = [];
    const enc = await encryptSecretConfigValue("ok-secret", key);
    const value = await decryptSecretConfigValueObserved(enc, key, (e) => events.push(e));
    expect(value).toBe("ok-secret");
    expect(events).toEqual([]);
  });

  it("calls onFail without leaking ciphertext", async () => {
    const events: Array<{ reason: string; encrypted: boolean }> = [];
    const value = await decryptSecretConfigValueObserved("enc:v1:not-valid!!!", key, (e) => {
      events.push({ reason: e.reason, encrypted: e.encrypted });
    });
    expect(value).toBe("");
    expect(events).toEqual([{ reason: "decrypt_failed", encrypted: true }]);
  });
});

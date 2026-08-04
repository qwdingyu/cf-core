/**
 * 系统敏感配置加密封装（版本化前缀 + 双读）。
 *
 * 布局：
 * - 新写入：`enc:v2:corejson:` + AES-GCM(JSON `{ value: string }`)（与 shop 历史 core crypto 一致）
 * - 双读旧 shop：`enc:v1:` + 同上 JSON 密文
 * - 双读旧 lottery：`enc:v1:` + 原始 UTF-8 字符串密文（无 JSON 包装）
 *
 * 解密失败不会伪装成「明文成功」：
 * - `decryptSecretConfigResult` 返回 `{ ok:false, reason }`（可测）
 * - `decryptSecretConfigValue` 在失败时返回 `""`（兼容旧调用方），但仅当 result.ok===false
 * - `decryptSecretConfigValueObserved` 在失败时可选回调（不传明文），便于产品侧打日志
 *
 * v1 双读固有限制（极低概率）：
 * 若 lottery raw 明文恰好是 `{"value":"..."}` JSON，会优先被识别为 v1-corejson 并只取 `.value`。
 * 新写入一律走 v2；禁止把任意 JSON 对象序列化当 raw secret 长期存放。
 *
 * `encryptSecretConfigValueLegacy*` 仅测试/迁移；生产新写入必须用 `encryptSecretConfigValue`。
 */

import { decrypt, encrypt } from "./crypto.js";

/** 历史 shop / lottery 共用前缀（布局曾分叉，仅用于双读） */
export const SECRET_CONFIG_PREFIX_V1 = "enc:v1:";

/** 新写入：明确 core-json 布局，避免与 raw-string 伪兼容 */
export const SECRET_CONFIG_PREFIX_V2_CORE_JSON = "enc:v2:corejson:";

const ALGO = "AES-GCM";
const IV_LENGTH = 12;

export type SecretDecryptOk = { ok: true; value: string; layout: "plaintext" | "v2-corejson" | "v1-corejson" | "v1-raw" };
export type SecretDecryptFail = {
  ok: false;
  value: "";
  reason: "invalid_key" | "decrypt_failed" | "empty_payload" | "invalid_shape";
};
export type SecretDecryptResult = SecretDecryptOk | SecretDecryptFail;

export function isValidSecretEncryptionKey(value: string | undefined): value is string {
  return Boolean(value && /^[a-fA-F0-9]{64}$/.test(value));
}

async function importAesKey(hexKey: string): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(hexKey.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.importKey("raw", keyBytes, { name: ALGO }, false, ["encrypt", "decrypt"]);
}

function arrayToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(""));
}

function base64ToArray(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** lottery 历史：明文 string → AES-GCM → base64(iv||cipher) */
async function encryptRawString(value: string, encryptionKeyHex: string): Promise<string> {
  const key = await importAesKey(encryptionKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return arrayToBase64(combined);
}

async function decryptRawString(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  const key = await importAesKey(encryptionKeyHex);
  const combined = base64ToArray(encryptedBase64);
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const plain = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
  return new TextDecoder().decode(plain);
}

/**
 * 新写入敏感配置：始终使用 v2 core-json 前缀。
 */
export async function encryptSecretConfigValue(value: string, encryptionKey: string): Promise<string> {
  if (!value) return "";
  if (!isValidSecretEncryptionKey(encryptionKey)) throw new Error("敏感配置加密密钥无效");
  const body = await encrypt({ value }, encryptionKey);
  return `${SECRET_CONFIG_PREFIX_V2_CORE_JSON}${body}`;
}

/**
 * 可观测解密：失败带 reason，成功带 layout（便于审计双读路径）。
 */
export async function decryptSecretConfigResult(
  value: string,
  encryptionKey?: string,
): Promise<SecretDecryptResult> {
  if (!value) return { ok: true, value: "", layout: "plaintext" };
  if (
    !value.startsWith(SECRET_CONFIG_PREFIX_V2_CORE_JSON) &&
    !value.startsWith(SECRET_CONFIG_PREFIX_V1)
  ) {
    return { ok: true, value, layout: "plaintext" };
  }

  if (!isValidSecretEncryptionKey(encryptionKey)) {
    return { ok: false, value: "", reason: "invalid_key" };
  }

  if (value.startsWith(SECRET_CONFIG_PREFIX_V2_CORE_JSON)) {
    const body = value.slice(SECRET_CONFIG_PREFIX_V2_CORE_JSON.length);
    if (!body) return { ok: false, value: "", reason: "empty_payload" };
    try {
      const decrypted = (await decrypt(body, encryptionKey)) as { value?: unknown };
      if (typeof decrypted?.value !== "string") {
        return { ok: false, value: "", reason: "invalid_shape" };
      }
      return { ok: true, value: decrypted.value, layout: "v2-corejson" };
    } catch {
      return { ok: false, value: "", reason: "decrypt_failed" };
    }
  }

  // enc:v1: — 先试 shop/core-json，再试 lottery raw-string
  const body = value.slice(SECRET_CONFIG_PREFIX_V1.length);
  if (!body) return { ok: false, value: "", reason: "empty_payload" };

  try {
    const decrypted = (await decrypt(body, encryptionKey)) as { value?: unknown };
    if (typeof decrypted?.value === "string") {
      return { ok: true, value: decrypted.value, layout: "v1-corejson" };
    }
  } catch {
    // fall through to raw
  }

  try {
    const raw = await decryptRawString(body, encryptionKey);
    return { ok: true, value: raw, layout: "v1-raw" };
  } catch {
    return { ok: false, value: "", reason: "decrypt_failed" };
  }
}

/**
 * 兼容旧调用方：失败返回空字符串（与历史 shop/lottery 行为一致）。
 * 需要区分失败原因时请用 `decryptSecretConfigResult`。
 */
export async function decryptSecretConfigValue(value: string, encryptionKey?: string): Promise<string> {
  const result = await decryptSecretConfigResult(value, encryptionKey);
  return result.value;
}

export type SecretDecryptObserveEvent = {
  ok: false;
  reason: SecretDecryptFail["reason"];
  /** 是否带 enc: 前缀（用于区分「明文空」与「密文失败」） */
  encrypted: boolean;
};

/**
 * 与 decryptSecretConfigValue 相同的返回值语义，但失败时调用 onFail（永不传入明文/密文内容）。
 * 产品侧应在 admin/runtime 读配置路径使用本函数以满足「解密失败可观测」。
 */
export async function decryptSecretConfigValueObserved(
  value: string,
  encryptionKey: string | undefined,
  onFail?: (event: SecretDecryptObserveEvent) => void,
): Promise<string> {
  const result = await decryptSecretConfigResult(value, encryptionKey);
  if (!result.ok) {
    const encrypted =
      value.startsWith(SECRET_CONFIG_PREFIX_V2_CORE_JSON) || value.startsWith(SECRET_CONFIG_PREFIX_V1);
    onFail?.({ ok: false, reason: result.reason, encrypted });
  }
  return result.value;
}

/**
 * 仅测试/迁移：生成 lottery 历史 raw 布局密文（`enc:v1:` + raw AES）。
 * 生产新写入请用 `encryptSecretConfigValue`（v2）。
 */
export async function encryptSecretConfigValueLegacyRaw(
  value: string,
  encryptionKey: string,
): Promise<string> {
  if (!value) return "";
  if (!isValidSecretEncryptionKey(encryptionKey)) throw new Error("敏感配置加密密钥无效");
  return `${SECRET_CONFIG_PREFIX_V1}${await encryptRawString(value, encryptionKey)}`;
}

/**
 * 仅测试/迁移：生成 shop 历史 v1+core-json 布局。
 */
export async function encryptSecretConfigValueLegacyV1CoreJson(
  value: string,
  encryptionKey: string,
): Promise<string> {
  if (!value) return "";
  if (!isValidSecretEncryptionKey(encryptionKey)) throw new Error("敏感配置加密密钥无效");
  return `${SECRET_CONFIG_PREFIX_V1}${await encrypt({ value }, encryptionKey)}`;
}

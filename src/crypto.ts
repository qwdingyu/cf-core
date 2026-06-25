/**
 * AES-256-GCM 加解密模块
 *
 * 使用 Web Crypto API（Workers 原生），零外部依赖。
 * 凭据在写入数据库前加密，读取后解密，确保数据库中不存明文。
 *
 * 密钥来源：环境变量（32 字节 hex = 64 字符 = 256 bit）
 * 格式：iv(12B) + ciphertext + authTag(16B)，整体 base64 编码存储
 *
 * 来源：xtools src/lib/crypto.ts
 */

const ALGO = "AES-GCM";
const IV_LENGTH = 12;

/** 安全地将 Uint8Array 编码为 base64（分块避免大数组展开栈溢出） */
function arrayToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(""));
}

/** 安全地将 base64 解码为 Uint8Array */
function base64ToArray(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 从 hex 字符串导入 AES-256-GCM 密钥 */
async function importKey(rawHex: string): Promise<CryptoKey> {
  if (!rawHex || rawHex.length !== 64) {
    throw new Error("加密密钥必须为 64 字符 hex（32 字节 / 256 bit）");
  }
  const keyBytes = new Uint8Array(rawHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.importKey("raw", keyBytes, { name: ALGO }, false, ["encrypt", "decrypt"]);
}

/**
 * 加密 JSON 对象 → base64 字符串
 */
export async function encrypt(
  data: Record<string, unknown>,
  encryptionKeyHex: string,
): Promise<string> {
  const key = await importKey(encryptionKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));

  const cipherBuffer = await crypto.subtle.encrypt({ name: ALGO, iv }, key, plaintext);

  const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), iv.length);

  return arrayToBase64(combined);
}

/**
 * 解密 base64 字符串 → JSON 对象
 */
export async function decrypt(
  encryptedBase64: string,
  encryptionKeyHex: string,
): Promise<Record<string, unknown>> {
  const key = await importKey(encryptionKeyHex);

  const combined = base64ToArray(encryptedBase64);
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const plainBuffer = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plainBuffer));
}

/**
 * 检查加密密钥是否已配置
 */
export function isEncryptionAvailable(env: { CREDENTIALS_ENCRYPTION_KEY?: string }): boolean {
  return !!(env.CREDENTIALS_ENCRYPTION_KEY && env.CREDENTIALS_ENCRYPTION_KEY.length === 64);
}

/**
 * 生成 UUID v4（兼容 Cloudflare Workers）
 *
 * 使用 crypto.getRandomValues()（100% Workers 支持），
 * 不依赖 crypto.randomUUID()（部分旧版本不支持）。
 */
export function generateUUID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // v4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

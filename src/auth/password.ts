/**
 * 密码哈希模块（PBKDF2-HMAC-SHA256）
 *
 * 纯 Web Crypto API 实现，零外部依赖。
 * - 100,000 次迭代（OWASP 推荐最低值）
 * - 16 字节随机 salt
 * - 32 字节（256 bit）哈希输出
 *
 * 来源：xtools src/lib/auth.ts
 */

const ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const HASH_LENGTH = 32;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * 哈希密码
 *
 * @param password - 明文密码
 * @param saltHex - 盐值 hex（可选，不提供则自动生成）
 * @returns { hash, salt } — 均为 hex 字符串
 */
export async function hashPassword(
  password: string,
  saltHex?: string,
): Promise<{ hash: string; salt: string }> {
  const salt = saltHex
    ? fromHex(saltHex)
    : crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    HASH_LENGTH * 8,
  );

  return { hash: toHex(new Uint8Array(hashBuffer)), salt: toHex(salt) };
}

/**
 * 验证密码 — 恒定时间比较（防 timing attack）
 */
export async function verifyPassword(
  password: string,
  hashHex: string,
  saltHex: string,
): Promise<boolean> {
  const result = await hashPassword(password, saltHex);
  if (result.hash.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < result.hash.length; i++) {
    diff |= result.hash.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return diff === 0;
}

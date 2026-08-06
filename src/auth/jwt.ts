/**
 * JWT 签发与验证（HMAC-SHA256）
 *
 * 纯 Web Crypto API 实现，零外部依赖。
 * Workers 原生支持，性能优异。
 *
 * 来源：xtools src/lib/auth.ts
 * 泛型 claims 版（signJwtWithClaims/verifyJwtClaims）：docs/091 P0-4，
 * 收敛 cf-lottery 等因固定 payload 受限而自研的自由 claims 实现。
 */

export interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

/** 泛型 claims：任意字符串/数字/布尔字段（如 tenantId/role），签发时自动注入 iat/exp */
export type JwtClaims = Record<string, string | number | boolean>;

/** 泛型验证结果：调用方 claims + 系统注入的 iat/exp */
export type JwtClaimsVerified = JwtClaims & { iat: number; exp: number };

const DEFAULT_EXPIRY = 24 * 60 * 60; // 24 小时

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = 4 - (base64.length % 4);
  if (padding !== 4) base64 += "=".repeat(padding);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * 签发 JWT（固定 sub/email payload，兼容旧调用方）
 */
export async function signJwt(
  userId: string,
  email: string,
  secret: string,
  expirySeconds = DEFAULT_EXPIRY,
): Promise<string> {
  return signJwtWithClaims({ sub: userId, email }, secret, expirySeconds);
}

/**
 * 签发 JWT（泛型 claims：任意字段，如 tenantId/role；自动注入 iat/exp）
 *
 * docs/091 P0-4：替代 cf-lottery 本地自由 claims 版（Record<string, any>），
 * 提供类型安全的泛型 payload；sub/email 不再是强制的固定结构。
 */
export async function signJwtWithClaims(
  payload: JwtClaims,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + ttlSeconds };

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${header}.${body}`;

  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * 验证并解析 JWT（固定 JwtPayload 形状）— 验证失败返回 null
 */
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const claims = await verifyJwtClaims(token, secret);
  if (!claims) return null;
  if (typeof claims.sub !== "string" || typeof claims.email !== "string") return null;
  return { sub: claims.sub, email: claims.email, iat: claims.iat, exp: claims.exp };
}

/**
 * 验证并解析 JWT（泛型 claims）— 验证失败返回 null
 *
 * 调用方读取自己的 claims（如 claims.tenantId），系统字段 iat/exp 已校验。
 */
export async function verifyJwtClaims(
  token: string,
  secret: string,
): Promise<JwtClaimsVerified | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const signingInput = `${header}.${body}`;

    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(signature),
      new TextEncoder().encode(signingInput),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as JwtClaimsVerified;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * 从请求中提取 JWT Token
 *
 * 优先级：Authorization: Bearer > Cookie: token=
 */
export function extractJwt(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token.split(".").length === 3) return token;
  }
  const cookie = c.req.header("Cookie");
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 免费层密码哈希（HMAC SHA-256 + pepper，docs/091 P1-8）
// cf-lottery 针对 10ms CPU 硬约束的自研方案，与 PBKDF2 有意分歧。
// Worker 环境可用，无需额外依赖。
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * HMAC SHA-256 密码哈希（带 pepper）。
 * 比 PBKDF2 快 ~50x（<1ms vs ~50ms），适合免费层 CPU 受限场景。
 */
export async function hashPasswordWithPepper(
  password: string,
  pepper: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(password));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 安全比较两个密码哈希（constant-time）。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

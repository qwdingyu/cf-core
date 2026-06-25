/**
 * JWT 签发与验证（HMAC-SHA256）
 *
 * 纯 Web Crypto API 实现，零外部依赖。
 * Workers 原生支持，性能优异。
 *
 * 来源：xtools src/lib/auth.ts
 */

export interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

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
 * 签发 JWT
 */
export async function signJwt(
  userId: string,
  email: string,
  secret: string,
  expirySeconds = DEFAULT_EXPIRY,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = { sub: userId, email, iat: now, exp: now + expirySeconds };

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;

  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * 验证并解析 JWT — 验证失败返回 null
 */
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
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

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

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

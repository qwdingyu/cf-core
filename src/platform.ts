/**
 * 双平台适配层（CF Workers / Node）。
 *
 * 文档 091 P0-6：cf-lottery / cf-shop 各有自研 platform.ts，
 * 统一到 cf-core 消除重复。信任头开关参数化。
 */
import type { Context } from "hono";

/**
 * getClientIp — 从请求中提取客户端真实 IP。
 * 仅当 trustProxyHeaders=true 时信任 X-Forwarded-For。
 */
export function getClientIp(
  c: Context<{ Bindings?: Record<string, string | undefined> }>,
  trustProxyHeaders = false,
): string {
  if (trustProxyHeaders) {
    const xff = c.req.header("X-Forwarded-For");
    if (xff) return xff.split(",")[0]!.trim();
  }
  // CF Workers: CF-Connecting-IP
  const cf = c.req.header("CF-Connecting-IP");
  if (cf) return cf.trim();
  // Fallback
  return c.req.header("X-Real-IP") || c.env?.remoteAddr || "127.0.0.1";
}

/**
 * getEnv — 从 c.env 安全读取环境变量，未定义返回空串。
 */
export function getEnv(
  c: Context<{ Bindings?: Record<string, string | undefined> }>,
  key: string,
): string {
  return (c.env as Record<string, string | undefined>)?.[key] ?? "";
}

/**
 * waitUntil — 平台无关的 waitUntil。
 * Workers 用 ctx.waitUntil，Node 用 setTimeout 降级。
 */
export function waitUntil(
  c: Context<{ Bindings?: Record<string, string | undefined> }>,
  p: Promise<unknown>,
): void {
  try {
    const ctx = c.executionCtx as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
    if (ctx?.waitUntil) {
      ctx.waitUntil(p);
    } else {
      // Node 环境降级：不阻塞响应，静默 fire-and-forget
      p.catch(() => {});
    }
  } catch {
    p.catch(() => {});
  }
}

/**
 * getTruncatedBody — 安全读 body（最多 size 字节）。
 */
export async function getTruncatedBody(req: Request, maxSize = 65536): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (total < maxSize) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
  } catch { /* ignore */ }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

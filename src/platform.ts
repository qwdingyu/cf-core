/**
 * 双平台适配层（CF Workers / Node）。
 *
 * 文档 091 P0-6：cf-lottery / cf-shop 各有自研 platform.ts，
 * 统一到 cf-core 消除重复。信任头开关参数化。
 */
import type { Context } from "hono";

/**
 * getClientIp — 从请求中提取客户端真实 IP。
 *
 * ── 信任模型 ──
 * ① Workers 环境：CF-Connecting-IP 由 Cloudflare 边缘注入，客户端**不可伪造** → 始终信任。
 * ② Node/VPS 环境：CF-Connecting-IP 可由客户端伪造！
 *   - 默认**不信任**该头（是 Workers 专属头，Node 中不可信）
 *   - 仅 trustProxyHeaders=true 时才信任 X-Forwarded-For/X-Real-IP
 *   - 这是 fail-safe 默认：避免攻击者伪造 X-Forwarded-For 绕过 IP 限流
 *
 * ── 环境自动检测 ──
 * Node 环境判断：`typeof process !== "undefined" && process.versions?.node`。
 * Workers 环境无 process 对象，该检测返回 false。
 */
export function getClientIp(
  c: Context<{ Bindings?: Record<string, string | undefined> }>,
  trustProxyHeaders = false,
): string {
  // 环境检测：typeof process 在 Workers 中不存在（无 Node 类型定义）
  const isNode = typeof (globalThis as any).process !== "undefined" && Boolean((globalThis as any).process?.versions?.node);

  // CF-Connecting-IP：仅 Workers 环境可信
  const cf = c.req.header("CF-Connecting-IP");
  if (cf && !isNode) return cf.trim(); // Workers：平台注入，无条件信任

  if (trustProxyHeaders) {
    const xff = c.req.header("X-Forwarded-For");
    if (xff) return xff.split(",")[0]!.trim();
    const xri = c.req.header("X-Real-IP");
    if (xri) return xri.trim();
  }

  // 无可信来源 → "127.0.0.1"（fail-safe）
  return "127.0.0.1";
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

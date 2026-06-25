/**
 * HTTP 响应工具模块
 *
 * 提供统一的 ok/fail 响应格式，以及常用的请求解析工具。
 * 泛型设计：兼容任意 Hono AppEnv 类型，无需绑定特定项目。
 *
 * 来源：eshop/xtools/vcode 三项目 lib/http.ts 合并
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { RateLimitResult } from "./types.js";

/**
 * 成功响应 — 统一格式 { ok: true, ...data }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ok(
  c: Context<any>,
  data: Record<string, unknown>,
  status: ContentfulStatusCode = 200,
) {
  return c.json({ ok: true, ...data } as Record<string, unknown>, status);
}

/**
 * 失败响应 — 统一格式 { ok: false, error: message }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fail(
  c: Context<any>,
  message: string,
  status: number = 400,
  details?: unknown,
) {
  return c.json(
    { ok: false, error: message, ...(details ? { details } : {}) } as Record<string, unknown>,
    status as ContentfulStatusCode,
  );
}

/**
 * 限流失败响应 — 429 + 标准 RateLimit 头
 *
 * 返回标准 HTTP 429 响应，包含以下头信息：
 * - Retry-After: 秒数（建议客户端等待时间）
 * - X-RateLimit-Limit: 窗口内允许的最大请求数
 * - X-RateLimit-Remaining: 窗口内剩余请求数（0）
 * - X-RateLimit-Reset: 窗口重置的 Unix 时间戳
 *
 * @example
 * ```ts
 * const result = await rateLimiter.check(key, limit, windowMs);
 * if (!result.ok) {
 *   return failRateLimit(c, result, limit);
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function failRateLimit(
  c: Context<any>,
  result: RateLimitResult,
  limit: number,
) {
  const retryAfterSeconds = Math.ceil((result.resetMs || 0) / 1000);
  const resetTimestamp = Math.ceil((Date.now() + (result.resetMs || 0)) / 1000);

  return c.json(
    { ok: false, error: result.message || "请求过于频繁，请稍后再试" },
    429,
    {
      "Retry-After": String(retryAfterSeconds),
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(resetTimestamp),
    },
  );
}

/**
 * 获取站点域名 — 优先使用环境变量 APP_ORIGIN，降级使用请求 URL
 */
export function getOrigin<E extends { Bindings: { APP_ORIGIN?: string } }>(c: Context<E>): string {
  return c.env.APP_ORIGIN || new URL(c.req.url).origin;
}

/**
 * 安全读取 JSON body — 解析失败返回 undefined（避免非 JSON 请求体导致 400）
 *
 * 支持泛型，让调用方可以明确 JSON 形状，避免下游 zod safeParse 的 unknown 类型报错。
 * 默认类型为 unknown，保持向后兼容。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function safeJsonBody<T = unknown>(c: Context<any>): Promise<T> {
  return c.req.json().catch(() => undefined) as Promise<T>;
}

/**
 * 联系方式脱敏 — 用于管理端展示
 *
 * - 邮箱：ab***@example.com
 * - 手机/其他：ab***cd
 * - 长度 ≤ 4：***
 */
export function maskContact(value: string): string {
  const text = value.trim();
  if (text.length <= 4) return "***";
  if (text.includes("@") && !text.startsWith("@")) {
    const [name, domain] = text.split("@");
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

/**
 * 标准化编码 — trim + lowercase（用于优惠码/折扣码等）
 */
export function normalizeCode(value?: string): string {
  return (value || "").trim().toLowerCase();
}

/**
 * CSV 注入防护 — 对导出值做安全转义
 *
 * 如果值以 = + - @ \t \n 开头，前置制表符阻止公式注入。
 * 来源：eshop admin 订单导出
 */
export function csvEscape(value: unknown): string {
  const str = String(value ?? "");
  if (/^[=+\-@\t\n]/.test(str)) {
    return `\t${str}`;
  }
  return str;
}

/**
 * 将对象数组导出为 CSV 字符串
 */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",");
  const body = rows.map((row) =>
    columns.map((col) => {
      const val = csvEscape(row[col]);
      return val.includes(",") || val.includes('"') || val.includes("\n")
        ? `"${val.replace(/"/g, '""')}"`
        : val;
    }).join(","),
  ).join("\n");
  return `${header}\n${body}`;
}

/**
 * 无业务语义的小工具（分页/邮箱格式等）。
 * 产品可直接使用，或从本地 http 薄封装 re-export。
 */

/**
 * 整型钳位 + NaN 防护。
 * 用于 query/body 中的 limit、offset、count 等字段。
 */
export function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

/**
 * 轻量 email 格式校验（比 includes("@") 严，不替代 RFC 完整解析）。
 * 写入 DB 前的第一道门禁。
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

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

/**
 * canonicalEmail — 邮箱归一化（docs/091 P1-12）。
 * Gmail: 去点号、去加号别名、统一 @gmail.com / @googlemail.com。
 * 其他：仅 trim + toLowerCase。cf-shop 三处同一口径，统一到此函数。
 */
export function canonicalEmail(email: string): string {
  let e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0) return e;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return local.replace(/\./g, "").replace(/\+.*$/, "") + "@gmail.com";
  }
  return e;
}

/**
 * 管理员认证中间件
 *
 * 支持两种认证方式：
 * 1. Bearer Token（eshop/vcode 方式）：Authorization: Bearer <token>
 * 2. 自定义 Header（xtools 方式）：X-Admin-Token: <token>
 *
 * 安全措施：
 * - 时序安全比较（timingSafeEqual）防时序攻击
 * - 默认 Token 仅限本地地址使用
 * - 未配置 ADMIN_TOKEN 时返回 503
 *
 * 来源：eshop requireAdmin + xtools adminAuthMiddleware 合并
 */

import type { Context, Next } from "hono";
import { fail } from "../http.js";
import { constantTimeEqual, getBearerToken } from "../security.js";

export interface AdminAuthOptions {
  /**
   * Token 提取方式：
   * - "bearer" — 从 Authorization: Bearer 提取（eshop/vcode 默认）
   * - "header" — 从 X-Admin-Token 提取（xtools 默认）
   * - "both" — 两种方式都尝试（兼容模式）
   */
  mode?: "bearer" | "header" | "both";
}

/**
 * 创建管理员认证中间件
 *
 * @example
 * // eshop/vcode 风格
 * app.route("/admin", new Hono().use("*", createAdminAuth()).route("/", adminRoutes));
 *
 * // xtools 风格
 * app.use("/api/admin/*", createAdminAuth({ mode: "header" }));
 */
export function createAdminAuth(options: AdminAuthOptions = {}) {
  const { mode = "both" } = options;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (c: Context<any>, next: Next) => {
    const expected = c.env.ADMIN_TOKEN;
    if (!expected) return fail(c, "管理员令牌未配置", 503);

    // 安全检查：默认 Token 仅限本地
    const hostname = new URL(c.req.url).hostname;
    if (
      expected === "dev-only-change-me" &&
      !["127.0.0.1", "localhost", "::1"].includes(hostname)
    ) {
      return fail(c, "生产环境必须配置 ADMIN_TOKEN", 503);
    }

    // 提取 Token
    let actual = "";
    if (mode === "bearer" || mode === "both") {
      actual = getBearerToken(c);
    }
    if (!actual && (mode === "header" || mode === "both")) {
      actual = c.req.header("X-Admin-Token") || "";
    }

    if (!actual) return fail(c, "未授权", 401);
    if (!constantTimeEqual(expected, actual)) return fail(c, "未授权", 401);

    await next();
  };
}

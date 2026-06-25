/**
 * Worker 入口工厂
 *
 * 将三项目 index.ts 中高度重复的 Worker 启动逻辑抽象为统一工厂函数：
 * - 数据库初始化中间件
 * - 请求体大小限制
 * - 安全响应头注入
 * - API 路由 / 静态资源分流
 * - 全局错误处理
 *
 * 来源：eshop/xtools/vcode 三项目 index.ts 入口合并
 */

import { Hono } from "hono";
import { initDatabaseWithHealthCheck, type DrizzleInstance } from "./db/connection";
import { fail } from "./http";
import { buildSecurityHeaders, type SecurityHeadersOptions } from "./security";

export interface BootstrapOptions<TSchema extends Record<string, unknown> = Record<string, never>> {
  /** Drizzle schema（传入后支持关系查询） */
  schema?: TSchema;

  /** API 路由前缀，默认 "/api" */
  apiPrefix?: string;

  /** 请求体大小限制（字节），默认 100KB */
  maxBodySize?: number;

  /**
   * 请求级超时（毫秒），默认 25000（25 秒）。
   * Cloudflare Workers 硬限制 30 秒，留 5 秒余量给 CF 运行时。
   * 超时后请求会被中止并返回 504 Gateway Timeout。
   */
  requestTimeoutMs?: number;

  /** 安全响应头配置 */
  securityHeaders?: SecurityHeadersOptions;

  /**
   * 错误告警回调 — 生产环境错误通知。
   * 当请求处理过程中发生未捕获错误时调用，可用于发送到外部告警系统
   * （如 Slack webhook、邮件、PagerDuty 等）。
   *
   * @example
   * ```ts
   * onErrorAlert: async (error, context) => {
   *   await fetch("https://hooks.slack.com/...", {
   *     method: "POST",
   *     body: JSON.stringify({ text: `[ERROR] ${error.message}` }),
   *   });
   * }
   * ```
   */
  onErrorAlert?: (error: Error, context: { path: string; method: string; ip?: string }) => void | Promise<void>;

  /** 注册 API 路由的回调 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerRoutes: (api: Hono<any>) => void;

  /**
   * 静态资源路由表 — 页面路径到 HTML 文件的映射
   * @example { "/admin": "/admin.html", "/shop": "/index.html" }
   */
  pageRoutes?: Record<string, string>;

  /**
   * SPA 路由 — 这些路径都返回同一个 HTML 文件
   * @example { fallback: "/_app/index.html", paths: ["/shop", "/order"] }
   */
  spaRoutes?: {
    fallback: string;
    paths: string[];
  };

  /**
   * 长缓存路径前缀（如 /_app/assets/）
   * 匹配的路径会设置 Cache-Control: immutable, max-age=31536000
   */
  immutablePrefixes?: string[];
}

/**
 * 创建 Cloudflare Workers 应用
 *
 * 返回标准的 Workers fetch handler 导出对象。
 *
 * @example
 * ```ts
 * import * as schema from "./db/schema";
 * import { bootstrap } from "@eforge/cf-core/bootstrap";
 *
 * export default bootstrap({
 *   schema,
 *   registerRoutes: (api) => {
 *     api.route("/products", productRoutes);
 *     api.route("/orders", orderRoutes);
 *   },
 *   pageRoutes: { "/admin": "/admin.html" },
 *   spaRoutes: { fallback: "/_app/index.html", paths: ["/shop", "/order"] },
 *   immutablePrefixes: ["/_app/assets/"],
 * });
 * ```
 */
/** 生成友好的 HTML 错误页面（内联 CSS，无外部依赖） */
function errorPageHtml(status: number, message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${status} - ${message}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f0f0f;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.container{text-align:center;max-width:480px}
.code{font-size:6rem;font-weight:800;background:linear-gradient(135deg,#6c63ff,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;line-height:1}
.msg{font-size:1.25rem;color:#888;margin:1rem 0 2rem}
a{color:#6c63ff;text-decoration:none;font-weight:500}
a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="container">
<p class="code">${status}</p>
<p class="msg">${message}</p>
<a href="/">← 返回首页</a>
</div>
</body>
</html>`;
}

export function bootstrap<TSchema extends Record<string, unknown>>(
  options: BootstrapOptions<TSchema>,
) {
  const {
    schema,
    apiPrefix = "/api",
    maxBodySize = 1024 * 100,
    requestTimeoutMs = 25_000,
    securityHeaders: secOpts = {},
    onErrorAlert,
    registerRoutes,
    pageRoutes = {},
    spaRoutes,
    immutablePrefixes = [],
  } = options;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = new Hono<any>();

  // ── 请求级超时中间件（防止慢请求耗尽 Workers CPU） ──
  api.use("*", async (c, next) => {
    // /health 不受超时限制（用于监控探活）
    if (c.req.path === "/health") {
      await next();
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      // 将 signal 传递给下游（路由可选择性使用）
      c.set("abortSignal", controller.signal);
      await next();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        console.error(`[bootstrap:timeout] 请求超时 ${requestTimeoutMs}ms: ${c.req.method} ${c.req.path}`);
        return fail(c, "请求处理超时", 504);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  });

  // ── DB 初始化中间件（带连接验证 + 重试） ──
  api.use("*", async (c, next) => {
    const isHealth = c.req.path === "/health";
    try {
      const db = await initDatabaseWithHealthCheck(c.env.TURSO_URL, c.env.TURSO_TOKEN, schema);
      c.set("db", db);
      if ("executionCtx" in c) {
        c.set("executionCtx", c.env.executionCtx);
      }
      await next();
    } catch (err) {
      console.error("[bootstrap:db-init]", err);
      if (isHealth) {
        c.set("db", undefined);
        await next();
        return;
      }
      return fail(c, "服务暂时不可用", 503);
    }
  });

  // ── 请求体大小限制 ──
  api.use("*", async (c, next) => {
    const len = parseInt(c.req.header("content-length") || "0");
    if (len > maxBodySize) return fail(c, `请求体过大（最大 ${Math.floor(maxBodySize / 1024)}KB）`, 413);
    await next();
  });

  // ── 注册业务路由 ──
  registerRoutes(api);

  // ── 404 + 全局错误（浏览器返回 HTML，API 返回 JSON） ──
  api.notFound((c) => {
    const accept = c.req.header("accept") || "";
    if (accept.includes("text/html")) {
      return c.html(errorPageHtml(404, "页面未找到"), 404);
    }
    return fail(c, "API not found", 404);
  });
  api.onError((error, c) => {
    console.error("[bootstrap:onError]", error?.constructor?.name, error?.message, error?.stack);

    // 触发告警回调（如果配置了）
    if (onErrorAlert) {
      const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
      // 异步发送告警，不阻塞响应
      Promise.resolve(onErrorAlert(error as Error, {
        path: c.req.path,
        method: c.req.method,
        ip,
      })).catch((alertErr) => {
        console.error("[bootstrap:onErrorAlert] 告警发送失败:", alertErr);
      });
    }

    const accept = c.req.header("accept") || "";
    if (accept.includes("text/html")) {
      return c.html(errorPageHtml(500, "服务暂时不可用"), 500);
    }
    return fail(c, "服务暂时不可用", 500, { error: error?.message });
  });

  // ── 预计算安全响应头 ──
  const defaultHeaders = buildSecurityHeaders(secOpts);
  const adminHeaders = buildSecurityHeaders({ ...secOpts, allowUnsafeEval: true });

  function applyHeaders(response: Response, isImmutable = false, isAdmin = false): Response {
    const headers = new Headers(response.headers);
    const base = isAdmin ? adminHeaders : defaultHeaders;
    for (const [k, v] of base) headers.set(k, v);
    if (isImmutable) {
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  return {
    async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
      try {
        const url = new URL(request.url);
        const path = url.pathname;

        // API 路由 → Hono
        const prefix = apiPrefix.replace(/\/$/, "");
        if (path === prefix || path.startsWith(`${prefix}/`)) {
          url.pathname = path.replace(new RegExp(`^${prefix}`), "") || "/";
          return api.fetch(new Request(url, request), env, ctx);
        }

        // 静态资源处理需要 ASSETS binding
        const assets = env.ASSETS as Fetcher | undefined;
        if (!assets) {
          return new Response(JSON.stringify({ ok: false, error: "ASSETS binding not configured" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        // 长缓存静态资源
        if (immutablePrefixes.some((p) => path.startsWith(p))) {
          return applyHeaders(await assets.fetch(request), true);
        }

        // 页面路由（pageRoutes 精确匹配）
        for (const [route, file] of Object.entries(pageRoutes)) {
          if (path === route || path.startsWith(`${route}/`)) {
            url.pathname = file;
            const isAdmin = route === "/admin" || route.startsWith("/admin");
            return applyHeaders(await assets.fetch(new Request(url, request)), false, isAdmin);
          }
        }

        // SPA 路由
        if (spaRoutes && spaRoutes.paths.some((p) => path === p || path.startsWith(`${p}/`))) {
          url.pathname = spaRoutes.fallback;
          const res = await assets.fetch(new Request(url, request));
          if (res.ok) return applyHeaders(res);
          url.pathname = "/index.html";
          return applyHeaders(await assets.fetch(new Request(url, request)));
        }

        // 根路径
        if (path === "/") {
          url.pathname = "/index.html";
          return applyHeaders(await assets.fetch(new Request(url, request)));
        }

        // 其他静态资源
        return applyHeaders(await assets.fetch(request));
      } catch (err) {
        console.error("[bootstrap:fetch]", err);
        const accept = request.headers.get("accept") || "";
        if (accept.includes("text/html")) {
          return new Response(errorPageHtml(500, "服务暂时不可用"), {
            status: 500,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return new Response(JSON.stringify({ ok: false, error: "服务暂时不可用" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    },
  };
}

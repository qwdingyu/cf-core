import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootstrap } from "../src/bootstrap.js";

// ── Mock DB 连接 ──
vi.mock("../src/db/connection", () => ({
  initDatabaseWithHealthCheck: vi.fn().mockResolvedValue({ mock: true }),
}));

// ── 辅助函数 ──
function createApp(opts = {}) {
  return bootstrap({
    registerRoutes: (api) => {
      api.get("/health", (c) => c.json({ status: "ok" }));
      api.get("/test", (c) => c.json({ ok: true }));
      api.get("/error", () => {
        throw new Error("boom");
      });
    },
    pageRoutes: { "/admin": "/admin.html" },
    spaRoutes: { fallback: "/_app/index.html", paths: ["/shop"] },
    immutablePrefixes: ["/_app/assets/"],
    ...opts,
  });
}

function mockAssets(files: Record<string, string> = {}) {
  return {
    fetch: vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      const body = files[url.pathname] ?? `content:${url.pathname}`;
      return new Response(body, { status: 200 });
    }),
  };
}

const mockCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

// ═══════════════════════════════════════════════════════════════
// 测试组 1: API 路由分流
// ═══════════════════════════════════════════════════════════════
describe("API 路由分流", () => {
  const app = createApp();
  const assets = mockAssets();
  const env = { ASSETS: assets, TURSO_URL: "libsql://test", TURSO_TOKEN: "tok" };

  it("GET /api/health → 200 JSON", async () => {
    const res = await app.fetch(new Request("https://x.com/api/health"), env, mockCtx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /api/test → 200 JSON", async () => {
    const res = await app.fetch(new Request("https://x.com/api/test"), env, mockCtx);
    expect(res.status).toBe(200);
    expect((await res.json() as { ok: boolean }).ok).toBe(true);
  });

  it("GET /api/unknown → 404 JSON（无 Accept: text/html）", async () => {
    const res = await app.fetch(new Request("https://x.com/api/nope"), env, mockCtx);
    expect(res.status).toBe(404);
    const body = await res.json() as { error?: string };
    expect(body.error).toContain("not found");
  });

  it("GET /api/unknown → 404 HTML（Accept: text/html）", async () => {
    const req = new Request("https://x.com/api/nope", { headers: { accept: "text/html" } });
    const res = await app.fetch(req, env, mockCtx);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("404");
    expect(html).toContain("<!DOCTYPE html>");
  });
});

// ═══════════════════════════════════════════════════════════════
// 测试组 2: 全局错误处理
// ═══════════════════════════════════════════════════════════════
describe("全局错误处理", () => {
  const app = createApp();
  const assets = mockAssets();
  const env = { ASSETS: assets, TURSO_URL: "libsql://test", TURSO_TOKEN: "tok" };

  it("API 抛错 → 500 JSON", async () => {
    const res = await app.fetch(new Request("https://x.com/api/error"), env, mockCtx);
    expect(res.status).toBe(500);
    const body = await res.json() as { error?: string };
    expect(body.error).toContain("暂时不可用");
  });

  it("API 抛错 + Accept HTML → 500 HTML", async () => {
    const req = new Request("https://x.com/api/error", { headers: { accept: "text/html" } });
    const res = await app.fetch(req, env, mockCtx);
    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).toContain("500");
    expect(html).toContain("<!DOCTYPE html>");
  });
});

// ═══════════════════════════════════════════════════════════════
// 测试组 3: 请求体大小限制
// ═══════════════════════════════════════════════════════════════
describe("请求体大小限制", () => {
  const app = createApp({ maxBodySize: 1024 });
  const assets = mockAssets();
  const env = { ASSETS: assets, TURSO_URL: "libsql://test", TURSO_TOKEN: "tok" };

  it("Content-Length 超限 → 413", async () => {
    const req = new Request("https://x.com/api/test", {
      method: "POST",
      headers: { "content-length": "9999" },
    });
    const res = await app.fetch(req, env, mockCtx);
    expect(res.status).toBe(413);
  });

  it("Content-Length 正常 → 通过", async () => {
    const req = new Request("https://x.com/api/test", {
      method: "POST",
      headers: { "content-length": "100" },
    });
    const res = await app.fetch(req, env, mockCtx);
    expect(res.status).not.toBe(413);
  });
});

// ═══════════════════════════════════════════════════════════════
// 测试组 4: 静态资源路由
// ═══════════════════════════════════════════════════════════════
describe("静态资源路由", () => {
  const app = createApp();
  const assets = mockAssets({ "/index.html": "<h1>Home</h1>", "/admin.html": "<h1>Admin</h1>" });
  const env = { ASSETS: assets, TURSO_URL: "libsql://test", TURSO_TOKEN: "tok" };

  it("GET / → 返回 index.html", async () => {
    const res = await app.fetch(new Request("https://x.com/"), env, mockCtx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>Home</h1>");
  });

  it("GET /admin → 返回 admin.html + admin 安全头", async () => {
    const res = await app.fetch(new Request("https://x.com/admin"), env, mockCtx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>Admin</h1>");
    // admin 页面允许 unsafe-eval
    expect(res.headers.get("Content-Security-Policy")).toContain("unsafe-eval");
  });

  it("无 ASSETS binding → 500", async () => {
    const res = await app.fetch(new Request("https://x.com/"), { TURSO_URL: "x" }, mockCtx);
    expect(res.status).toBe(500);
    const body = await res.json() as { error?: string };
    expect(body.error).toContain("ASSETS");
  });

  it("immutable 前缀路径 → Cache-Control immutable", async () => {
    const res = await app.fetch(new Request("https://x.com/_app/assets/app.js"), env, mockCtx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("immutable");
  });

  it("非 immutable 路径 → 无长缓存头", async () => {
    const res = await app.fetch(new Request("https://x.com/other.js"), env, mockCtx);
    const cc = res.headers.get("Cache-Control");
    expect(cc === null || !cc.includes("immutable")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 测试组 5: SPA 路由
// ═══════════════════════════════════════════════════════════════
describe("SPA 路由", () => {
  const app = createApp();
  const assets = mockAssets({
    "/_app/index.html": "<div id=app>",
    "/index.html": "<h1>Fallback</h1>",
  });
  const env = { ASSETS: assets, TURSO_URL: "libsql://test", TURSO_TOKEN: "tok" };

  it("GET /shop → 返回 SPA fallback", async () => {
    const res = await app.fetch(new Request("https://x.com/shop"), env, mockCtx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<div id=app>");
  });

  it("GET /shop/detail → 返回 SPA fallback（子路径）", async () => {
    const res = await app.fetch(new Request("https://x.com/shop/detail"), env, mockCtx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<div id=app>");
  });
});

// ═══════════════════════════════════════════════════════════════
// 测试组 6: 安全响应头
// ═══════════════════════════════════════════════════════════════
describe("安全响应头", () => {
  const app = createApp();
  const assets = mockAssets({ "/index.html": "ok" });
  const env = { ASSETS: assets, TURSO_URL: "libsql://test", TURSO_TOKEN: "tok" };

  it("所有响应包含 CSP 头", async () => {
    const res = await app.fetch(new Request("https://x.com/"), env, mockCtx);
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("所有响应包含 X-Content-Type-Options", async () => {
    const res = await app.fetch(new Request("https://x.com/"), env, mockCtx);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("所有响应包含 X-Frame-Options", async () => {
    const res = await app.fetch(new Request("https://x.com/"), env, mockCtx);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("所有响应包含 Permissions-Policy", async () => {
    const res = await app.fetch(new Request("https://x.com/"), env, mockCtx);
    expect(res.headers.get("Permissions-Policy")).toBeTruthy();
  });

  it("所有响应包含 Cross-Origin-Opener-Policy", async () => {
    const res = await app.fetch(new Request("https://x.com/"), env, mockCtx);
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });
});

// ═══════════════════════════════════════════════════════════════
// 测试组 7: DB 初始化失败降级
// ═══════════════════════════════════════════════════════════════
describe("DB 初始化失败降级", () => {
  it("非 health 请求 → 503", async () => {
    const { initDatabaseWithHealthCheck } = await import("../src/db/connection.js");
    vi.mocked(initDatabaseWithHealthCheck).mockRejectedValueOnce(new Error("DB down"));

    const app = createApp();
    const assets = mockAssets();
    const env = { ASSETS: assets, TURSO_URL: "libsql://bad", TURSO_TOKEN: "tok" };

    const res = await app.fetch(new Request("https://x.com/api/test"), env, mockCtx);
    expect(res.status).toBe(503);
  });

  it("health 请求 → 降级通过（db=undefined）", async () => {
    const { initDatabaseWithHealthCheck } = await import("../src/db/connection.js");
    vi.mocked(initDatabaseWithHealthCheck).mockRejectedValueOnce(new Error("DB down"));

    const app = bootstrap({
      registerRoutes: (api) => {
        api.get("/health", (c) => {
          const db = c.get("db");
          return c.json({ db: db ? "connected" : "disconnected" });
        });
      },
    });
    const assets = mockAssets();
    const env = { ASSETS: assets, TURSO_URL: "libsql://bad", TURSO_TOKEN: "tok" };

    const res = await app.fetch(new Request("https://x.com/api/health"), env, mockCtx);
    expect(res.status).toBe(200);
    const body = await res.json() as { db?: string };
    expect(body.db).toBe("disconnected");
  });
});

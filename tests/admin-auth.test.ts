import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createAdminAuth } from "../src/middleware/admin-auth";

// ── 辅助：创建带 admin-auth 中间件的 Hono 应用 ──
function createApp(mode?: "bearer" | "header" | "both") {
  const app = new Hono();
  app.use("*", createAdminAuth(mode ? { mode } : undefined));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

const env = { ADMIN_TOKEN: "secret-token-123" };
const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

// ═══════════════════════════════════════════════════════════════
describe("未配置 ADMIN_TOKEN", () => {
  it("→ 503 管理员令牌未配置", async () => {
    const app = createApp();
    const res = await app.fetch(req("https://x.com/test"), {}, ctx);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("令牌未配置");
  });
});

// ═══════════════════════════════════════════════════════════════
describe("默认 Token 安全检查", () => {
  const defaultEnv = { ADMIN_TOKEN: "dev-only-change-me" };

  it("localhost 允许使用默认 Token", async () => {
    const app = createApp();
    const res = await app.fetch(
      req("https://localhost/test", { authorization: "Bearer dev-only-change-me" }),
      defaultEnv,
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it("127.0.0.1 允许使用默认 Token", async () => {
    const app = createApp();
    const res = await app.fetch(
      req("https://127.0.0.1/test", { authorization: "Bearer dev-only-change-me" }),
      defaultEnv,
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it("非本地地址禁止使用默认 Token → 503", async () => {
    const app = createApp();
    const res = await app.fetch(
      req("https://production.example.com/test", { authorization: "Bearer dev-only-change-me" }),
      defaultEnv,
      ctx,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("生产环境");
  });
});

// ═══════════════════════════════════════════════════════════════
describe("Bearer 模式", () => {
  it("有效 Bearer Token → 200", async () => {
    const app = createApp("bearer");
    const res = await app.fetch(
      req("https://x.com/test", { authorization: "Bearer secret-token-123" }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it("无效 Bearer Token → 401", async () => {
    const app = createApp("bearer");
    const res = await app.fetch(
      req("https://x.com/test", { authorization: "Bearer wrong-token" }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it("无 Authorization 头 → 401", async () => {
    const app = createApp("bearer");
    const res = await app.fetch(req("https://x.com/test"), env, ctx);
    expect(res.status).toBe(401);
  });

  it("Bearer 模式忽略 X-Admin-Token", async () => {
    const app = createApp("bearer");
    const res = await app.fetch(
      req("https://x.com/test", { "X-Admin-Token": "secret-token-123" }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
describe("Header 模式", () => {
  it("有效 X-Admin-Token → 200", async () => {
    const app = createApp("header");
    const res = await app.fetch(
      req("https://x.com/test", { "X-Admin-Token": "secret-token-123" }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it("无效 X-Admin-Token → 401", async () => {
    const app = createApp("header");
    const res = await app.fetch(
      req("https://x.com/test", { "X-Admin-Token": "wrong" }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it("Header 模式忽略 Bearer", async () => {
    const app = createApp("header");
    const res = await app.fetch(
      req("https://x.com/test", { authorization: "Bearer secret-token-123" }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
describe("Both 模式（默认）", () => {
  it("Bearer 优先 → 200", async () => {
    const app = createApp("both");
    const res = await app.fetch(
      req("https://x.com/test", {
        authorization: "Bearer secret-token-123",
        "X-Admin-Token": "wrong",
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it("Bearer 无效但 Header 有效 → 仍 401（Bearer 已提取到值）", async () => {
    const app = createApp("both");
    const res = await app.fetch(
      req("https://x.com/test", {
        authorization: "Bearer wrong-token",
        "X-Admin-Token": "secret-token-123",
      }),
      env,
      ctx,
    );
    // both 模式下，Bearer 提取到了值（非空），就用 Bearer 的值比较
    expect(res.status).toBe(401);
  });

  it("无 Bearer，Header 有效 → 200", async () => {
    const app = createApp("both");
    const res = await app.fetch(
      req("https://x.com/test", { "X-Admin-Token": "secret-token-123" }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it("两者都没有 → 401", async () => {
    const app = createApp("both");
    const res = await app.fetch(req("https://x.com/test"), env, ctx);
    expect(res.status).toBe(401);
  });
});

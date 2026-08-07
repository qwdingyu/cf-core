import { describe, it, expect, vi, afterEach } from "vitest";
import { EmailService, interpolate } from "../features/email/index.js";
import type { EmailChannelConfig, EmailConfigProvider, EmailLogEntry } from "../features/email/index.js";

/** 构造 Resend mock 响应 */
function resendResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resendChannel(id: string, priority: number, secret: string): EmailChannelConfig {
  return { id, provider: "resend", priority, secret };
}

const CHANNEL_PROVIDER: EmailConfigProvider = {
  listEnabled: async () => [
    resendChannel("c1", 1, "k1"),
    resendChannel("c2", 2, "k2"),
  ],
};

describe("EmailService — 单 Resend 路径", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("成功发送返回 messageId，且只调用一次 fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resendResponse(200, { id: "msg_123" }));
    vi.stubGlobal("fetch", fetchMock);

    const svc = new EmailService({ apiKey: "k", from: "shop <noreply@example.com>" });
    const r = await svc.send({ to: "a@b.com", subject: "s", html: "h" });

    expect(r).toEqual({ ok: true, messageId: "msg_123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 校验请求头带 Bearer token 与 JSON 内容类型
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer k");
    expect(headers.get("content-type")).toContain("application/json");
  });

  it("无效收件人直接失败，不发起 fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const svc = new EmailService({ apiKey: "k" });
    const r = await svc.send({ to: "not-an-email", subject: "s", html: "h" });

    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("未配置密钥或通道时返回明确错误", async () => {
    const svc = new EmailService({});
    const r = await svc.send({ to: "a@b.com", subject: "s", html: "h" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("所有邮件通道均不可用（未配置 remote / Cloudflare / configProvider / Resend）");
  });

  it("4xx + data.message（如 invalid api key）不重试（P2 回归）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resendResponse(401, { message: "invalid api key" }));
    vi.stubGlobal("fetch", fetchMock);

    const svc = new EmailService({ apiKey: "k", maxRetries: 3 });
    const r = await svc.send({ to: "a@b.com", subject: "s", html: "h" });

    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.error).toBe("invalid api key");
    // 4xx 不重试：只调用一次
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("4xx 且无 data.message 时不重试", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resendResponse(422, {}));
    vi.stubGlobal("fetch", fetchMock);

    const svc = new EmailService({ apiKey: "k", maxRetries: 3 });
    const r = await svc.send({ to: "a@b.com", subject: "s", html: "h" });

    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("5xx 重试 maxRetries+1 次后仍失败", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resendResponse(500, { message: "internal error" }));
    vi.stubGlobal("fetch", fetchMock);

    const svc = new EmailService({ apiKey: "k", maxRetries: 1 });
    const r = await svc.send({ to: "a@b.com", subject: "s", html: "h" });

    expect(r.ok).toBe(false);
    // 1 次初始调用 + 1 次重试
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("网络错误重试后仍失败", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const svc = new EmailService({ apiKey: "k", maxRetries: 1 });
    const r = await svc.send({ to: "a@b.com", subject: "s", html: "h" });

    expect(r.ok).toBe(false);
    expect(r.error).toBe("network down");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("EmailService — 多通道容错链", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("第一个通道失败时自动回退到第二个通道", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resendResponse(500, { message: "c1 down" }))
      .mockResolvedValueOnce(resendResponse(200, { id: "msg_2" }));
    vi.stubGlobal("fetch", fetchMock);

    const svc = new EmailService({ configProvider: CHANNEL_PROVIDER, maxRetries: 0 });
    const r = await svc.send({ to: "a@b.com", subject: "s", html: "h" });

    expect(r).toEqual({ ok: true, messageId: "msg_2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("所有通道失败时返回最后错误", async () => {
    // Response body 只能读一次：每个通道必须返回独立 Response 实例
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resendResponse(503, { message: "all down" }))
      .mockResolvedValueOnce(resendResponse(503, { message: "all down" }));
    vi.stubGlobal("fetch", fetchMock);

    const svc = new EmailService({ configProvider: CHANNEL_PROVIDER, maxRetries: 0 });
    const r = await svc.send({ to: "a@b.com", subject: "s", html: "h" });

    expect(r.ok).toBe(false);
    // 回退链：configProvider 全部失败 → 最终错误（docs/093 通道回退）
    expect(r.error).toBe("所有邮件通道均不可用（未配置 remote / Cloudflare / configProvider / Resend）");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("无启用通道时返回明确错误", async () => {
    const svc = new EmailService({ configProvider: { listEnabled: async () => [] } });
    const r = await svc.send({ to: "a@b.com", subject: "s", html: "h" });
    expect(r).toEqual({ ok: false, error: "所有邮件通道均不可用（未配置 remote / Cloudflare / configProvider / Resend）" });
  });
});

describe("EmailService — 日志钩子（onLog）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sendWithLog 依次记录 pending → sent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resendResponse(200, { id: "m1" }));
    vi.stubGlobal("fetch", fetchMock);

    const logs: Array<{ status: string; to: string }> = [];
    const svc = new EmailService({ apiKey: "k", onLog: async (e) => { logs.push({ status: e.status, to: e.to }); } });

    const r = await svc.sendWithLog({ to: "a@b.com", subject: "s", html: "h" });

    expect(r.ok).toBe(true);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ status: "pending", to: "a@b.com" });
    expect(logs[1]).toMatchObject({ status: "sent", to: "a@b.com" });
  });

  it("sendWithLog 失败时记录 failed 与错误信息", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resendResponse(500, { message: "boom" }));
    vi.stubGlobal("fetch", fetchMock);

    const logs: EmailLogEntry[] = [];
    const svc = new EmailService({ apiKey: "k", maxRetries: 0, onLog: async (e: EmailLogEntry) => { logs.push(e); } });

    await svc.sendWithLog({ to: "a@b.com", subject: "s", html: "h" });

    expect(logs[logs.length - 1]).toMatchObject({ status: "failed", error: "boom" });
  });

  it("logger 抛错不阻断发送（P4 回归）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resendResponse(200, { id: "m1" }));
    vi.stubGlobal("fetch", fetchMock);

    const svc = new EmailService({
      apiKey: "k",
      onLog: async () => { throw new Error("email_log 表写入失败"); },
    });

    // 日志钩子抛错时发送仍应成功（fail-open）
    const r = await svc.sendWithLog({ to: "a@b.com", subject: "s", html: "h" });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("EmailService — 模板插值", () => {
  it("转义变量值（XSS 防护）", () => {
    expect(interpolate("{{x}}", { x: `<b>&"'` })).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });

  it("if 条件为假时删除块内容", () => {
    expect(interpolate("a{{#if flag}}b{{/if}}c", {})).toBe("ac");
    expect(interpolate("a{{#if flag}}b{{/if}}c", { flag: "" })).toBe("ac");
  });

  it("if 条件为真时保留内容并转义块内变量", () => {
    expect(interpolate("{{#if flag}}{{x}}{{/if}}", { flag: "1", x: "<i>" })).toBe("&lt;i&gt;");
  });

  it("缺失变量渲染为空字符串（不输出 undefined）", () => {
    expect(interpolate("a{{missing}}b", {})).toBe("ab");
  });
});

describe("EmailService — sendWithTemplate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("模板插值后发送", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resendResponse(200, { id: "m1" }));
    vi.stubGlobal("fetch", fetchMock);

    const svc = new EmailService({ apiKey: "k" });
    const r = await svc.sendWithTemplate(
      "a@b.com",
      { subject: "欢迎 {{name}}", html: "<p>{{#if vip}}{{name}}{{/if}}</p>" },
      { name: "<用户>", vip: "1" },
    );

    expect(r.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { subject: string; html: string };
    expect(body.subject).toBe("欢迎 &lt;用户&gt;");
    expect(body.html).toBe("<p>&lt;用户&gt;</p>");
  });
});

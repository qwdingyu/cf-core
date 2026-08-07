import { describe, it, expect, vi } from "vitest";
import { EmailService } from "../features/email/index.js";
import { sendViaRemote } from "../features/email/remote.js";

const REMOTE = {
  url: "https://auth.eforge.xyz/api/email/send",
  clientId: "shop-client",
  clientSecret: "secret-1",
};

function mockRemoteOk() {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true, provider: "resend" }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
}

describe("sendViaRemote（cf-auth 邮件网关，docs/093）", () => {
  it("成功发送带 Basic 认证", async () => {
    const fetchMock = mockRemoteOk();
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendViaRemote(REMOTE, { to: "a@b.com", subject: "hi", html: "<p>hi</p>" });
    expect(r).toEqual({ ok: true, messageId: "resend" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(REMOTE.url);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toContain("Basic ");
    expect(headers.get("content-type")).toContain("application/json");
    const body = JSON.parse(String(init.body)) as { to: string };
    expect(body.to).toBe("a@b.com");
    vi.unstubAllGlobals();
  });

  it("网关返回失败（403 email_enabled 未开启）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "该应用未开启邮件发送" }), { status: 403, headers: { "Content-Type": "application/json" } }),
    ));
    const r = await sendViaRemote(REMOTE, { to: "a@b.com", subject: "s", html: "h" });
    expect(r).toMatchObject({ ok: false, status: 403, error: "该应用未开启邮件发送" });
    vi.unstubAllGlobals();
  });

  it("网络错误返回失败", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const r = await sendViaRemote(REMOTE, { to: "a@b.com", subject: "s", html: "h" });
    expect(r).toMatchObject({ ok: false, error: "network down" });
    vi.unstubAllGlobals();
  });
});

describe("EmailService remote 通道集成", () => {
  it("提供 remote 时优先走 cf-auth 网关（不走 Resend）", async () => {
    const fetchMock = mockRemoteOk();
    vi.stubGlobal("fetch", fetchMock);
    const svc = new EmailService({ remote: REMOTE, apiKey: "should-not-be-used", from: "f" });
    const r = await svc.send({ to: "a@b.com", subject: "s", html: "h" });
    expect(r.ok).toBe(true);
    // 请求发到 cf-auth（非 api.resend.com）
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("auth.eforge.xyz");
    vi.unstubAllGlobals();
  });

  it("无 remote 时回退 Resend（向后兼容）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "r1" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const svc = new EmailService({ apiKey: "k", from: "f" });
    const r = await svc.send({ to: "a@b.com", subject: "s", html: "h" });
    expect(r).toEqual({ ok: true, messageId: "r1" });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("api.resend.com");
    vi.unstubAllGlobals();
  });
});
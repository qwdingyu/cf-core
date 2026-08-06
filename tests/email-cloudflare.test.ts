import { describe, it, expect, vi } from "vitest";
import { EmailService } from "../features/email/index.js";
import { sendViaCloudflareEmail, isCloudflareEmailBinding, type CloudflareEmailBinding } from "../features/email/cloudflare.js";

function mockBindingSend(impl?: (opts: unknown) => Promise<{ messageId: string }>): CloudflareEmailBinding {
  return { send: vi.fn(impl ?? (async () => ({ messageId: "cf-msg-1" }))) };
}

describe("sendViaCloudflareEmail", () => {
  it("成功发送返回 messageId", async () => {
    const binding = mockBindingSend();
    const r = await sendViaCloudflareEmail(binding, {
      from: "shop <noreply@eforge.xyz>",
      to: "a@b.com",
      subject: "hi",
      html: "<p>hi</p>",
    });
    expect(r).toEqual({ ok: true, messageId: "cf-msg-1" });
    expect(binding.send).toHaveBeenCalledWith(expect.objectContaining({ to: "a@b.com", subject: "hi" }));
  });

  it("失败返回 ok:false + 错误码", async () => {
    const err = new Error("sender not verified") as Error & { code?: string };
    err.code = "E_SENDER_NOT_VERIFIED";
    const binding = mockBindingSend(async () => { throw err; });
    const r = await sendViaCloudflareEmail(binding, { from: "f", to: "a@b.com", subject: "s", html: "h" });
    expect(r).toEqual({ ok: false, error: "E_SENDER_NOT_VERIFIED: sender not verified" });
  });

  it("isCloudflareEmailBinding 判定", () => {
    expect(isCloudflareEmailBinding({ send: () => Promise.resolve({ messageId: "x" }) })).toBe(true);
    expect(isCloudflareEmailBinding({ send: 1 })).toBe(false);
    expect(isCloudflareEmailBinding(null)).toBe(false);
    expect(isCloudflareEmailBinding(undefined)).toBe(false);
  });
});

describe("EmailService + Cloudflare binding 集成", () => {
  it("提供 emailBinding 时 send 优先走 Cloudflare", async () => {
    const binding = mockBindingSend();
    const svc = new EmailService({ emailBinding: binding, from: "shop <noreply@eforge.xyz>" });
    const r = await svc.send({ to: "a@b.com", subject: "s", html: "h" });
    expect(r).toEqual({ ok: true, messageId: "cf-msg-1" });
    expect(binding.send).toHaveBeenCalledTimes(1);
  });

  it("提供 emailBinding 时不走 Resend（无 fetch 调用）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const binding = mockBindingSend();
    const svc = new EmailService({ emailBinding: binding });
    await svc.send({ to: "a@b.com", subject: "s", html: "h" });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("无 emailBinding 时回退 Resend（向后兼容）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "resend-1" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const svc = new EmailService({ apiKey: "k", from: "f" });
    const r = await svc.send({ to: "a@b.com", subject: "s", html: "h" });
    expect(r).toEqual({ ok: true, messageId: "resend-1" });
    vi.unstubAllGlobals();
  });

  it("sendWithLog 走 Cloudflare binding 且记录日志", async () => {
    const binding = mockBindingSend();
    const logs: Array<{ status: string }> = [];
    const svc = new EmailService({ emailBinding: binding, onLog: async (e) => { logs.push({ status: e.status }); } });
    const r = await svc.sendWithLog({ to: "a@b.com", subject: "s", html: "h" });
    expect(r.ok).toBe(true);
    expect(logs).toHaveLength(2);
    expect(logs[0].status).toBe("pending");
    expect(logs[1].status).toBe("sent");
  });
});
import { describe, it, expect } from "vitest";
import { WebhookService } from "../index.js";

describe("WebhookService", () => {
  it("无 URL 时不发送", async () => {
    const svc = new WebhookService({ urls: "" });
    expect(svc.isConfigured).toBe(false);
    const results = await svc.notify("test", { foo: "bar" });
    expect(results).toEqual([]);
  });

  it("过滤无效 URL", () => {
    const svc = new WebhookService({ urls: "not-a-url, https://valid.com/hook" });
    expect(svc.isConfigured).toBe(true);
  });

  it("全无效 URL 时 isConfigured=false", () => {
    const svc = new WebhookService({ urls: "not-a-url, also-not" });
    expect(svc.isConfigured).toBe(false);
  });
});

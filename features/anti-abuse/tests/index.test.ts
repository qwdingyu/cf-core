import { describe, it, expect } from "vitest";
import { AntiAbuseService } from "../index";

describe("AntiAbuseService", () => {
  it("正常访问无异常", () => {
    const svc = new AntiAbuseService();
    const events = svc.record("token-abc-123", "ip-hash-1");
    expect(events).toEqual([]);
  });

  it("高频请求检测", () => {
    const svc = new AntiAbuseService({ maxRequestsPerIp: 3, windowMs: 60000 });
    let events: any[] = [];
    for (let i = 0; i < 5; i++) {
      events = svc.record(`token-${i}`, "same-ip");
    }
    expect(events.some((e) => e.type === "high_frequency")).toBe(true);
  });

  it("多 IP 访问检测", () => {
    const svc = new AntiAbuseService({ maxIpsPerResource: 2 });
    svc.record("token-shared", "ip-1");
    svc.record("token-shared", "ip-2");
    const events = svc.record("token-shared", "ip-3");
    expect(events.some((e) => e.type === "multi_ip_access")).toBe(true);
  });

  it("快速连续操作检测", () => {
    const svc = new AntiAbuseService({ rapidFireIntervalMs: 1000 });
    svc.record("token-a", "fast-ip");
    // 立即再次访问
    const events = svc.record("token-b", "fast-ip");
    expect(events.some((e) => e.type === "rapid_fire")).toBe(true);
  });

  it("isSuspicious 检测", () => {
    const svc = new AntiAbuseService({ maxRequestsPerIp: 1 });
    svc.record("t-1", "bad-ip");
    svc.record("t-2", "bad-ip"); // 触发 high_frequency
    expect(svc.isSuspicious("bad-ip")).toBe(true);
    expect(svc.isSuspicious("clean-ip")).toBe(false);
  });

  it("cleanup 清理过期数据", () => {
    const svc = new AntiAbuseService({ windowMs: 1 });
    svc.record("t-1", "ip-1");
    svc.cleanup();
    expect(svc.getEvents()).toEqual([]);
  });
});

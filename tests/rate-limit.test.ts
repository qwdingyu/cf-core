import { describe, it, expect } from "vitest";
import { MemoryRateLimiter } from "../src/rate-limit.js";

describe("MemoryRateLimiter", () => {
  it("未超限时允许", async () => {
    const limiter = new MemoryRateLimiter();
    const result = await limiter.check("test-key", 5, 60000);
    expect(result.ok).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("达到限制后拒绝", async () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 5; i++) {
      await limiter.check("test-key", 5, 60000);
    }
    const result = await limiter.check("test-key", 5, 60000);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
  });

  it("不同 key 独立计数", async () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 5; i++) {
      await limiter.check("key-a", 5, 60000);
    }
    const resultB = await limiter.check("key-b", 5, 60000);
    expect(resultB.ok).toBe(true);
  });

  it("窗口过期后重置", async () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 5; i++) {
      await limiter.check("test-key", 5, 100); // 100ms 窗口
    }
    // 等待窗口过期
    await new Promise((r) => setTimeout(r, 150));
    const result = await limiter.check("test-key", 5, 100);
    expect(result.ok).toBe(true);
  });
});

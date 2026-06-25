import { describe, it, expect } from "vitest";
import { classifyError, retryWithBackoff, ErrorType } from "../src/error.js";

describe("classifyError", () => {
  it("限流错误", () => {
    expect(classifyError(new Error("429 Too Many Requests"))).toBe(ErrorType.RATE_LIMIT);
    expect(classifyError(new Error("rate limit exceeded"))).toBe(ErrorType.RATE_LIMIT);
    expect(classifyError("throttled")).toBe(ErrorType.RATE_LIMIT);
  });

  it("永久性错误", () => {
    expect(classifyError(new Error("invalid_grant"))).toBe(ErrorType.PERMANENT);
    expect(classifyError(new Error("unauthorized"))).toBe(ErrorType.PERMANENT);
    expect(classifyError(new Error("access_denied"))).toBe(ErrorType.PERMANENT);
    expect(classifyError(new Error("401 Unauthorized"))).toBe(ErrorType.PERMANENT);
  });

  it("暂时性错误", () => {
    expect(classifyError(new Error("network timeout"))).toBe(ErrorType.TRANSIENT);
    expect(classifyError(new Error("500 Internal Server Error"))).toBe(ErrorType.TRANSIENT);
    expect(classifyError(new Error("ECONNRESET"))).toBe(ErrorType.TRANSIENT);
  });
});

describe("retryWithBackoff", () => {
  it("成功时不重试", async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls++;
      return "ok";
    }, { maxRetries: 3 });

    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("永久性错误不重试", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(async () => {
        calls++;
        throw new Error("invalid_grant");
      }, { maxRetries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("invalid_grant");

    expect(calls).toBe(1);
  });

  it("暂时性错误重试后成功", async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls++;
        if (calls < 3) throw new Error("timeout");
        return "recovered";
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );

    expect(result).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("超过最大重试次数后抛出", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new Error("timeout");
        },
        { maxRetries: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("timeout");

    expect(calls).toBe(3); // 初始 + 2 次重试
  });

  it("onRetry 回调被调用", async () => {
    const retries: number[] = [];
    await retryWithBackoff(
      async () => {
        throw new Error("timeout");
      },
      {
        maxRetries: 2,
        baseDelayMs: 1,
        onRetry: (attempt) => retries.push(attempt),
      },
    ).catch(() => {});

    expect(retries).toEqual([1, 2]);
  });
});

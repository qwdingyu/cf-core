import { describe, expect, it } from "vitest";
import {
  createApiBodyLimitResolver,
  isContentLengthOverLimit,
  mediaUploadRequestLimitBytes,
  readRequestBodyWithinLimit,
  rebuildRequestWithBody,
} from "../src/api-body-limit.js";

describe("api-body-limit factory (shipped helpers)", () => {
  it("selects media limit only for configured upload path", () => {
    const getLimit = createApiBodyLimitResolver({
      defaultBytes: 100 * 1024,
      mediaUploadBytes: 5 * 1024 * 1024 + 64 * 1024,
      mediaUploadPath: "/admin/media/images",
    });
    expect(getLimit("/admin/media/images")).toBe(5 * 1024 * 1024 + 64 * 1024);
    expect(getLimit("/api/orders")).toBe(100 * 1024);
    expect(getLimit("/admin/media/images/extra")).toBe(100 * 1024);
  });

  it("supports lottery-style path and multi-path list", () => {
    const getLimit = createApiBodyLimitResolver({
      defaultBytes: 100 * 1024,
      mediaUploadBytes: 2 * 1024 * 1024 + 64 * 1024,
      mediaUploadPath: ["/api/admin/media/images", "/admin/media/images"],
    });
    expect(getLimit("/api/admin/media/images")).toBe(2 * 1024 * 1024 + 64 * 1024);
    expect(getLimit("/admin/media/images")).toBe(2 * 1024 * 1024 + 64 * 1024);
    expect(getLimit("/other")).toBe(100 * 1024);
  });

  it("mediaUploadRequestLimitBytes adds overhead", () => {
    expect(mediaUploadRequestLimitBytes(2 * 1024 * 1024)).toBe(2 * 1024 * 1024 + 64 * 1024);
  });

  it("rejects invalid option numbers", () => {
    expect(() =>
      createApiBodyLimitResolver({
        defaultBytes: -1,
        mediaUploadBytes: 1,
        mediaUploadPath: "/x",
      }),
    ).toThrow(/defaultBytes/);
  });

  it("isContentLengthOverLimit gates declared length", () => {
    expect(isContentLengthOverLimit("100", 50)).toBe(true);
    expect(isContentLengthOverLimit("50", 50)).toBe(false);
    expect(isContentLengthOverLimit(undefined, 50)).toBe(false);
  });

  it("readRequestBodyWithinLimit accepts small streams and rejects oversized", async () => {
    const okStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.close();
      },
    });
    const ok = await readRequestBodyWithinLimit(okStream, 10);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.total).toBe(5);
      expect(new TextDecoder().decode(ok.body!)).toBe("hello");
    }

    const big = new Uint8Array(20);
    const overStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    const over = await readRequestBodyWithinLimit(overStream, 10);
    expect(over).toEqual({ ok: false, reason: "oversized", total: 20 });
  });

  it("rebuildRequestWithBody sets content-length", async () => {
    const original = new Request("https://example.test/api", {
      method: "POST",
      body: "x",
    });
    const rebuilt = rebuildRequestWithBody(original, new TextEncoder().encode("abc"));
    expect(rebuilt.headers.get("content-length")).toBe("3");
    expect(await rebuilt.text()).toBe("abc");
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  createMediaImageKey,
  detectMediaImage,
  getManagedMediaImageContentType,
  isManagedMediaImageKey,
  MEDIA_IMAGE_CACHE_CONTROL,
  validateMediaImage,
} from "../src/media-image.js";

describe("media-image (shipped helpers)", () => {
  it("exports immutable cache-control constant", () => {
    expect(MEDIA_IMAGE_CACHE_CONTROL).toContain("immutable");
  });

  it("detects supported signatures without trusting the filename", () => {
    expect(detectMediaImage(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]))?.contentType).toBe(
      "image/jpeg",
    );
    expect(
      detectMediaImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))
        ?.contentType,
    ).toBe("image/png");
    expect(detectMediaImage(new TextEncoder().encode("RIFF0000WEBP"))?.contentType).toBe("image/webp");
    expect(detectMediaImage(new TextEncoder().encode("0000ftypavif0000000000000000"))?.contentType).toBe(
      "image/avif",
    );
    expect(detectMediaImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
  });

  it("validateMediaImage uses injected maxBytes and messages", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const file = new File([bytes], "ok.jpg", { type: "image/jpeg" });
    expect(validateMediaImage(file, bytes, { maxBytes: 1024 }).extension).toBe("jpg");

    const big = new File([bytes], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 2048 });
    expect(() =>
      validateMediaImage(big, bytes, { maxBytes: 1024, oversizeMessage: "图片不能超过 1KiB" }),
    ).toThrow("图片不能超过 1KiB");
  });

  it("rejects MIME spoofing against file signature", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const file = new File([bytes], "spoof.png", { type: "image/png" });
    expect(() => validateMediaImage(file, bytes, { maxBytes: 5 * 1024 * 1024 })).toThrow(
      "图片内容与文件类型不一致",
    );
  });

  it("generates only constrained immutable object keys", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("123e4567-e89b-42d3-a456-426614174000");
    const key = createMediaImageKey("webp");
    expect(key).toBe("images/123e4567-e89b-42d3-a456-426614174000.webp");
    expect(isManagedMediaImageKey(key)).toBe(true);
    expect(getManagedMediaImageContentType(key)).toBe("image/webp");
    expect(isManagedMediaImageKey("../private/backup.zip")).toBe(false);
    expect(getManagedMediaImageContentType("../private/backup.zip")).toBeNull();
  });
});

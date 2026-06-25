import { describe, it, expect } from "vitest";
import { detectPlatform } from "../index";

describe("detectPlatform", () => {
  it("非浏览器环境返回 h5-desktop", () => {
    // Node.js 测试环境无 window/navigator
    const info = detectPlatform();
    expect(info.isTelegram).toBe(false);
    expect(info.platform).toBe("h5-desktop");
  });
});

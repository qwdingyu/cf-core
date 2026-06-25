import { describe, it, expect } from "vitest";
import { Obfuscator, ObfuscateLevel } from "../src/obfuscate/obfuscator.js";

describe("Obfuscator", () => {
  it("none 级别应该跳过混淆", async () => {
    const obfuscator = new Obfuscator("none");
    const result = await obfuscator.obfuscate({
      inputDir: "/tmp/test",
      outputDir: "/tmp/test-out",
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("none");
  });

  it("light 级别应该返回占位结果", async () => {
    const obfuscator = new Obfuscator("light");
    const result = await obfuscator.obfuscate({
      inputDir: "/tmp/test",
      outputDir: "/tmp/test-out",
      level: "light",
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("占位");
  });

  it("应该支持 medium 和 aggressive 级别", async () => {
    const levels: ObfuscateLevel[] = ["medium", "aggressive"];
    for (const level of levels) {
      const obfuscator = new Obfuscator(level);
      const result = await obfuscator.obfuscate({
        inputDir: "/tmp/test",
        outputDir: "/tmp/test-out",
        level,
      });
      expect(result.success).toBe(true);
    }
  });
});

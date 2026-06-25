import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Obfuscator, ObfuscateLevel } from "../src/obfuscate/obfuscator.js";

const INPUT_DIR = join("/tmp", "publish-toolkit-test-input");
const OUTPUT_DIR = join("/tmp", "publish-toolkit-test-output");

beforeAll(() => {
  // 清理并创建测试输入目录
  rmSync(INPUT_DIR, { recursive: true, force: true });
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(INPUT_DIR, { recursive: true });
  mkdirSync(join(INPUT_DIR, "sub"), { recursive: true });

  // 创建测试文件
  writeFileSync(join(INPUT_DIR, "index.js"), "console.log('hello world');");
  writeFileSync(join(INPUT_DIR, "app.mjs"), "export default function app() { return 1; };");
  writeFileSync(join(INPUT_DIR, "sub", "helper.js"), "function helper() { return true; }");
});

describe("Obfuscator", () => {
  it("none 级别应该复制文件并跳过混淆", async () => {
    const obfuscator = new Obfuscator("none");
    const result = await obfuscator.obfuscate({
      inputDir: INPUT_DIR,
      outputDir: join(OUTPUT_DIR, "none"),
    });
    console.log("none result:", result);
    expect(result.success).toBe(true);
    expect(result.message).toContain("none");
    expect(result.processedFiles).toBe(3);
  });

  it("light 级别应该完成混淆", async () => {
    const obfuscator = new Obfuscator("light");
    const result = await obfuscator.obfuscate({
      inputDir: INPUT_DIR,
      outputDir: join(OUTPUT_DIR, "light"),
      level: "light",
    });
    console.log("light result:", result);
    expect(result.success).toBe(true);
    expect(result.processedFiles).toBe(3);
  });

  it("应该支持 medium 和 aggressive 级别", async () => {
    const levels: ObfuscateLevel[] = ["medium", "aggressive"];
    for (const level of levels) {
      const obfuscator = new Obfuscator(level);
      const result = await obfuscator.obfuscate({
        inputDir: INPUT_DIR,
        outputDir: join(OUTPUT_DIR, level),
        level,
      });
      console.log(`${level} result:`, result);
      expect(result.success).toBe(true);
      expect(result.processedFiles).toBe(3);
    }
  });

  it("应该支持排除文件", async () => {
    const obfuscator = new Obfuscator("light");
    const result = await obfuscator.obfuscate({
      inputDir: INPUT_DIR,
      outputDir: join(OUTPUT_DIR, "exclude"),
      level: "light",
      exclude: [".mjs"],
    });
    console.log("exclude result:", result);
    expect(result.success).toBe(true);
    expect(result.processedFiles).toBe(2);
  });

  it("应该支持 source map", async () => {
    const obfuscator = new Obfuscator("light");
    const result = await obfuscator.obfuscate({
      inputDir: INPUT_DIR,
      outputDir: join(OUTPUT_DIR, "sourcemap"),
      level: "light",
      sourceMap: true,
    });
    console.log("sourcemap result:", result);
    expect(result.success).toBe(true);
    expect(result.processedFiles).toBe(3);
  });
});

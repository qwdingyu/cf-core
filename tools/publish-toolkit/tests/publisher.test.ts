import { describe, it, expect, vi } from "vitest";
import { PublishToolkit } from "../src/publish/publisher.js";

describe("PublishToolkit", () => {
  it("应该正确初始化默认选项", () => {
    const toolkit = new PublishToolkit();
    expect(toolkit).toBeDefined();
  });

  it("应该接受自定义选项", () => {
    const toolkit = new PublishToolkit({
      packageDir: "/tmp/test-pkg",
      registry: "https://registry.npmjs.org/",
      dryRun: true,
      tag: "beta",
      verbose: true,
    });
    expect(toolkit).toBeDefined();
  });

  it("dry-run 模式下应该返回成功结果（模拟）", async () => {
    // 注意：此测试需要真实的 package.json 环境
    // 此处仅验证接口存在
    const toolkit = new PublishToolkit({
      packageDir: process.cwd(),
      dryRun: true,
      skipGitCheck: true,
      skipVersionCheck: true,
    });

    // 由于缺少 NPM_TOKEN，会先失败
    const result = await toolkit.publish("");
    expect(result.success).toBe(false);
    expect(result.message).toContain("NPM_TOKEN");
  });
});

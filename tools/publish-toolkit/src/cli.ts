#!/usr/bin/env node

/**
 * @usethink/publish-toolkit — CLI 入口
 *
 * 用法：
 *   publish-toolkit publish [选项]
 *   publish-toolkit obfuscate [选项]
 *   publish-toolkit help [命令]
 *
 * 环境变量：
 *   NPM_TOKEN   — npm 自动化 access token（publish 命令必需）
 */

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { PublishToolkit } from "./publish/publisher.js";
import { Obfuscator, ObfuscateLevel, ObfuscateOptions } from "./obfuscate/obfuscator.js";

const program = new Command();

program
  .name("publish-toolkit")
  .description("统一 npm 包发布工具链 — 混淆构建、包准备、一键发布")
  .version("0.1.1");

// ===== publish 命令 =====

program
  .command("publish")
  .description("构建并发布 npm 包")
  .option("--package <path>", "包目录（默认: 当前目录）")
  .option("--registry <url>", "目标 registry", "https://registry.npmjs.org/")
  .option("--dry-run", "预览模式，不实际发布")
  .option("--tag <name>", "dist-tag", "latest")
  .option("--otp <code>", "OTP 二次验证码")
  .option("--access <level>", "发布访问级别", "public")
  .option("--no-git-check", "跳过 git 检查")
  .option("--no-version-check", "跳过版本号已发布检查")
  .option("--verbose, -v", "详细日志")
  .action(async (options) => {
    const npmToken = process.env.NPM_TOKEN;
    if (!npmToken) {
      console.error("错误: 缺少环境变量 NPM_TOKEN");
      process.exit(1);
    }

    const toolkit = new PublishToolkit({
      packageDir: options.package,
      registry: options.registry,
      dryRun: options.dryRun,
      tag: options.tag,
      otp: options.otp,
      access: options.access,
      skipGitCheck: options.gitCheck === false,
      skipVersionCheck: options.versionCheck === false,
      verbose: options.verbose,
    });

    const result = await toolkit.publish(npmToken);
    if (!result.success) {
      process.exit(1);
    }
  });

// ===== obfuscate 命令 =====

program
  .command("obfuscate")
  .description("对构建产物进行混淆")
  .requiredOption("--input <dir>", "输入目录")
  .requiredOption("--output <dir>", "输出目录")
  .option("--level <name>", "混淆级别: none | light | medium | aggressive", "light")
  .option("--source-map", "保留 source map")
  .option("-e, --exclude <pattern>", "排除文件（支持简单 glob，可多次指定）", [] as string[])
  .option("--config <path>", "混淆器自定义配置 JSON 文件路径")
  .action(async (options) => {
    const level = options.level as ObfuscateLevel;
    const obfuscator = new Obfuscator(level);

    const obfuscateOptions: ObfuscateOptions = {
      inputDir: options.input,
      outputDir: options.output,
      level,
      sourceMap: options.sourceMap,
      exclude: options.exclude,
    };

    if (options.config) {
      try {
        obfuscateOptions.options = JSON.parse(readFileSync(options.config, "utf-8"));
      } catch (err) {
        console.error(`[obfuscate ❌] 无法读取配置文件: ${options.config}`);
        process.exit(1);
      }
    }

    const result = await obfuscator.obfuscate(obfuscateOptions);

    console.log(`[obfuscate] ${result.message}`);
    console.log(`  输出目录: ${result.outputDir}`);
    console.log(`  处理文件数: ${result.processedFiles}`);
    if (result.inputSize > 0 && result.outputSize > 0) {
      console.log(`  输入大小: ${(result.inputSize / 1024).toFixed(2)} KB`);
      console.log(`  输出大小: ${(result.outputSize / 1024).toFixed(2)} KB`);
    }
    if (!result.success) {
      process.exitCode = 1;
    }
  });

// ===== help 命令 =====

program
  .command("help")
  .description("显示帮助信息")
  .action(() => {
    program.outputHelp();
  });

// ===== 解析参数 =====

program.parse();

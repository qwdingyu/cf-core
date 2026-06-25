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
  .version("0.1.4");

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

const obfuscateCmd = program
  .command("obfuscate")
  .description("对构建产物进行混淆");

obfuscateCmd
  .command("run")
  .description("执行混淆（默认子命令）")
  .requiredOption("--input <dir>", "输入目录")
  .requiredOption("--output <dir>", "输出目录")
  .option("--level <name>", "混淆级别: none | light | medium | aggressive", "light")
  .option("--source-map", "保留 source map")
  .option("-e, --exclude <pattern>", "排除文件（支持简单 glob，可多次指定）", [] as string[])
  .option("--config <path>", "混淆器自定义配置 JSON 文件路径")
  .option("--report", "生成混淆报告（obfuscate-report.json）")
  .action(async (options: any) => {
    const level = options.level as ObfuscateLevel;
    const obfuscator = new Obfuscator(level);

    const obfuscateOptions: ObfuscateOptions = {
      inputDir: options.input,
      outputDir: options.output,
      level,
      sourceMap: options.sourceMap,
      exclude: options.exclude,
      report: options.report,
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
      const inputKB = (result.inputSize / 1024).toFixed(2);
      const outputKB = (result.outputSize / 1024).toFixed(2);
      const ratio = ((result.outputSize - result.inputSize) / result.inputSize * 100).toFixed(1);
      console.log(`  输入大小: ${inputKB} KB`);
      console.log(`  输出大小: ${outputKB} KB`);
      console.log(`  体积变化: ${ratio}%`);
    }
    if (result.reportPath) {
      console.log(`  报告文件: ${result.reportPath}`);
    }
    if (result.files && result.files.length > 0) {
      console.log(`  最快文件: ${Math.min(...result.files.map(f => f.duration))}ms`);
      console.log(`  最慢文件: ${Math.max(...result.files.map(f => f.duration))}ms`);
    }
    if (!result.success) {
      process.exitCode = 1;
    }
  });

obfuscateCmd
  .command("list-levels")
  .description("列出所有可用的混淆级别及其特点")
  .action(() => {
    const levels: Array<{ name: ObfuscateLevel; description: string }> = [
      { name: "none", description: "无混淆，仅复制文件。适合调试或不需要保护的场景。" },
      { name: "light", description: "基础混淆，启用 compact、字符串数组、RC4 编码。适合需要一定保护但不追求极致体积的场景。" },
      { name: "medium", description: "平衡混淆，在 light 基础上增加控制流扁平化、死代码注入、对象键转换。适合大多数发布场景。" },
      { name: "aggressive", description: "最大混淆，在 medium 基础上增加调试保护、禁用控制台输出、Unicode 转义。适合对代码保护要求极高的场景。" },
    ];

    console.log("可用混淆级别：\n");
    levels.forEach((level) => {
      console.log(`  ${level.name.padEnd(10)} ${level.description}`);
    });
    console.log();
    console.log("使用示例：");
    console.log("  publish-toolkit obfuscate run --input dist --output dist-obf --level medium");
    console.log("  publish-toolkit obfuscate run --input dist --output dist-obf --level aggressive --report");
  });

obfuscateCmd
  .command("info")
  .description("显示混淆器配置信息")
  .action(() => {
    console.log("混淆器信息：\n");
    console.log("  引擎: javascript-obfuscator");
    console.log("  支持级别: none, light, medium, aggressive");
    console.log("  支持文件类型: .js, .mjs, .ts, .cjs, .d.ts, .jsx, .tsx");
    console.log("  排除规则: 支持 glob 模式（*.ext, **/*.ext, dir/** 等）");
    console.log("  报告生成: 支持 JSON 格式混淆报告");
    console.log("  Source Map: 支持生成 source map 文件");
    console.log();
    console.log("当前默认级别：light");
    console.log("默认输出目录：当前工作目录下的 obfuscated/");
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

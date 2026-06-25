/**
 * @usethink/publish-toolkit — 混淆引擎
 *
 * 基于 javascript-obfuscator 实现，支持多级混淆策略。
 *
 * 设计目标：
 *   1. 支持多级混淆策略（none / light / medium / aggressive）
 *   2. 零侵入：输入输出均为文件路径，不修改项目源码结构
 *   3. 可配置：支持 source map、排除规则、自定义选项
 */

import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { obfuscate } from "javascript-obfuscator";
import type { ObfuscatorOptions } from "javascript-obfuscator";

// 简单 glob 匹配：仅支持 **/*.ext 与 *.ext 两类常见场景
function matchExclude(relativePath: string, exclude: string[]) {
  const normalized = relativePath.split(join(import.meta.dirname, ".")).join(".") || relativePath;
  for (const pattern of exclude) {
    if (!pattern) continue;
    if (pattern.startsWith("**/")) {
      const suffix = pattern.slice(3);
      if (normalized.endsWith(suffix)) return true;
      if (normalized.includes(`/${suffix}`)) return true;
    } else if (pattern.startsWith("*.")) {
      if (normalized.endsWith(pattern)) return true;
      if (normalized.includes(`/${pattern}`)) return true;
    } else {
      if (normalized.endsWith(pattern)) return true;
      if (normalized.includes(`/${pattern}`)) return true;
    }
  }
  return false;
}

// ===== 类型定义 =====

export type ObfuscateLevel = "none" | "light" | "medium" | "aggressive";

export interface ObfuscateOptions {
  /** 输入目录（包含待混淆的 .js/.mjs 文件） */
  inputDir: string;
  /** 输出目录（混淆后文件写入位置） */
  outputDir: string;
  /** 混淆强度级别 */
  level?: ObfuscateLevel;
  /** 是否保留 source map */
  sourceMap?: boolean;
  /** 排除的文件glob模式（简单实现，仅支持后缀） */
  exclude?: string[];
  /** 覆盖默认混淆器选项 */
  options?: Partial<ObfuscatorOptions>;
}

export interface ObfuscateResult {
  success: boolean;
  processedFiles: number;
  outputDir: string;
  message: string;
  inputSize: number;
  outputSize: number;
}

// ===== 级别预设 =====

/**
 * 根据级别获取混淆器配置
 *
 * 设计意图：
 *   - none: 完全跳过混淆，仅复制文件
 *   - light: 基础混淆，适合需要一定保护但不追求极致体积的场景
 *   - medium: 平衡混淆，适合大多数发布场景
 *   - aggressive: 最大混淆，适合对代码保护要求极高的场景
 */
function getObfuscatorOptions(level: ObfuscateLevel, sourceMap: boolean): ObfuscatorOptions {
  const base: ObfuscatorOptions = {
    sourceMap: sourceMap,
    sourceMapMode: "separate",
    selfDefending: false,
    // 通用选项：保持代码功能不变的前提下增加阅读难度
    stringArray: true,
    stringArrayThreshold: 0.5,
  };

  switch (level) {
    case "none":
      // 不做任何混淆，但仍保留基础结构
      return {
        ...base,
        compact: false,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        debugProtection: false,
        disableConsoleOutput: false,
        identifierNamesGenerator: "hexadecimal",
        rotateStringArray: false,
        stringArrayEncoding: ["rc4"],
        stringArrayThreshold: 1,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
      };

    case "light":
      return {
        ...base,
        compact: true,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        debugProtection: false,
        disableConsoleOutput: false,
        identifierNamesGenerator: "hexadecimal",
        rotateStringArray: true,
        stringArrayEncoding: ["rc4"],
        stringArrayThreshold: 0.75,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
      };

    case "medium":
      return {
        ...base,
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.5,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.4,
        debugProtection: false,
        disableConsoleOutput: false,
        identifierNamesGenerator: "hexadecimal",
        rotateStringArray: true,
        stringArrayEncoding: ["rc4"],
        stringArrayThreshold: 0.8,
        transformObjectKeys: true,
        unicodeEscapeSequence: false,
      };

    case "aggressive":
      return {
        ...base,
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.75,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.6,
        debugProtection: true,
        disableConsoleOutput: true,
        identifierNamesGenerator: "hexadecimal",
        rotateStringArray: true,
        stringArrayEncoding: ["rc4"],
        stringArrayThreshold: 0.9,
        transformObjectKeys: true,
        unicodeEscapeSequence: true,
      };

    default:
      return base;
  }
}

// ===== 混淆器实现 =====

/**
 * 默认混淆器实现，基于 javascript-obfuscator。
 *
 * 使用场景：
 *   - 对构建产物（dist/）进行混淆，保护代码逻辑
 *   - 支持 CI/CD 流水线集成
 *   - 不修改源码，仅处理输出文件
 */
export class Obfuscator {
  private level: ObfuscateLevel;

  constructor(level: ObfuscateLevel = "light") {
    this.level = level;
  }

  /**
   * 执行混淆
   *
   * 处理流程：
   *   1. 验证输入输出目录
   *   2. 递归扫描输入目录中的 .js/.mjs/.ts 文件
   *   3. 根据级别选择混淆策略
   *   4. 写入输出目录，保持相对路径结构
   *   5. 返回处理结果统计
   */
  async obfuscate(options: ObfuscateOptions): Promise<ObfuscateResult> {
    const { inputDir, outputDir, sourceMap = false, exclude = [] } = options;
    const level = this.level;

    // 验证输入目录
    if (!existsSync(inputDir)) {
      return {
        success: false,
        processedFiles: 0,
        outputDir,
        message: `输入目录不存在: ${inputDir}`,
        inputSize: 0,
        outputSize: 0,
      };
    }

    // 创建输出目录
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // none 级别：直接复制，跳过混淆
    if (level === "none") {
      return this.copyFiles(inputDir, outputDir, exclude);
    }

    // 获取混淆配置，并合并用户自定义选项
    const obfuscatorOptions = { ...getObfuscatorOptions(level, sourceMap), ...options.options };

    // 递归处理文件
    let processedFiles = 0;
    let inputSize = 0;
    let outputSize = 0;
    const errors: string[] = [];

    const processDirectory = (dir: string) => {
      if (!existsSync(dir)) return;

      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = relative(inputDir, fullPath);
        const ext = extname(fullPath);

        // 跳过排除的文件
        if (matchExclude(relativePath, exclude)) {
          continue;
        }

        if (entry.isDirectory()) {
          // 递归处理子目录
          processDirectory(fullPath);
        } else if (entry.isFile() && (ext === ".js" || ext === ".mjs" || ext === ".ts" || ext === ".cjs")) {
          try {
            // 读取源文件
            const sourceCode = readFileSync(fullPath, "utf-8");
            inputSize += Buffer.byteLength(sourceCode, "utf-8");

            // 执行混淆
            const obfuscatedCode = obfuscate(
              sourceCode,
              obfuscatorOptions
            ).getObfuscatedCode();

            // 写入输出文件
            const outputPath = join(outputDir, relativePath);
            const outputFileDir = dirname(outputPath);

            if (!existsSync(outputFileDir)) {
              mkdirSync(outputFileDir, { recursive: true });
            }

            writeFileSync(outputPath, obfuscatedCode, "utf-8");
            outputSize += Buffer.byteLength(obfuscatedCode, "utf-8");

            // 生成 source map（如果启用）
            if (sourceMap) {
              const sourceMapResult = obfuscate(
                sourceCode,
                { ...obfuscatorOptions, sourceMap: true }
              );
              const sourceMap = sourceMapResult.getSourceMap();

              if (sourceMap) {
                writeFileSync(`${outputPath}.map`, sourceMap, "utf-8");
              }
            }

            processedFiles++;
          } catch (err) {
            errors.push(`${fullPath}: ${(err as Error).message}`);
          }
        }
      }
    };

    processDirectory(inputDir);

    if (processedFiles > 0) {
      console.log(`[obfuscate] 已处理 ${processedFiles} 个文件`);
    }

    // 构建结果消息
    let message = `混淆完成（level=${level}），处理 ${processedFiles} 个文件`;
    if (errors.length > 0) {
      message += `，${errors.length} 个文件失败`;
      // 在开发/调试场景下把失败原因一并返回，方便定位问题
      message += `：${errors.join("；")}`;
    }

    return {
      success: errors.length === 0,
      processedFiles,
      outputDir,
      message,
      inputSize,
      outputSize,
    };
  }

  /**
   * 复制文件（用于 none 级别）
   */
  private copyFiles(inputDir: string, outputDir: string, exclude: string[]): ObfuscateResult {
    let processedFiles = 0;
    let inputSize = 0;
    let outputSize = 0;

    const copyDirectory = (dir: string) => {
      if (!existsSync(dir)) return;

      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = relative(inputDir, fullPath);

        // 跳过排除的文件
        if (matchExclude(relativePath, exclude)) {
          continue;
        }

        if (entry.isDirectory()) {
          copyDirectory(fullPath);
        } else if (entry.isFile()) {
          const outputPath = join(outputDir, relativePath);
          const outputFileDir = dirname(outputPath);

          if (!existsSync(outputFileDir)) {
            mkdirSync(outputFileDir, { recursive: true });
          }

          const content = readFileSync(fullPath, "utf-8");
          inputSize += Buffer.byteLength(content, "utf-8");
          writeFileSync(outputPath, content, "utf-8");
          outputSize += Buffer.byteLength(content, "utf-8");
          processedFiles++;
        }
      }
    };

    copyDirectory(inputDir);

    return {
      success: true,
      processedFiles,
      outputDir,
      message: `none 级别：复制完成，处理 ${processedFiles} 个文件`,
      inputSize,
      outputSize,
    };
  }
}

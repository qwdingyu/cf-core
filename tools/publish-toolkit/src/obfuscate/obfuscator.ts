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
import obfuscateModule from "javascript-obfuscator";
import type { ObfuscatorOptions, ObfuscationResult } from "javascript-obfuscator";

// javascript-obfuscator 的 ESM/CJS 类型声明不一致：运行时 default export 是函数，
// 但类型文件把 obfuscate 声明为 named export。这里做运行时兼容，不改变行为。
const obfuscate = obfuscateModule as unknown as {
  obfuscate(sourceCode: string, inputOptions?: ObfuscatorOptions): ObfuscationResult;
};

/**
 * 简单 glob 匹配：支持常见场景
 *
 * 支持的模式：
 * - `*.ext`：匹配任意目录下的指定后缀文件
 * - 任意深度子目录中的指定后缀文件
 * - 指定目录下任意深度的指定后缀文件
 * - 任意目录下的指定目录及其子目录
 * - 包含指定文本的任意路径
 *
 * 实际代码中使用字符串比较和正则实现上述匹配逻辑。
 */
function matchExclude(relativePath: string, exclude: string[]) {
  const normalized = relativePath.split(join(import.meta.dirname, ".")).join(".") || relativePath;
  const normalizedSlash = normalized.replace(/\\/g, "/");

  for (const pattern of exclude) {
    if (!pattern) continue;

    const patternSlash = pattern.replace(/\\/g, "/");

    // **/*.ext 或 **/dir/**
    if (patternSlash.startsWith("**/")) {
      const suffix = patternSlash.slice(3);

      // **/*.ext 匹配任意深度的指定后缀
      if (suffix.startsWith("*.") || suffix.endsWith(".*")) {
        const ext = suffix.startsWith("*.") ? suffix.slice(2) : suffix.slice(1);
        if (normalizedSlash.endsWith(ext) || normalizedSlash.includes(`/${ext}`)) return true;
      }
      // **/dir/** 匹配任意目录下的指定目录
      else if (suffix.endsWith("/**")) {
        const dir = suffix.slice(0, -2);
        if (normalizedSlash.includes(`/${dir}/`) || normalizedSlash.startsWith(`${dir}/`)) return true;
      }
      // **/*text* 匹配包含指定文本
      else if (suffix.includes("*")) {
        const regexStr = suffix.replace(/\*/g, ".*");
        if (new RegExp(regexStr).test(normalizedSlash)) return true;
      }
      // 普通后缀匹配
      else {
        if (normalizedSlash.endsWith(suffix) || normalizedSlash.includes(`/${suffix}`)) return true;
      }
    }
    // *.ext 匹配任意目录下的指定后缀
    else if (patternSlash.startsWith("*.")) {
      const ext = patternSlash.slice(2);
      if (normalizedSlash.endsWith(ext) || normalizedSlash.includes(`/${ext}`)) return true;
    }
    // 包含文本匹配
    else if (patternSlash.includes("*")) {
      const regexStr = patternSlash.replace(/\*/g, ".*");
      if (new RegExp(regexStr).test(normalizedSlash)) return true;
    }
    // 精确路径匹配
    else {
      if (normalizedSlash === patternSlash || normalizedSlash.endsWith(patternSlash) || normalizedSlash.includes(`/${patternSlash}`)) return true;
    }
  }
  return false;
}

// ===== 类型定义 =====

export type ObfuscateLevel = "none" | "light" | "medium" | "aggressive";

export interface ObfuscateOptions {
  /** 输入目录（包含待混淆的 .js/.mjs/.ts 文件） */
  inputDir: string;
  /** 输出目录（混淆后文件写入位置） */
  outputDir: string;
  /** 混淆强度级别 */
  level?: ObfuscateLevel;
  /** 是否保留 source map */
  sourceMap?: boolean;
  /** 排除的文件glob模式（支持常见场景） */
  exclude?: string[];
  /** 覆盖默认混淆器选项 */
  options?: Partial<ObfuscatorOptions>;
  /** 是否生成混淆报告（JSON 格式） */
  report?: boolean;
}

export interface ObfuscateResult {
  success: boolean;
  processedFiles: number;
  outputDir: string;
  message: string;
  inputSize: number;
  outputSize: number;
  /** 混淆报告路径（如果生成） */
  reportPath?: string;
  /** 每个文件的处理详情 */
  files?: Array<{
    path: string;
    inputSize: number;
    outputSize: number;
    duration: number;
    error?: string;
  }>;
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
      return this.copyFiles(inputDir, outputDir, exclude, { report: options.report });
    }

    // 获取混淆配置，并合并用户自定义选项
    const obfuscatorOptions = { ...getObfuscatorOptions(level, sourceMap), ...options.options };

    // 递归处理文件
    let processedFiles = 0;
    let inputSize = 0;
    let outputSize = 0;
    const errors: string[] = [];
    const fileDetails: ObfuscateResult["files"] = [];

    // 支持的文件扩展名
    const SUPPORTED_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".cjs", ".d.ts", ".jsx", ".tsx"]);

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
        } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(ext)) {
          const startTime = Date.now();
          try {
            // 读取源文件
            const sourceCode = readFileSync(fullPath, "utf-8");
            const fileInputSize = Buffer.byteLength(sourceCode, "utf-8");
            inputSize += fileInputSize;

            // 执行混淆
            const obfuscatedCode = obfuscate.obfuscate(
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
            const fileOutputSize = Buffer.byteLength(obfuscatedCode, "utf-8");
            outputSize += fileOutputSize;

            // 生成 source map（如果启用）
            if (sourceMap) {
              const sourceMapResult = obfuscate.obfuscate(
                sourceCode,
                { ...obfuscatorOptions, sourceMap: true }
              );
              const sourceMap = sourceMapResult.getSourceMap();

              if (sourceMap) {
                writeFileSync(`${outputPath}.map`, sourceMap, "utf-8");
              }
            }

            processedFiles++;
            const duration = Date.now() - startTime;
            fileDetails.push({
              path: relativePath,
              inputSize: fileInputSize,
              outputSize: fileOutputSize,
              duration,
            });
          } catch (err) {
            const errorMsg = `${fullPath}: ${(err as Error).message}`;
            errors.push(errorMsg);
            const duration = Date.now() - startTime;
            fileDetails.push({
              path: relativePath,
              inputSize: 0,
              outputSize: 0,
              duration,
              error: (err as Error).message,
            });
          }
        }
      }
    };

    processDirectory(inputDir);

    if (processedFiles > 0) {
      console.log(`[obfuscate] 已处理 ${processedFiles} 个文件`);
    }

    // 构建结果消息
    const ratio = inputSize > 0 ? ((outputSize - inputSize) / inputSize * 100).toFixed(1) : "0.0";
    let message = `混淆完成（level=${level}），处理 ${processedFiles} 个文件，体积变化 ${ratio}%`;
    if (errors.length > 0) {
      message += `，${errors.length} 个文件失败`;
      // 在开发/调试场景下把失败原因一并返回，方便定位问题
      message += `：${errors.join("；")}`;
    }

    const result: ObfuscateResult = {
      success: errors.length === 0,
      processedFiles,
      outputDir,
      message,
      inputSize,
      outputSize,
      files: fileDetails,
    };

    // 生成报告（如果启用）
    if (options.report) {
      const reportPath = join(outputDir, "obfuscate-report.json");
      const report = {
        generatedAt: new Date().toISOString(),
        level,
        sourceMap,
        exclude,
        summary: {
          processedFiles,
          inputSize,
          outputSize,
          ratio: `${ratio}%`,
          errors: errors.length,
          success: result.success,
        },
        files: fileDetails,
      };
      writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
      result.reportPath = reportPath;
    }

    return result;
  }

  /**
   * 复制文件（用于 none 级别）
   */
  private copyFiles(inputDir: string, outputDir: string, exclude: string[], options?: { report?: boolean }): ObfuscateResult {
    let processedFiles = 0;
    let inputSize = 0;
    let outputSize = 0;
    const fileDetails: ObfuscateResult["files"] = [];
    const SUPPORTED_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".cjs", ".d.ts", ".jsx", ".tsx"]);

    const copyDirectory = (dir: string) => {
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
          copyDirectory(fullPath);
        } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(ext)) {
          const startTime = Date.now();
          try {
            const content = readFileSync(fullPath, "utf-8");
            const fileInputSize = Buffer.byteLength(content, "utf-8");
            inputSize += fileInputSize;

            const outputPath = join(outputDir, relativePath);
            const outputFileDir = dirname(outputPath);

            if (!existsSync(outputFileDir)) {
              mkdirSync(outputFileDir, { recursive: true });
            }

            writeFileSync(outputPath, content, "utf-8");
            const fileOutputSize = Buffer.byteLength(content, "utf-8");
            outputSize += fileOutputSize;

            processedFiles++;
            const duration = Date.now() - startTime;
            fileDetails.push({
              path: relativePath,
              inputSize: fileInputSize,
              outputSize: fileOutputSize,
              duration,
            });
          } catch (err) {
            const duration = Date.now() - startTime;
            fileDetails.push({
              path: relativePath,
              inputSize: 0,
              outputSize: 0,
              duration,
              error: (err as Error).message,
            });
          }
        }
      }
    };

    copyDirectory(inputDir);

    const ratio = inputSize > 0 ? ((outputSize - inputSize) / inputSize * 100).toFixed(1) : "0.0";
    const result: ObfuscateResult = {
      success: true,
      processedFiles,
      outputDir,
      message: `none 级别：复制完成，处理 ${processedFiles} 个文件，体积变化 ${ratio}%`,
      inputSize,
      outputSize,
      files: fileDetails,
    };

    // 生成报告（如果启用）
    if (options?.report) {
      const reportPath = join(outputDir, "obfuscate-report.json");
      const report = {
        generatedAt: new Date().toISOString(),
        level: "none",
        sourceMap: false,
        exclude,
        summary: {
          processedFiles,
          inputSize,
          outputSize,
          ratio: `${ratio}%`,
          errors: 0,
          success: true,
        },
        files: fileDetails,
      };
      writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
      result.reportPath = reportPath;
    }

    return result;
  }
}

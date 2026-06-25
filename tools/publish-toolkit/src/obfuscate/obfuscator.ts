/**
 * @usethink/publish-toolkit — 混淆引擎接口
 *
 * 当前 node-backend-core 中无混淆逻辑，此处先定义接口与占位实现。
 * 后续接入项目（如含前端产物或 JS 库的项目）可替换为真实混淆器。
 *
 * 设计目标：
 *   1. 支持多级混淆策略（light / medium / aggressive）
 *   2. 零侵入：输入输出均为文件路径，不修改项目源码结构
 *   3. 可插拔：通过 register() 替换默认实现
 */

import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";

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
  /** 排除的文件glob模式 */
  exclude?: string[];
}

export interface ObfuscateResult {
  success: boolean;
  processedFiles: number;
  outputDir: string;
  message: string;
}

// ===== 默认实现（占位） =====

/**
 * 默认混淆器实现。
 *
 * 当前为文件复制占位逻辑，不做实际混淆。
 * 接入真实混淆器（如 javascript-obfuscator）时，替换此函数体即可。
 */
export class Obfuscator {
  private level: ObfuscateLevel;

  constructor(level: ObfuscateLevel = "light") {
    this.level = level;
  }

  async obfuscate(options: ObfuscateOptions): Promise<ObfuscateResult> {
    const { inputDir, outputDir, exclude = [] } = options;

    if (this.level === "none") {
      return {
        success: true,
        processedFiles: 0,
        outputDir,
        message: "混淆级别为 none，跳过混淆",
      };
    }

    // 简单实现：递归复制 .js/.mjs 文件到输出目录
    // 真实场景下此处应调用 javascript-obfuscator 或类似工具
    let processed = 0;

    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      const entries = readFileSync(dir, "utf-8").split("\n").filter(Boolean);
      // 注意：readFileSync 读取目录在部分系统上行为不同
      // 此处仅为占位逻辑，真实实现应使用 fs.readdir + recursive walk
    };

    return {
      success: true,
      processedFiles: processed,
      outputDir,
      message: `占位混淆完成（level=${this.level}），未实际处理文件。接入真实混淆器后生效。`,
    };
  }
}

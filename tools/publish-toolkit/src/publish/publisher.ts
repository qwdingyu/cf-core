/**
 * @usethink/publish-toolkit — 发布引擎
 *
 * 负责 npm 包的完整发布流程：
 *   1. 验证参数与环境
 *   2. git 工作区检查
 *   3. 版本号已发布检查
 *   4. 构建（prepack / build）
 *   5. 临时 .npmrc 认证配置
 *   6. npm publish
 *
 * 对应原 scripts/publish-package.mjs 的核心逻辑。
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ===== 配置接口 =====

export interface PublishOptions {
  /** 包目录（默认: 当前目录） */
  packageDir?: string;
  /** 目标 registry（默认: https://registry.npmjs.org/） */
  registry?: string;
  /** Dry-run 模式，只预览不发布 */
  dryRun?: boolean;
  /** dist-tag（默认: latest） */
  tag?: string;
  /** OTP 二次验证码 */
  otp?: string;
  /** 发布访问级别（public | restricted） */
  access?: string;
  /** 跳过 git 工作区检查 */
  skipGitCheck?: boolean;
  /** 跳过版本号已发布检查 */
  skipVersionCheck?: boolean;
  /** 详细日志 */
  verbose?: boolean;
}

export interface PublishResult {
  success: boolean;
  packageName: string;
  version: string;
  dryRun: boolean;
  message: string;
}

// ===== 工具函数 =====

function run(cmd: string, cwd: string, opts?: { verbose?: boolean; timeout?: number }) {
  const options = { cwd, encoding: "utf-8" as const, timeout: 30_000, ...opts };
  if (opts?.verbose) console.log(`  $ ${cmd}`);
  try {
    const stdout = execSync(cmd, { ...options, stdio: "pipe" });
    const out = (stdout || "").toString().trim();
    if (opts?.verbose && out) console.log(`  => ${out}`);
    return out;
  } catch (err) {
    const stderr = ((err as Error & { stderr?: Buffer; stdout?: Buffer }).stderr ||
      (err as Error & { stderr?: Buffer; stdout?: Buffer }).stdout ||
      "").toString().trim();
    throw new Error(stderr || `Command failed: ${cmd}`);
  }
}

function tryRun(cmd: string, cwd: string) {
  try { return run(cmd, cwd); }
  catch { return ""; }
}

function registryHost(registry: string): string {
  try {
    const u = new URL(registry);
    return `//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "//registry.npmjs.org";
  }
}

const log = (msg: string) => console.log(`[publish] ${msg}`);
const warn = (msg: string) => console.warn(`[publish ⚠️] ${msg}`);
const error = (msg: string) => console.error(`[publish ❌] ${msg}`);

// ===== .npmrc 安全管理 =====

let _rcPath: string | null = null;
let _rcBackup: string | null = null;

function cleanupNpmrc() {
  if (!_rcPath) return;
  try { unlinkSync(_rcPath); } catch {}
  if (_rcBackup !== null) writeFileSync(_rcPath, _rcBackup, "utf-8");
}

// ===== 发布引擎 =====

export class PublishToolkit {
  private options: Required<PublishOptions>;

  constructor(options: PublishOptions = {}) {
    this.options = {
      packageDir: options.packageDir ?? process.cwd(),
      registry: options.registry ?? "https://registry.npmjs.org/",
      dryRun: options.dryRun ?? false,
      tag: options.tag ?? "latest",
      otp: options.otp ?? "",
      access: options.access ?? "public",
      skipGitCheck: options.skipGitCheck ?? false,
      skipVersionCheck: options.skipVersionCheck ?? false,
      verbose: options.verbose ?? false,
    };
  }

  async publish(npmToken: string): Promise<PublishResult> {
    const opts = this.options;
    const pkgDir = resolve(opts.packageDir);

    const startedAt = Date.now();
    const stepTimings: { step: string; ms: number }[] = [];

    const startStep = (name: string, extra?: string) => {
      const t = Date.now();
      return { done: (more?: string) => {
        const ms = Date.now() - t;
        stepTimings.push({ step: name, ms });
        const info = more || extra;
        if (info) log(`  ✓ ${name} 完成（${ms}ms） — ${info}`);
        else log(`  ✓ ${name} 完成（${ms}ms）`);
      }};
    };

    console.log("=".repeat(50));
    console.log("  @usethink/publish-toolkit — 发布");
    console.log("=".repeat(50));
    console.log();

    // ---- Step 1: 验证 ----
    log("Step 1: 验证参数");

    if (!npmToken) {
      error("缺少环境变量 NPM_TOKEN");
      return this.fail("", "", "缺少 NPM_TOKEN");
    }
    log("  ✓ NPM_TOKEN 已设置");

    if (!existsSync(pkgDir)) {
      error(`包目录不存在: ${pkgDir}`);
      return this.fail("", "", `包目录不存在: ${pkgDir}`);
    }

    const pkgJsonPath = resolve(pkgDir, "package.json");
    if (!existsSync(pkgJsonPath)) {
      error("未找到 package.json");
      return this.fail("", "", "未找到 package.json");
    }

    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    if (pkg.private === true) {
      error(`包 "${pkg.name}" 的 "private" 为 true，无法发布`);
      return this.fail("", "", "包为 private，无法发布");
    }

    const pkgName = pkg.name;
    const pkgVersion = pkg.version;
    log(`  包名: ${pkgName}`);
    log(`  版本: ${pkgVersion}`);
    log(`  registry: ${opts.registry}`);
    const step1 = startStep("验证参数");

    // ---- Step 2: git 检查 ----
    if (!opts.skipGitCheck) {
      log("Step 2: 检查 git");
      const gitRoot = tryRun("git rev-parse --show-toplevel 2>/dev/null", pkgDir);
      if (gitRoot) {
        const status = tryRun(`git -C "${gitRoot}" status --porcelain`, pkgDir);
        if (status) {
          error("工作区有未提交的变更:");
          console.error(status);
          return this.fail(pkgName, pkgVersion, "工作区有未提交的变更");
        }
      }
      const step2 = startStep("git 检查");
      if (opts.verbose) log(`  git root: ${gitRoot || "(非 git 仓库，已跳过)"}`);
    } else {
      warn("Step 2: 已跳过 git 检查（--no-git-check）");
    }

    // ---- Step 3: 版本检查 ----
    if (!opts.skipVersionCheck) {
      log("Step 3: 检查版本是否已发布");
      const published = tryRun(
        `npm view ${pkgName} version --registry=${opts.registry} 2>/dev/null || true`,
        pkgDir
      );
      const latestVer = published.split("\n").pop()?.trim();
      if (latestVer === pkgVersion) {
        error(`版本 ${pkgVersion} 已存在！请先 bump 版本号`);
        return this.fail(pkgName, pkgVersion, "版本已存在");
      }
      const step3 = startStep("版本检查", latestVer ? `registry 最新: ${latestVer}` : "首次发布");
      if (opts.verbose) log(`  npm view 输出: ${published || "(空)"}`);
    } else {
      warn("Step 3: 已跳过版本检查（--no-version-check）");
    }

    // ---- Step 4: 构建 ----
    log("Step 4: 构建");
    if (pkg.scripts?.prepack) {
      log("  prepack 脚本已定义（npm publish 自动执行），跳过手动构建");
      const step4 = startStep("构建", "prepack 已定义");
    } else if (pkg.scripts?.build) {
      if (opts.verbose) log(`  执行构建: pnpm run build || npm run build`);
      run("pnpm run build || npm run build", pkgDir, { verbose: opts.verbose });
      const step4 = startStep("构建");
    } else {
      warn("  无 build 脚本，跳过构建");
    }

    // ---- Step 5: .npmrc ----
    log("Step 5: 配置认证");
    const rcPath = resolve(pkgDir, ".npmrc");
    _rcPath = rcPath;
    _rcBackup = existsSync(rcPath) ? readFileSync(rcPath, "utf-8") : null;
    writeFileSync(
      rcPath,
      [
        `registry=${opts.registry}`,
        `${registryHost(opts.registry)}/:_authToken=${npmToken}`,
      ].join("\n") + "\n",
      "utf-8"
    );
    const step5 = startStep(".npmrc 配置");
    if (opts.verbose) log(`  写入: ${rcPath}`);

    // 注册清理钩子
    process.on("exit", cleanupNpmrc);
    process.on("SIGINT", () => { warn("收到 SIGINT，清理中..."); cleanupNpmrc(); process.exit(130); });
    process.on("SIGTERM", () => { warn("收到 SIGTERM，清理中..."); cleanupNpmrc(); process.exit(143); });

    // ---- Step 6: 发布 ----
    log("Step 6: 发布");
    const npmBin = tryRun("which pnpm 2>/dev/null", pkgDir) ? "pnpm" : "npm";
    const pubArgs = [
      "publish",
      `--registry=${opts.registry}`,
      `--access=${opts.access}`,
      `--tag=${opts.tag}`,
    ];
    if (npmBin === "pnpm") pubArgs.push("--no-git-checks");
    if (opts.dryRun) pubArgs.push("--dry-run");
    if (opts.otp) pubArgs.push(`--otp=${opts.otp}`);

    if (opts.dryRun) {
      log(`  [dry-run] 将执行: ${npmBin} ${pubArgs.join(" ")}`);
      log(`  [dry-run] 包名: ${pkgName}`);
      log(`  [dry-run] 版本: ${pkgVersion}`);
      log(`  [dry-run] registry: ${opts.registry}`);
      log(`  [dry-run] tag: ${opts.tag}`);
      log(`  [dry-run] access: ${opts.access}`);
      log(`  [dry-run] cwd: ${pkgDir}`);
      log(`  [dry-run] 注：不会实际发布，也不会写入 .npmrc`);
    } else {
      log(`  执行: ${npmBin} ${pubArgs.join(" ")}`);
    }

    if (!opts.dryRun) {
      try {
        run(`${npmBin} ${pubArgs.join(" ")}`, pkgDir, { verbose: opts.verbose });
        log(`  ✓ 发布成功！${pkgName}@${pkgVersion}`);
        console.log(`     https://www.npmjs.com/package/${pkgName}`);
      } catch (err) {
        const msg = (err as Error).message || "";
        error(`发布失败: ${msg}`);
        if (msg.includes("404")) error("  提示: 404 → scoped 包需要 --access public");
        if (msg.includes("403")) error("  提示: 403 → 权限不足，检查 NPM_TOKEN");
        if (msg.includes("401")) error("  提示: 401 → 认证失败，检查 NPM_TOKEN");
        if (msg.includes("EOTP")) error("  提示: 需要 OTP → 使用 --otp <code>");
        return this.fail(pkgName, pkgVersion, `发布失败: ${msg}`);
      }
    }

    // ---- 完成 ----
    console.log();
    console.log("=".repeat(50));
    const totalMs = Date.now() - startedAt;
    if (opts.dryRun) {
      log(`Dry-run 完成（${totalMs}ms）`);
      log(`  即将发布: ${pkgName}@${pkgVersion}`);
      log(`  目标: ${opts.registry}`);
      log(`  tag: ${opts.tag}`);
    } else {
      log(`🎉 发布完成: ${pkgName}@${pkgVersion}（${totalMs}ms）`);
    }
    console.log("=".repeat(50));
    if (opts.verbose) {
      console.log();
      console.log("步骤耗时:");
      stepTimings.forEach((s) => {
        console.log(`  - ${s.step}: ${s.ms}ms`);
      });
    }

    return {
      success: true,
      packageName: pkgName,
      version: pkgVersion,
      dryRun: opts.dryRun,
      message: opts.dryRun ? "Dry-run 成功" : `发布成功: ${pkgName}@${pkgVersion}`,
    };
  }

  private fail(pkgName: string, version: string, message: string): PublishResult {
    return { success: false, packageName: pkgName, version, dryRun: this.options.dryRun, message };
  }
}

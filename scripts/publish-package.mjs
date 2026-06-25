#!/usr/bin/env node

/**
 * @eforge/cf-core — npm 包发布脚本
 *
 * 两种用法：
 *   1. 本地手动发布（dry-run 预览 + 确认后正式发布）
 *   2. CI/CD 失败时应急抢救
 *
 * 用法：
 *   # 本地 dry-run 预览
 *   NPM_TOKEN=npm_xxx node scripts/publish-package.mjs --dry-run
 *
 *   # 正式发布
 *   NPM_TOKEN=npm_xxx node scripts/publish-package.mjs
 *
 *   # 指定 registry（如 GitHub Packages）
 *   NPM_TOKEN=ghp_xxx node scripts/publish-package.mjs --registry=https://npm.pkg.github.com --access=restricted
 *
 * 依赖：
 *   - 当前目录下需有 package.json（自动读取包名和版本号）
 *   - 环境变量 NPM_TOKEN
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ===== CLI 参数 =====
const args = process.argv.slice(2);
const parseArg = (flag) => {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1];
};
const hasFlag = (flag) => args.includes(flag);

const PKG_DIR        = resolve(process.cwd(), parseArg("--package") || ".");
const REGISTRY       = parseArg("--registry") || "https://registry.npmjs.org/";
const DRY_RUN        = hasFlag("--dry-run");
const DIST_TAG       = parseArg("--tag") || "latest";
const OTP_CODE       = parseArg("--otp");
const ACCESS         = parseArg("--access") || "public";
const SKIP_GIT_CHECK = hasFlag("--no-git-check");
const SKIP_VERSION_CHECK = hasFlag("--no-version-check");
const HELP           = hasFlag("--help") || hasFlag("-h");
const VERBOSE        = hasFlag("--verbose") || hasFlag("-v");

// ===== 帮助 =====
if (HELP) {
  console.log(`
@eforge/cf-core 发布脚本
=========================

用法：
  NPM_TOKEN=npm_xxx node scripts/publish-package.mjs [选项]

必要环境变量：
  NPM_TOKEN   npm 自动化 access token

可选参数：
  --package <path>   包目录（默认: 当前目录）
  --registry <url>   目标 registry（默认: https://registry.npmjs.org/）
  --dry-run          预览模式，不实际发布
  --tag <name>       dist-tag（默认: latest）
  --access <level>   发布访问级别（public | restricted，默认: public）
  --otp <code>       OTP 二次验证
  --no-git-check     跳过 git 检查
  --no-version-check 跳过版本号已发布检查
  --verbose, -v      详细日志
  --help, -h         帮助
`);
  process.exit(0);
}

// ===== 工具函数 =====

function run(cmd, opts = {}) {
  const options = { cwd: PKG_DIR, encoding: "utf-8", ...opts };
  if (VERBOSE) console.log(`  $ ${cmd}`);
  try {
    const stdout = execSync(cmd, { ...options, stdio: "pipe" });
    const out = (stdout || "").toString().trim();
    if (VERBOSE && out) console.log(`  => ${out.slice(0, 500)}`);
    return out;
  } catch (err) {
    const stderr = ((err.stderr || err.stdout || "")).toString().trim();
    throw new Error(stderr || `Command failed: ${cmd}`);
  }
}

function tryRun(cmd) {
  try { return run(cmd); }
  catch { return ""; }
}

function registryHost(registry) {
  try {
    const u = new URL(registry);
    return `//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "//registry.npmjs.org";
  }
}

const log   = (msg) => console.log(`[publish] ${msg}`);
const warn  = (msg) => console.warn(`[publish ⚠️] ${msg}`);
const error = (msg) => console.error(`[publish ❌] ${msg}`);

// ===== 安全管理 .npmrc =====
let _rcPath = null;
let _rcBackup = null;

function cleanupNpmrc() {
  if (!_rcPath) return;
  try { unlinkSync(_rcPath); } catch {}
  if (_rcBackup !== null) writeFileSync(_rcPath, _rcBackup, "utf-8");
}

process.on("exit", cleanupNpmrc);
process.on("SIGINT", () => { warn("收到 SIGINT，清理中..."); cleanupNpmrc(); process.exit(130); });
process.on("SIGTERM", () => { warn("收到 SIGTERM，清理中..."); cleanupNpmrc(); process.exit(143); });

// ===== 主流程 =====

function main() {
  console.log("=".repeat(50));
  console.log("  @eforge/cf-core 发布");
  console.log("=".repeat(50));
  console.log();

  // ---- Step 1: 验证 ----
  log("Step 1: 验证参数");

  const npmToken = process.env.NPM_TOKEN;
  if (!npmToken) {
    error("缺少环境变量 NPM_TOKEN");
    process.exit(1);
  }
  log("  ✓ NPM_TOKEN 已设置");

  if (!existsSync(PKG_DIR)) {
    error(`包目录不存在: ${PKG_DIR}`);
    process.exit(1);
  }
  const pkgJsonPath = resolve(PKG_DIR, "package.json");
  if (!existsSync(pkgJsonPath)) {
    error("未找到 package.json");
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  if (pkg.private === true) {
    error(`包 "${pkg.name}" 的 "private" 为 true，无法发布`);
    process.exit(1);
  }

  const pkgName    = pkg.name;
  const pkgVersion = pkg.version;
  log(`  包名: ${pkgName}`);
  log(`  版本: ${pkgVersion}`);
  log(`  registry: ${REGISTRY}`);

  // ---- Step 2: git 检查 ----
  if (!SKIP_GIT_CHECK) {
    log("Step 2: 检查 git");
    const gitRoot = tryRun("git rev-parse --show-toplevel 2>/dev/null");
    if (gitRoot) {
      const status = tryRun(`git -C "${gitRoot}" status --porcelain`);
      if (status) {
        error("工作区有未提交的变更:");
        console.error(status);
        error("请先提交或使用 --no-git-check");
        process.exit(1);
      }
    }
    log("  ✓ git 干净");
  }

  // ---- Step 3: 版本检查 ----
  if (!SKIP_VERSION_CHECK) {
    log("Step 3: 检查版本是否已发布");
    const published = tryRun(`npm view ${pkgName} version --registry=${REGISTRY} 2>/dev/null || true`);
    const latestVer = published.split("\n").pop().trim();
    if (latestVer === pkgVersion) {
      error(`版本 ${pkgVersion} 已存在！请先 bump 版本号`);
      process.exit(1);
    }
    log(`  ✓ ${latestVer ? `最新: ${latestVer}，${pkgVersion} 未发布` : "首次发布"}`);
  }

  // ---- Step 4: 构建 ----
  log("Step 4: 构建");
  if (pkg.scripts && pkg.scripts.prepack) {
    log("  prepack 脚本已定义（npm publish 自动执行），跳过手动构建");
  } else if (pkg.scripts && pkg.scripts.build) {
    run("pnpm run build || npm run build");
    log("  ✓ 构建完成");
  } else {
    warn("  无 build 脚本，跳过构建");
  }

  // ---- Step 5: .npmrc ----
  log("Step 5: 配置认证");
  const rcPath = resolve(PKG_DIR, ".npmrc");
  _rcPath   = rcPath;
  _rcBackup = existsSync(rcPath) ? readFileSync(rcPath, "utf-8") : null;
  writeFileSync(rcPath, [
    `registry=${REGISTRY}`,
    `${registryHost(REGISTRY)}/:_authToken=${npmToken}`,
  ].join("\n") + "\n", "utf-8");
  log("  ✓ 临时 .npmrc");

  // ---- Step 6: 发布 ----
  log("Step 6: 发布");
  const npmBin = tryRun("which pnpm 2>/dev/null") ? "pnpm" : "npm";
  const pubArgs = ["publish", `--registry=${REGISTRY}`, `--access=${ACCESS}`, `--tag=${DIST_TAG}`];
  if (npmBin === "pnpm") pubArgs.push("--no-git-checks");
  if (DRY_RUN) pubArgs.push("--dry-run");
  if (OTP_CODE) pubArgs.push(`--otp=${OTP_CODE}`);

  log(`  执行: ${npmBin} ${pubArgs.join(" ")}`);

  try {
    run(`${npmBin} ${pubArgs.join(" ")}`);
    if (DRY_RUN) {
      log("  ✓ Dry-run 成功！");
    } else {
      log(`  ✓ 发布成功！${pkgName}@${pkgVersion}`);
      console.log(`     https://www.npmjs.com/package/${pkgName}`);
    }
  } catch (err) {
    error(`发布失败: ${err.message}`);
    const msg = err.message || "";
    if (msg.includes("404")) error("  提示: 404 → scoped 包需要 --access public");
    if (msg.includes("403")) error("  提示: 403 → 权限不足，检查 NPM_TOKEN");
    if (msg.includes("401")) error("  提示: 401 → 认证失败，检查 NPM_TOKEN");
    if (msg.includes("EOTP")) error("  提示: 需要 OTP → 使用 --otp <code>");
    process.exit(1);
  }

  // ---- 完成 ----
  console.log();
  console.log("=".repeat(50));
  log(DRY_RUN ? "Dry-run 完成" : `🎉 发布完成: ${pkgName}@${pkgVersion}`);
  console.log("=".repeat(50));
}

try { main(); } catch (err) { error(`异常: ${err.message}`); process.exit(1); }

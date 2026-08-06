#!/usr/bin/env node
/**
 * verify-boundaries — cf-core 边界门禁（与 cf-admin-fe 正交分工，防越界）。
 *
 * 规则（README「与 @usethink/cf-admin-fe 的边界」段）：
 *  1. src/ 与 features/ 禁止 .vue 组件文件（本包是基础设施内核，不承载 UI 组件）。
 *  2. package.json 禁止依赖 @usethink/cf-admin-fe（双向零依赖、正交）。
 *  3. src/ 与 features/ 禁止 import '@usethink/cf-admin-fe'（管理端套件不得反向污染内核）。
 *
 * 用法：node scripts/verify-boundaries.mjs（已接入 verify:boundaries 与 prepublishOnly）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const failures = [];

function fail(message) {
  failures.push(message);
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// ── 规则 2：禁止依赖 cf-admin-fe ───────────────────────────────────────────
const allDepNames = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
];
for (const dep of allDepNames) {
  if (dep === "@usethink/cf-admin-fe" || dep.startsWith("@usethink/cf-admin-fe/")) {
    fail(`禁止依赖 ${dep}：cf-core 与 cf-admin-fe 双向零依赖、正交`);
  }
}

// ── 规则 1/3：扫描源码目录 ─────────────────────────────────────────────────
const ROOTS = [
  fileURLToPath(new URL("../src", import.meta.url)),
  fileURLToPath(new URL("../features", import.meta.url)),
];

function walkTs(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTs(full);
    } else if (extname(full) === ".vue") {
      fail(`${full.replace(/^.*\/(src|features)\//, "$1/")} 禁止 .vue 组件文件（UI 归 cf-admin-fe / 消费方，本包只承载纯 TS）`);
    } else if ((extname(full) === ".ts" && !full.endsWith(".d.ts")) || extname(full) === ".mjs") {
      collect(full);
    }
  }
}

const sources = [];
function collect(path) {
  sources.push(path);
}
for (const root of ROOTS) walkTs(root);

for (const file of sources) {
  const source = readFileSync(file, "utf8");
  const importLines = source.match(/^import[^;]+from\s+["']([^"']+)["']/gm) || [];
  for (const line of importLines) {
    const target = /from\s+["']([^"']+)["']/.exec(line)?.[1] || "";
    if (target === "@usethink/cf-admin-fe" || target.startsWith("@usethink/cf-admin-fe/")) {
      fail(`${file.replace(/^.*\/(src|features)\//, "$1/")} 禁止 import '@usethink/cf-admin-fe'（管理端套件不得反向污染内核）`);
    }
  }
}

if (failures.length > 0) {
  console.error("cf-core boundary checks failed:");
  for (const item of failures) console.error(`- ${item}`);
  process.exit(1);
}
console.log("cf-core boundary checks passed (no .vue, no cf-admin-fe dep/import).");

#!/usr/bin/env node

/**
 * Initialize public runtime values in the shared system_config table.
 *
 * This script is intentionally conservative: it writes public configuration
 * needed by web/admin clients, and refuses obvious secrets by default.
 */

import { createClient } from "@libsql/client";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);

const DEFAULT_KEYS = [
  "PROJECT_NAME",
  "WORKER_NAME",
  "DOMAIN",
  "BASE_URL",
  "TURNSTILE_SITE_KEY",
];

const SECRET_KEY_PATTERN = /(^|_)(SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIALS?|AUTH|API_KEY)($|_)/i;
const PUBLIC_KEY_ALLOWLIST = new Set(["TURNSTILE_SITE_KEY"]);

function hasFlag(flag) {
  return args.includes(flag);
}

function parseArg(flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx === args.length - 1) return undefined;
  return args[idx + 1];
}

function printHelp() {
  console.log(`
cf-core system_config initializer
=================================

Usage:
  TURSO_URL=libsql://... TURSO_TOKEN=... node scripts/init-system-config.mjs
  node scripts/init-system-config.mjs --credentials-dir .credentials
  node scripts/init-system-config.mjs --set SUPPORT_EMAIL=ops@example.com

Options:
  --credentials-dir <dir>   Read deployment-generated credential files (default: .credentials)
  --set KEY=VALUE           Add or override one public system_config value; repeatable
  --dry-run                 Print planned writes without touching the database
  --allow-secret-keys       Allow secret-looking keys passed via --set
  --help, -h                Show this help

Required for non-dry-run:
  TURSO_URL                 Turso/libSQL database URL
  TURSO_TOKEN               Turso/libSQL database auth token
`);
}

function readCredential(dir, key) {
  const path = resolve(dir, key);
  if (!existsSync(path)) return undefined;
  const value = readFileSync(path, "utf8").trim();
  return value || undefined;
}

function packageProjectName() {
  const pkgPath = resolve(process.cwd(), "package.json");
  if (!existsSync(pkgPath)) return basename(process.cwd());

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const name = typeof pkg.name === "string" ? pkg.name : "";
    return name.split("/").pop() || basename(process.cwd());
  } catch {
    return basename(process.cwd());
  }
}

function deriveDomain(baseUrl) {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(domainOrUrl) {
  if (!domainOrUrl) return undefined;
  if (/^https?:\/\//i.test(domainOrUrl)) return domainOrUrl.replace(/\/+$/, "");
  return `https://${domainOrUrl.replace(/\/+$/, "")}`;
}

function parseSetArgs() {
  const entries = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== "--set") continue;
    const raw = args[i + 1];
    if (!raw || !raw.includes("=")) {
      throw new Error("--set expects KEY=VALUE");
    }
    const idx = raw.indexOf("=");
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (!key) throw new Error("--set key cannot be empty");
    entries.push([key, value]);
    i += 1;
  }
  return entries;
}

function assertPublicKey(key, allowSecretKeys) {
  if (allowSecretKeys) return;
  if (PUBLIC_KEY_ALLOWLIST.has(key)) return;
  if (SECRET_KEY_PATTERN.test(key)) {
    throw new Error(
      `${key} looks like a secret. Refusing to write it to system_config. ` +
        "Use Worker secrets for secrets, or pass --allow-secret-keys if this is intentional.",
    );
  }
}

function collectEntries() {
  const credentialsDir = resolve(process.cwd(), parseArg("--credentials-dir") || ".credentials");
  const allowSecretKeys = hasFlag("--allow-secret-keys");
  const values = new Map();

  for (const key of DEFAULT_KEYS) {
    const value = process.env[key] || readCredential(credentialsDir, key);
    if (value) values.set(key, value);
  }

  if (!values.has("PROJECT_NAME")) values.set("PROJECT_NAME", packageProjectName());
  if (!values.has("BASE_URL") && values.has("DOMAIN")) {
    values.set("BASE_URL", normalizeBaseUrl(values.get("DOMAIN")));
  }
  if (!values.has("DOMAIN") && values.has("BASE_URL")) {
    const domain = deriveDomain(values.get("BASE_URL"));
    if (domain) values.set("DOMAIN", domain);
  }

  for (const [key, value] of parseSetArgs()) {
    assertPublicKey(key, allowSecretKeys);
    values.set(key, value);
  }

  for (const key of values.keys()) assertPublicKey(key, allowSecretKeys);

  return [...values.entries()]
    .filter(([, value]) => value !== undefined && value !== "")
    .sort(([a], [b]) => a.localeCompare(b));
}

async function ensureSystemConfigTable(client) {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);
}

async function upsertEntries(client, entries) {
  const updatedAt = new Date().toISOString();
  for (const [key, value] of entries) {
    await client.execute({
      sql: `
        INSERT INTO system_config (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `,
      args: [key, value, updatedAt],
    });
  }
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  const dryRun = hasFlag("--dry-run");
  const entries = collectEntries();

  if (entries.length === 0) {
    console.error("[system-config] No public config values found.");
    process.exit(1);
  }

  console.log(`[system-config] ${dryRun ? "Dry-run" : "Initializing"} ${entries.length} value(s):`);
  for (const [key, value] of entries) {
    console.log(`  - ${key}=${value}`);
  }

  if (dryRun) return;

  const url = process.env.TURSO_URL;
  const authToken = process.env.TURSO_TOKEN;

  if (!url || !authToken) {
    console.error("[system-config] TURSO_URL and TURSO_TOKEN are required for non-dry-run.");
    process.exit(1);
  }

  const client = createClient({ url, authToken });
  await ensureSystemConfigTable(client);
  await upsertEntries(client, entries);
  console.log("[system-config] Done.");
}

main().catch((err) => {
  console.error(`[system-config] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

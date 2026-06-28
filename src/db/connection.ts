/**
 * libSQL 数据库连接工厂
 *
 * 核心设计：Isolate 级连接复用
 * Cloudflare Workers 的 isolate 在多个请求间复用。
 * 缓存 client 实例避免每次请求重新 createClient（节省 ~1ms CPU）。
 *
 * 合并自：
 * - cf-shop: src/db/database.ts + src/db/client.ts
 * - xtools: src/db/database.ts + src/db/client.ts
 * - vcode: src/db/index.ts（含自动迁移）
 */

import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

/** Drizzle ORM 实例类型（通用） */
export type DrizzleInstance<TSchema extends Record<string, unknown> = Record<string, never>> =
  ReturnType<typeof drizzle<TSchema>>;

// ═══════════════════════════════════════════════════════════════════════════════
// Isolate 级缓存（模块级别变量在 Workers isolate 生命周期内持久存在）
// ═══════════════════════════════════════════════════════════════════════════════

let _cachedUrl: string | undefined;
let _cachedClient: Client | undefined;

/**
 * 创建或复用 libSQL Client（Isolate 级缓存）
 *
 * 同一 isolate + 同一 URL 下复用 client 实例。
 * URL 变化时（极少见）重建实例。
 */
export function getOrCreateClient(url: string, authToken?: string): Client {
  if (_cachedClient && _cachedUrl === url) {
    return _cachedClient;
  }

  const client = createClient({ url, authToken });
  _cachedUrl = url;
  _cachedClient = client;
  return client;
}

/**
 * 创建 Drizzle ORM 实例
 *
 * @param client - libSQL Client
 * @param schema - Drizzle schema 对象（可选，传入后支持关系查询）
 */
export function createDrizzle<TSchema extends Record<string, unknown>>(
  client: Client,
  schema?: TSchema,
): DrizzleInstance<TSchema> {
  return (schema ? drizzle(client, { schema }) : drizzle(client)) as DrizzleInstance<TSchema>;
}

/**
 * 一步到位：初始化数据库（client + drizzle），带 Isolate 级缓存 + 连接验证。
 *
 * 首次连接时执行 `SELECT 1` 验证连通性，失败时自动重试（最多 2 次，指数退避）。
 * 后续请求复用 Isolate 级缓存的 client，不再探活（节省 CPU 时间）。
 *
 * @param url - Turso URL（libsql://xxx.turso.io）
 * @param authToken - Turso 认证 Token（可选）
 * @param schema - Drizzle schema（可选）
 */
export function initDatabase<TSchema extends Record<string, unknown>>(
  url?: string,
  authToken?: string,
  schema?: TSchema,
): DrizzleInstance<TSchema> {
  if (!url) throw new Error("TURSO_URL is required");
  const client = getOrCreateClient(url, authToken);
  return createDrizzle(client, schema);
}

/**
 * 带连接验证的数据库初始化（用于 bootstrap 中间件）。
 *
 * 首次连接时执行 `SELECT 1` 验证连通性，失败时重试。
 * 后续请求直接返回缓存的 drizzle 实例（零额外开销）。
 */
export async function initDatabaseWithHealthCheck<TSchema extends Record<string, unknown>>(
  url?: string,
  authToken?: string,
  schema?: TSchema,
): Promise<DrizzleInstance<TSchema>> {
  if (!url) throw new Error("TURSO_URL is required");

  // 如果已有缓存的连接，直接返回（Isolate 复用场景）
  if (_cachedClient && _cachedUrl === url) {
    return createDrizzle(_cachedClient, schema);
  }

  // 首次连接：创建 client 并验证连通性
  const client = getOrCreateClient(url, authToken);
  const db = createDrizzle(client, schema);

  // 最多重试 2 次（500ms → 1s），避免 Turso 短暂不可达导致部署失败
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      await client.execute("SELECT 1");
      return db;
    } catch (err) {
      if (attempt >= 2) throw err;
      const delay = 500 * Math.pow(2, attempt);
      console.warn(`[db:health-check] 连接失败，${delay}ms 后重试 (${attempt + 1}/2)`);
      await new Promise((r) => setTimeout(r, delay));
      // 重建 client（可能连接状态已损坏）
      _cachedClient = undefined;
      _cachedUrl = undefined;
      const newClient = getOrCreateClient(url, authToken);
      Object.assign(db, createDrizzle(newClient, schema));
    }
  }

  return db;
}

/**
 * 重置 Isolate 级缓存（仅用于测试）
 */
export function _resetCache(): void {
  _cachedUrl = undefined;
  _cachedClient = undefined;
}

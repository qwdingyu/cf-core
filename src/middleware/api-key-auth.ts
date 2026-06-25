/**
 * API Key 认证中间件
 *
 * 功能：
 * - SHA-256 哈希存储（不存明文）
 * - 月度配额 + 原子递增（消除 TOCTOU 竞态）
 * - 支持 Bearer 和自定义 Header 提取
 * - 分级管理（free/basic/pro/enterprise）
 *
 * 来源：xtools + vcode api-auth.ts 合并
 */

import type { Context, Next } from "hono";
import { fail } from "../http.js";
import { sha256 } from "../security.js";
import { apiKeys } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

export interface ApiKeyContext {
  id: string;
  name: string;
  tier: string;
  userId: string;
  monthlyQuota: number;
  monthlyUsage: number;
}

interface ApiKeyDbLike {
  select: (...args: unknown[]) => {
    from: (table: typeof apiKeys) => {
      where: (cond: unknown) => {
        limit: (n: number) => Promise<Array<{
          id: string;
          name: string;
          keyHash: string;
          userId: string;
          tier: string;
          enabled: number;
          monthlyQuota: number;
          monthlyUsage: number;
          monthlyResetAt: string | null;
          expiresAt: string | null;
        }>>;
      };
    };
  };
  update: (table: typeof apiKeys) => {
    set: (data: Record<string, unknown>) => {
      where: (cond: unknown) => {
        returning: () => Promise<unknown[]>;
      };
    };
  };
}

export interface ApiKeyAuthOptions {
  /** Key 前缀（如 "xtools_"、"vcode_"），默认不限制 */
  prefix?: string;
  /** 是否必须认证，默认 true */
  required?: boolean;
  /** 自定义变量名（注入到 Hono Variables），默认 "apiKeyContext" */
  variableName?: string;
}

/**
 * 从请求中提取 API Key
 */
export function extractApiKey(c: Context, prefix?: string): string | null {
  // 1. Authorization: Bearer <key>
  const auth = c.req.header("Authorization");
  if (auth) {
    const parts = auth.split(" ");
    if (parts.length === 2) {
      const [scheme, credentials] = parts;
      if (
        (scheme.toLowerCase() === "bearer" || scheme.toLowerCase() === "token") &&
        (!prefix || credentials.startsWith(prefix))
      ) {
        return credentials;
      }
    }
  }

  // 2. X-API-Key header
  const apiKey = c.req.header("X-API-Key");
  if (apiKey && (!prefix || apiKey.startsWith(prefix))) {
    return apiKey;
  }

  return null;
}

/**
 * 创建 API Key 认证中间件
 */
export function createApiKeyAuth(options: ApiKeyAuthOptions = {}) {
  const { prefix, required = true, variableName = "apiKeyContext" } = options;

  return async (
    c: Context<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>,
    next: Next,
  ) => {
    const key = extractApiKey(c, prefix);

    if (!key) {
      if (required) return fail(c, "缺少 API Key", 401);
      await next();
      return;
    }

    const db = c.get("db") as ApiKeyDbLike | undefined;
    if (!db) return fail(c, "数据库不可用", 503);

    const keyHash = await sha256(key);
    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (rows.length === 0) return fail(c, "API Key 无效", 401);

    const record = rows[0];
    if (!record.enabled) return fail(c, "API Key 已禁用", 401);
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      return fail(c, "API Key 已过期", 401);
    }

    // 原子配额检查 + 递增
    if (record.monthlyQuota > 0) {
      const updated = await db
        .update(apiKeys)
        .set({
          monthlyUsage: sql`monthly_usage + 1`,
          lastUsedAt: new Date().toISOString(),
        })
        .where(and(eq(apiKeys.id, record.id), sql`monthly_usage < monthly_quota`))
        .returning();

      if (updated.length === 0) return fail(c, "已超过月度配额", 429);
    } else {
      await db
        .update(apiKeys)
        .set({
          monthlyUsage: sql`monthly_usage + 1`,
          lastUsedAt: new Date().toISOString(),
        })
        .where(eq(apiKeys.id, record.id));
    }

    const context: ApiKeyContext = {
      id: record.id,
      name: record.name,
      tier: record.tier || "free",
      userId: record.userId,
      monthlyQuota: record.monthlyQuota,
      monthlyUsage: record.monthlyUsage,
    };

    c.set(variableName, context);
    c.set("userId", record.userId || record.id);
    await next();
  };
}

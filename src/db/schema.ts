/**
 * @usethink/cf-core — 公共数据库 Schema
 *
 * 所有项目共享的 Drizzle ORM 表定义。
 * 各项目在此基础上添加自己的业务表。
 *
 * 公共表清单：
 * 1. systemConfig — 系统配置（KV 存储，热生效）
 * 2. adminAuditLogs — 管理员审计日志
 * 3. rateLimitWindows — 限流计数窗口（DB 版限流）
 * 4. idempotencyKeys — 幂等键（防重复提交）
 * 5. apiKeys — API Key 认证（可选启用）
 *
 * 来源：eshop/xtools/vcode 三项目 schema.ts 中公共部分提取
 */

import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. 系统配置表（KV 存储，热生效）
// ═══════════════════════════════════════════════════════════════════════════════

export const systemConfig = sqliteTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").default("").notNull(),
  updatedAt: text("updated_at").default("").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. 管理员审计日志表
// ═══════════════════════════════════════════════════════════════════════════════

export const adminAuditLogs = sqliteTable("admin_audit_logs", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  targetType: text("target_type").default("").notNull(),
  targetId: text("target_id").default("").notNull(),
  metadataJson: text("metadata_json").default("{}").notNull(),
  ipHash: text("ip_hash").default("").notNull(),
  createdAt: text("created_at").default("").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 限流窗口表（DB 版限流 — 原子 upsert）
// ═══════════════════════════════════════════════════════════════════════════════

export const rateLimitWindows = sqliteTable(
  "rate_limit_windows",
  {
    action: text("action").notNull(),
    ipHash: text("ip_hash").notNull(),
    windowStart: integer("window_start").notNull(),
    requestCount: integer("request_count").default(0).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.action, table.ipHash, table.windowStart] }),
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 幂等键表（防重复提交）
// ═══════════════════════════════════════════════════════════════════════════════

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  key: text("key").notNull(),
  action: text("action").notNull(),
  resourceId: text("resource_id").notNull(),
  responseJson: text("response_json").notNull(),
  createdAt: text("created_at").default("").notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. API Key 表（可选启用）
// ═══════════════════════════════════════════════════════════════════════════════

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  userId: text("user_id").default("").notNull(),
  tier: text("tier").default("free").notNull(),
  enabled: integer("enabled").default(1).notNull(),
  monthlyQuota: integer("monthly_quota").default(0).notNull(),
  monthlyUsage: integer("monthly_usage").default(0).notNull(),
  monthlyResetAt: text("monthly_reset_at"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").default("").notNull(),
  updatedAt: text("updated_at").default("").notNull(),
  expiresAt: text("expires_at"),
});

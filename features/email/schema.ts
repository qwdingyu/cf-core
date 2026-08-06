/**
 * email_log — 邮件发送日志 Drizzle SQLite 表（docs/090 标准 schema）
 *
 * 所有 cf-* 项目统一使用此表定义，避免各自建表导致字段漂移。
 * 使用方式：
 *   import { emailLog } from "@usethink/cf-core/features/email/schema";
 *   // 加入项目的 migration 列表
 *
 * 状态机：pending → sent | failed
 */
import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const emailLog = sqliteTable(
  "email_log",
  {
    id: text("id").primaryKey(),
    toAddr: text("to_addr").notNull(),
    subject: text("subject"),
    status: text("status").notNull(), // pending | sent | failed
    provider: text("provider"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("email_log_status_idx").on(t.status)],
);

/** CREATE TABLE SQL（供 migrate.mjs 等手动迁移脚本使用） */
export const EMAIL_LOG_CREATE_SQL = `
CREATE TABLE IF NOT EXISTS "email_log" (
  id TEXT PRIMARY KEY NOT NULL,
  to_addr TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL,
  provider TEXT,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_log_status_idx ON "email_log" (status);
`.trim();

/**
 * 审计日志模块
 *
 * 提供管理员操作审计和通用事件日志。
 * 设计为 fire-and-forget：写入失败不阻塞主流程。
 * 内置 5% 概率自动清理旧日志，避免数据无限增长。
 *
 * 来源：eshop/vcode audit-service.ts 合并
 */

import { adminAuditLogs } from "./db/schema.js";

/**
 * 通用 Drizzle 数据库接口（仅约束审计模块需要的方法）
 */
interface AuditDbLike {
  insert: (table: typeof adminAuditLogs) => {
    values: (data: {
      id: string;
      action: string;
      targetType: string;
      targetId: string;
      metadataJson: string;
      ipHash: string;
      createdAt: string;
    }) => Promise<unknown>;
  };
  $client?: {
    execute: (sql: string) => Promise<unknown>;
  };
}

export interface AuditInput {
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: unknown;
  ipHash?: string;
}

/**
 * 写入管理员审计日志
 *
 * fire-and-forget 模式：调用方应使用 ctx.waitUntil() 或直接 await。
 * 写入失败仅打印 warn，不抛异常。
 */
export async function writeAdminAudit(db: AuditDbLike, input: AuditInput): Promise<void> {
  try {
    await db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(),
      action: input.action,
      targetType: input.targetType || "",
      targetId: input.targetId || "",
      metadataJson: JSON.stringify(input.metadata || {}),
      ipHash: input.ipHash || "",
      createdAt: new Date().toISOString(),
    });

    // 5% 概率清理超过 90 天的旧日志
    if (Math.random() < 0.05) {
      try {
        db.$client?.execute(
          `DELETE FROM admin_audit_logs WHERE created_at < datetime('now', '-90 days')`,
        ).catch(() => {});
      } catch { /* mock DB may not have execute */ }
    }
  } catch (err) {
    console.warn("[audit] writeAdminAudit failed:", err instanceof Error ? err.message : String(err));
  }
}

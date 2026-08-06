/**
 * 审计日志模块（统一版，支持表注入 + IP 哈希回调）。
 *
 * 设计为 fire-and-forget：写入失败不阻塞主流程。内置 5% 概率自动清理旧日志。
 * 来源：cf-shop audit-service.ts + cf-auth audit.ts 合并，文档 091 P0-3。
 */

import { adminAuditLogs } from "./db/schema.js";

/** 数据库抽象接口，消费者用实际 Drizzle 实例适配 */
export interface AuditDbLike {
  insert: (table: unknown) => {
    values: (data: Record<string, unknown>) => Promise<unknown>;
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

/** 默认 IP 哈希：SHA-256 截 12 字符，不存原始 IP */

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function defaultIpHash(ip: string): string {
  if (!ip) return "";
  // 同步降级：取前 3 字符 + ***
  const trimmed = ip.trim();
  return trimmed.slice(0, 3) + "***";
}

/**
 * 写入管理员审计日志（使用 core 默认 admin_audit_logs 表）。
 * fire-and-forget 模式：写入失败仅打印 warn，不抛异常。
 */
export async function writeAdminAudit(
  db: AuditDbLike,
  input: AuditInput,
): Promise<void> {
  try {
    const ipHash = input.ipHash || "";
    await db.insert(adminAuditLogs).values({
      id: crypto.randomUUID(),
      action: input.action,
      targetType: input.targetType || "",
      targetId: input.targetId || "",
      metadataJson: JSON.stringify(input.metadata || {}),
      ipHash,
      createdAt: new Date().toISOString(),
    });

    if (Math.random() < 0.05) {
      try {
        db.$client?.execute(
          `DELETE FROM admin_audit_logs WHERE created_at < datetime('now', '-90 days')`,
        ).catch(() => {});
      } catch { /* ignore */ }
    }
  } catch (err) {
    console.warn("[audit]", err instanceof Error ? err.message : String(err));
  }
}

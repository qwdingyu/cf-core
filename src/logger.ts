/**
 * 结构化日志模块
 *
 * 提供 JSON 格式的结构化日志输出，便于 Workers 日志分析和 Cloudflare 日志查询。
 *
 * 来源：vcode src/lib/logger.ts
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

function createEntry(level: LogLevel, message: string, meta?: Record<string, unknown>): LogEntry {
  return { level, message, timestamp: new Date().toISOString(), ...meta };
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>) {
    console.log(JSON.stringify(createEntry("debug", message, meta)));
  },

  info(message: string, meta?: Record<string, unknown>) {
    console.log(JSON.stringify(createEntry("info", message, meta)));
  },

  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(JSON.stringify(createEntry("warn", message, meta)));
  },

  error(message: string, meta?: Record<string, unknown>) {
    console.error(JSON.stringify(createEntry("error", message, meta)));
  },

  /** 业务日志 — 资源操作（凭证/订单/卡密等） */
  resourceAction(action: string, resourceId: string, meta?: Record<string, unknown>) {
    this.info(`resource.${action}`, { resourceId, ...meta });
  },

  /** 业务日志 — 渠道/驱动操作 */
  channelAction(action: string, channel: string, meta?: Record<string, unknown>) {
    this.info(`channel.${action}`, { channel, ...meta });
  },

  /** 业务日志 — 定时任务 */
  cronJob(jobName: string, meta?: Record<string, unknown>) {
    this.info(`cron.${jobName}`, meta);
  },

  /** 安全日志 — 认证/授权事件 */
  security(action: string, meta?: Record<string, unknown>) {
    this.warn(`security.${action}`, meta);
  },

  /** 审计日志 — 管理操作 */
  audit(action: string, adminId: string, targetId?: string, meta?: Record<string, unknown>) {
    this.info(`audit.${action}`, { adminId, targetId, ...meta });
  },
};

/**
 * @eforge/cf-core — Cloudflare Workers 共享内核
 *
 * 统一导出所有模块，支持两种导入方式：
 *
 * 1. 从根导入（适合小项目）：
 *    import { ok, fail, sha256, verifyTurnstile } from "@eforge/cf-core";
 *
 * 2. 按子路径导入（推荐，tree-shakeable）：
 *    import { ok, fail } from "@eforge/cf-core/http";
 *    import { sha256 } from "@eforge/cf-core/security";
 */

// ── HTTP 工具 ──
export { ok, fail, failRateLimit, getOrigin, safeJsonBody, maskContact, normalizeCode, csvEscape, toCsv } from "./http";

// ── 安全工具 ──
export {
  sha256,
  constantTimeEqual,
  getIpHash,
  getClientIp,
  getBearerToken,
  verifyTurnstile,
  buildSecurityHeaders,
  type SecurityHeadersOptions,
} from "./security";

// ── 缓存 ──
export { createCache, cache } from "./cache";

// ── 限流 ──
export { MemoryRateLimiter, KvRateLimiter, DbRateLimiter, type RateLimiter } from "./rate-limit";

// ── 幂等性 ──
export { checkIdempotency, saveIdempotentResponse, getIdempotentResponse } from "./idempotency";

// ── 审计日志 ──
export { writeAdminAudit, type AuditInput } from "./audit";

// ── 系统配置 ──
export { SystemConfig, type SystemConfigOptions } from "./config";

// ── 错误处理 ──
export { classifyError, retryWithBackoff, ErrorType, type RetryOptions } from "./error";

// ── 结构化日志 ──
export { logger, type LogLevel, type LogEntry } from "./logger";

// ── 加解密 ──
export { encrypt, decrypt, isEncryptionAvailable, generateUUID } from "./crypto";

// ── 数据库 ──
export { initDatabase, initDatabaseWithHealthCheck, getOrCreateClient, createDrizzle, type DrizzleInstance } from "./db/connection";

// ── 公共 Schema ──
export {
  systemConfig,
  adminAuditLogs,
  rateLimitWindows,
  idempotencyKeys,
  apiKeys,
} from "./db/schema";

// ── 认证 ──
export { signJwt, verifyJwt, extractJwt, type JwtPayload } from "./auth/jwt";
export { hashPassword, verifyPassword } from "./auth/password";

// ── 中间件 ──
export { createAdminAuth, type AdminAuthOptions } from "./middleware/admin-auth";
export { createApiKeyAuth, extractApiKey, type ApiKeyAuthOptions, type ApiKeyContext } from "./middleware/api-key-auth";

// ── Bootstrap ──
export { bootstrap, type BootstrapOptions } from "./bootstrap";

// ── 类型 ──
export type {
  CoreBindings,
  CoreVariables,
  CoreEnv,
  OkResponse,
  FailResponse,
  TurnstileResult,
  RateLimitResult,
} from "./types";

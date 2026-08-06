/**
 * @usethink/cf-core — Cloudflare Workers 共享内核
 *
 * 统一导出所有模块，支持两种导入方式：
 *
 * 1. 从根导入（适合小项目）：
 *    import { ok, fail, sha256, verifyTurnstile } from "@usethink/cf-core";
 *
 * 2. 按子路径导入（推荐，tree-shakeable）：
 *    import { ok, fail } from "@usethink/cf-core/http";
 *    import { sha256 } from "@usethink/cf-core/security";
 */

// ── HTTP 工具 ──
export { ok, fail, failRateLimit, getOrigin, safeJsonBody, maskContact, normalizeCode, csvEscape, toCsv } from "./http.js";

// ── 无业务小工具 ──
export { clampInteger, isValidEmail } from "./utils.js";

// ── 双平台适配 ──
export { getEnv, waitUntil, getTruncatedBody } from "./platform.js";

// ── 安全工具 ──
export {
  sha256,
  constantTimeEqual,
  timingSafeEqualHex,
  timingSafeEqualString,
  getIpHash,
  getClientIp,
  getBearerToken,
  verifyTurnstile,
  buildSecurityHeaders,
  type SecurityHeadersOptions,
} from "./security.js";

// ── 缓存 ──
export { createCache, cache } from "./cache.js";

// ── 限流 ──
export { MemoryRateLimiter, KvRateLimiter, DbRateLimiter, type RateLimiter } from "./rate-limit.js";

// ── 幂等性 ──
export {
  checkIdempotency,
  saveIdempotentResponse,
  getIdempotentResponse,
  clearPendingIdempotency,
  clearCachedIdempotentResponse,
  hashIdempotencyRequest,
  isStrongIdempotencyKey,
  IDEMPOTENCY_PENDING_LEASE_MS,
  STRONG_IDEMPOTENCY_KEY_PATTERN,
  type IdempotencyCheckResult,
  type IdempotencyDb,
} from "./idempotency.js";

// ── 审计日志 ──
export { writeAdminAudit, type AuditInput } from "./audit.js";

// ── 系统配置 ──
export { SystemConfig, type SystemConfigOptions } from "./config.js";

// ── 错误处理 ──
export { classifyError, retryWithBackoff, ErrorType, type RetryOptions } from "./error.js";

// ── 结构化日志 ──
export { logger, type LogLevel, type LogEntry } from "./logger.js";

// ── 加解密 ──
export { encrypt, decrypt, isEncryptionAvailable, generateUUID } from "./crypto.js";

// ── 媒体图片 ──
export {
  MEDIA_IMAGE_CACHE_CONTROL,
  detectMediaImage,
  validateMediaImage,
  createMediaImageKey,
  isManagedMediaImageKey,
  getManagedMediaImageContentType,
  type SupportedMediaImage,
  type ValidateMediaImageOptions,
} from "./media-image.js";

// ── API body limit ──
export {
  createApiBodyLimitResolver,
  mediaUploadRequestLimitBytes,
  isContentLengthOverLimit,
  readRequestBodyWithinLimit,
  rebuildRequestWithBody,
  type ApiBodyLimitOptions,
  type ApiBodyLimitResolver,
  type ReadBodyWithinLimitResult,
  type ReadBodyWithinLimitOk,
  type ReadBodyWithinLimitOversize,
} from "./api-body-limit.js";

// ── 敏感配置加密封装 ──
export {
  SECRET_CONFIG_PREFIX_V1,
  SECRET_CONFIG_PREFIX_V2_CORE_JSON,
  isValidSecretEncryptionKey,
  encryptSecretConfigValue,
  decryptSecretConfigValue,
  decryptSecretConfigResult,
  decryptSecretConfigValueObserved,
  // Legacy encrypt helpers: test/migration only — do not use for new writes
  encryptSecretConfigValueLegacyRaw,
  encryptSecretConfigValueLegacyV1CoreJson,
  type SecretDecryptResult,
  type SecretDecryptOk,
  type SecretDecryptFail,
  type SecretDecryptObserveEvent,
} from "./secret-config.js";

// ── 数据库 ──
export { initDatabase, initDatabaseWithHealthCheck, getOrCreateClient, createDrizzle, type DrizzleInstance } from "./db/connection.js";

// ── 公共 Schema ──
export {
  systemConfig,
  adminAuditLogs,
  rateLimitWindows,
  idempotencyKeys,
  apiKeys,
} from "./db/schema.js";

// ── 认证 ──
export { signJwt, verifyJwt, extractJwt, signJwtWithClaims, verifyJwtClaims, type JwtPayload, type JwtClaims, type JwtClaimsVerified } from "./auth/jwt.js";
export { hashPassword, verifyPassword } from "./auth/password.js";

// ── 中间件 ──
export { createAdminAuth, type AdminAuthOptions } from "./middleware/admin-auth.js";
export { createApiKeyAuth, extractApiKey, type ApiKeyAuthOptions, type ApiKeyContext } from "./middleware/api-key-auth.js";

// ── Bootstrap ──
export { bootstrap, type BootstrapOptions } from "./bootstrap.js";

// ── 类型 ──
export type {
  CoreBindings,
  CoreVariables,
  CoreEnv,
  OkResponse,
  FailResponse,
  TurnstileResult,
  RateLimitResult,
} from "./types.js";

/**
 * @eforge/cf-core — 公共类型定义
 *
 * 所有项目共享的基础类型约束。
 * 各项目通过 extends 扩展自己的 AppEnv，保持与 cf-core 兼容。
 */

/**
 * 所有 Cloudflare Workers 项目必须满足的最小 Bindings 约束。
 * 各项目在此基础上添加自己的环境变量。
 */
export interface CoreBindings {
  TURSO_URL?: string;
  TURSO_TOKEN?: string;
  ADMIN_TOKEN?: string;
  TURNSTILE_SECRET_KEY?: string;
  RATE_LIMIT_SALT?: string;
  APP_ORIGIN?: string;
}

/**
 * Hono Variables 的最小约束。
 * 各项目的 Variables 至少包含 db 字段，类型由项目自行指定。
 */
export interface CoreVariables {
  db: unknown;
}

/**
 * Hono 上下文的最小环境约束。
 * cf-core 中所有需要 Context 的函数都以此为泛型上界。
 */
export interface CoreEnv {
  Bindings: CoreBindings;
  Variables: CoreVariables;
}

/**
 * ok/fail 统一响应格式。
 */
export interface OkResponse {
  ok: true;
  [key: string]: unknown;
}

export interface FailResponse {
  ok: false;
  error: string;
  details?: unknown;
}

/**
 * Turnstile 验证结果。
 */
export interface TurnstileResult {
  ok: boolean;
  message?: string;
}

/**
 * 限流检查结果。
 */
export interface RateLimitResult {
  ok: boolean;
  message?: string;
  status?: number;
  ipHash?: string;
  remaining?: number;
  resetMs?: number;
}

/**
 * 错误分类与指数退避重试
 *
 * 区分可重试 / 不可重试 / 需延迟重试的错误类型，
 * 配合指数退避（exponential backoff + jitter）减少无效重试。
 *
 * 来源：xtools src/lib/error-classifier.ts
 */

export enum ErrorType {
  /** 网络超时、5xx 服务器错误 → 可重试 */
  TRANSIENT = "transient",
  /** 4xx 认证失败、invalid_grant → 不可重试 */
  PERMANENT = "permanent",
  /** 429 Too Many Requests → 延迟重试 */
  RATE_LIMIT = "rate_limit",
}

const PERMANENT_KEYWORDS = [
  "invalid_grant",
  "invalid_client",
  "unauthorized",
  "interaction_required",
  "access_denied",
  "invalid_token",
  "401",
  "403",
  "account_disabled",
  "consent_required",
];

const RATE_LIMIT_KEYWORDS = [
  "429",
  "too many requests",
  "rate limit",
  "throttl",
];

/**
 * 分类错误类型
 */
export function classifyError(error: unknown): ErrorType {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (RATE_LIMIT_KEYWORDS.some((kw) => message.includes(kw))) {
    return ErrorType.RATE_LIMIT;
  }
  if (PERMANENT_KEYWORDS.some((kw) => message.includes(kw))) {
    return ErrorType.PERMANENT;
  }
  return ErrorType.TRANSIENT;
}

export interface RetryOptions {
  /** 最大重试次数（默认 3） */
  maxRetries?: number;
  /** 基础延迟毫秒（默认 1000） */
  baseDelayMs?: number;
  /** 限流延迟倍数（默认 5） */
  rateLimitMultiplier?: number;
  /** 最大延迟毫秒（默认 30000） */
  maxDelayMs?: number;
  /** 重试回调（用于日志） */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

/**
 * 带指数退避的重试执行器
 *
 * - TRANSIENT: 指数退避（1s → 2s → 4s）
 * - RATE_LIMIT: 更长延迟（5s → 10s → 20s）
 * - PERMANENT: 立即抛出，不重试
 *
 * @example
 * const result = await retryWithBackoff(
 *   () => fetchExternalApi(),
 *   { maxRetries: 3, onRetry: (n, err, ms) => console.warn(`重试 #${n}: ${err.message} (${ms}ms)`) }
 * );
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    rateLimitMultiplier = 5,
    maxDelayMs = 30_000,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorType = classifyError(error);

      if (errorType === ErrorType.PERMANENT) {
        throw error;
      }
      if (attempt >= maxRetries) {
        break;
      }

      let delayMs: number;
      if (errorType === ErrorType.RATE_LIMIT) {
        delayMs = Math.min(baseDelayMs * rateLimitMultiplier * Math.pow(2, attempt), maxDelayMs);
      } else {
        delayMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      }

      // 随机抖动（±20%），避免雷群效应
      const jitter = delayMs * 0.2 * (Math.random() * 2 - 1);
      delayMs = Math.round(delayMs + jitter);

      onRetry?.(attempt + 1, error as Error, delayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

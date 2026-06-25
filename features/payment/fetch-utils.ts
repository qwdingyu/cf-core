/**
 * 支付功能模块 — HTTP 工具
 *
 * 带超时和指数退避重试的 fetch 封装。
 * 所有第三方 API 调用都应通过此函数，避免 Workers CPU 耗尽。
 */

const FETCH_TIMEOUT_MS = 10_000;
const FETCH_RETRIES = 2;
const RETRY_DELAYS = [500, 1500];

/**
 * 带超时和指数退避重试的 fetch 封装。
 *
 * HTTP 4xx 不重试（客户端错误），5xx/网络错误重试。
 * 超时通过 AbortController 实现，兼容 Workers 环境。
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit & { retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const maxRetries = options.retries ?? FETCH_RETRIES;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  let lastError = "";

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // 4xx 不重试（客户端错误）
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) return resp;

      // 5xx 或 429 重试
      if (!resp.ok && attempt <= maxRetries) {
        lastError = `HTTP ${resp.status}`;
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1] ?? 1000));
        continue;
      }

      return resp;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        lastError = `Timeout after ${timeoutMs}ms`;
      } else {
        lastError = err instanceof Error ? err.message : String(err);
      }

      if (attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1] ?? 1000));
        continue;
      }
      throw new Error(`[fetchWithRetry] ${lastError} (after ${attempt - 1} retries)`);
    }
  }

  throw new Error(`[fetchWithRetry] ${lastError} (after ${maxRetries + 1} attempts)`);
}

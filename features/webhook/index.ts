/**
 * webhook — Webhook 通知插件
 *
 * 支持：
 * - 多 URL 通知（逗号分隔）
 * - HMAC-SHA256 签名
 * - 5s 超时 + 最多 2 次重试
 * - 事件类型过滤
 *
 * 来源：xtools src/services/webhook.ts
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════════

export interface WebhookConfig {
  /** 通知 URL（支持多个，逗号分隔） */
  urls: string;
  /** HMAC-SHA256 签名密钥（可选） */
  secret?: string;
  /** 请求超时（毫秒，默认 5000） */
  timeoutMs?: number;
  /** 最大重试次数（默认 2） */
  maxRetries?: number;
}

export interface WebhookPayload {
  /** 事件类型 */
  event: string;
  /** 事件时间 ISO 8601 */
  timestamp: string;
  /** 事件数据 */
  data: Record<string, unknown>;
}

export interface WebhookResult {
  ok: boolean;
  url: string;
  status?: number;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WebhookService
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Webhook 通知服务
 *
 * @example
 * ```ts
 * import { WebhookService } from "@usethink/cf-core/plugins/webhook";
 *
 * const webhook = new WebhookService({
 *   urls: "https://hooks.example.com/a,https://hooks.example.com/b",
 *   secret: "my-secret",
 * });
 *
 * await webhook.notify("order.paid", { orderId: "123", amount: 9900 });
 * ```
 */
export class WebhookService {
  readonly name = "webhook";
  readonly version = "0.1.0";

  private urls: string[];
  private secret?: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(config: WebhookConfig) {
    this.urls = config.urls
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u.startsWith("http"));
    this.secret = config.secret;
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.maxRetries = config.maxRetries ?? 2;
  }

  /**
   * 发送通知到所有 URL
   */
  async notify(event: string, data: Record<string, unknown>): Promise<WebhookResult[]> {
    if (this.urls.length === 0) return [];

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const results: WebhookResult[] = [];

    for (const url of this.urls) {
      const result = await this.sendToUrl(url, payload);
      results.push(result);
    }

    return results;
  }

  /**
   * 发送通知到单个 URL
   */
  private async sendToUrl(url: string, payload: WebhookPayload): Promise<WebhookResult> {
    const body = JSON.stringify(payload);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Webhook-Event": payload.event,
      "X-Webhook-Timestamp": payload.timestamp,
    };

    if (this.secret) {
      const signature = await this.sign(body);
      headers["X-Webhook-Signature"] = signature;
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        const res = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (res.ok) {
          return { ok: true, url, status: res.status };
        }

        if (res.status >= 400 && res.status < 500) {
          return { ok: false, url, status: res.status, error: `HTTP ${res.status}` };
        }

        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }

        return { ok: false, url, status: res.status, error: `HTTP ${res.status} after ${this.maxRetries + 1} attempts` };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return { ok: false, url, error: errMsg };
      }
    }

    return { ok: false, url, error: "unexpected" };
  }

  /**
   * HMAC-SHA256 签名
   */
  private async sign(body: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.secret!),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * 是否有可用的 URL
   */
  get isConfigured(): boolean {
    return this.urls.length > 0;
  }
}

/**
 * email-resend — Resend 邮件发送插件
 *
 * 通过 Resend API 发送事务邮件，支持：
 * - 模板插值（{{变量}}）+ HTML 转义
 * - 3 次重试（指数退避）
 * - 邮件日志记录（可选，需传入 Drizzle DB 实例）
 *
 * 来源：cf-shop src/services/email-service.ts
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 模板引擎
// ═══════════════════════════════════════════════════════════════════════════════

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c),
  );
}

export function interpolate(template: string, data: Record<string, string>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(String(data[key] ?? "")))
    .replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, content) =>
      data[key] ? content : "",
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EmailService
// ═══════════════════════════════════════════════════════════════════════════════

export interface EmailTemplate {
  subject: string;
  html: string;
}

export interface ResendConfig {
  apiKey: string;
  from?: string;
  defaultFrom?: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Resend 邮件发送服务
 *
 * @example
 * ```ts
 * import { EmailService } from "@usethink/cf-core/plugins/email-resend";
 *
 * const email = new EmailService({ apiKey: env.RESEND_API_KEY, from: "noreply@example.com" });
 * const result = await email.send({
 *   to: "buyer@example.com",
 *   subject: "订单确认",
 *   html: "<h1>您的订单已确认</h1>",
 * });
 * ```
 */
export class EmailService {
  readonly name = "email-resend";
  readonly version = "0.1.0";

  private config: ResendConfig;

  constructor(config: ResendConfig) {
    this.config = config;
  }

  /**
   * 发送邮件
   */
  async send(opts: SendEmailOptions): Promise<SendResult> {
    const { to, subject, html } = opts;
    const from = opts.from || this.config.from || this.config.defaultFrom || "noreply@example.com";

    if (!to || !to.includes("@")) {
      return { ok: false, error: "无效的收件人邮箱" };
    }

    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [500, 1000, 2000];
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from, to, subject, html }),
        });

        const data = (await res.json()) as { id?: string; message?: string };

        if (res.ok) {
          return { ok: true, messageId: data.id };
        }

        if (res.status >= 400 && res.status < 500) {
          return { ok: false, error: data.message || `HTTP ${res.status}` };
        }

        lastError = data.message || `HTTP ${res.status}`;
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1]));
          continue;
        }

        return { ok: false, error: lastError };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1]));
          continue;
        }
        return { ok: false, error: lastError };
      }
    }

    return { ok: false, error: lastError };
  }

  /**
   * 使用模板发送邮件
   */
  async sendWithTemplate(
    to: string,
    template: EmailTemplate,
    data: Record<string, string>,
    opts?: { from?: string },
  ): Promise<SendResult> {
    const subject = interpolate(template.subject, data);
    const html = interpolate(template.html, data);
    return this.send({ to, subject, html, from: opts?.from });
  }

  /**
   * 健康检查 — 验证 API Key 是否有效
   */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: "test@test.com", to: "test@test.com", subject: "", html: "" }),
      });
      // 422 = 参数无效但 Key 有效; 401/403 = Key 无效
      return res.status !== 401 && res.status !== 403;
    } catch {
      return false;
    }
  }
}

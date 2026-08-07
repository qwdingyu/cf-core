/**
 * remote — cf-auth 邮件网关通道（docs/093）
 *
 * 消费方通过 OAuth client 认证调用 cf-auth 的 POST /api/email/send，
 * 由 cf-auth 集中发送（email_config 多通道链 + email-log 日志）。
 * 消费方无需配置 Resend/Cloudflare/SMTP，只需一个 client_id/client_secret。
 */
import type { SendResult } from "./index.js";

/** cf-auth 邮件网关远端配置 */
export interface EmailRemoteOptions {
  /** cf-auth 邮件网关地址，如 https://auth.eforge.xyz/api/email/send */
  url: string;
  /** OAuth client_id（cf-auth admin/clients 页面创建） */
  clientId: string;
  /** OAuth client_secret（创建 client 时一次性展示） */
  clientSecret: string;
  /** 超时（ms），默认 8000 */
  timeoutMs?: number;
}

/**
 * 通过 cf-auth 邮件网关发送（POST /api/email/send，Basic 认证）。
 */
export async function sendViaRemote(
  remote: EmailRemoteOptions,
  opts: { from?: string; to: string; subject: string; html: string },
): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remote.timeoutMs ?? 8000);
  try {
    const credentials = btoa(`${remote.clientId}:${remote.clientSecret}`);
    const res = await fetch(remote.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({ to: opts.to, subject: opts.subject, html: opts.html }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null) as { ok?: boolean; error?: string; provider?: string } | null;
    if (res.ok && data?.ok) {
      return { ok: true, messageId: data.provider || "remote" };
    }
    // 4xx/5xx：带 HTTP status（供上层判断是否重试）
    return { ok: false, status: res.status, error: data?.error || `HTTP ${res.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message.includes("aborted") ? "请求超时" : message };
  } finally {
    clearTimeout(timer);
  }
}

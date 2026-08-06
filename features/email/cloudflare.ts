/**
 * cloudflare-email — Cloudflare Email Service 适配器（docs/091 P1-2 生态，2026-08-07）
 *
 * Cloudflare Email Sending（open beta）：Worker 原生 binding `env.EMAIL.send()`，
 * 无需第三方 API key，消除 Resend 配额/费用问题。
 *
 * 环境兼容性（详见 index.ts 头部注释）：
 * - Cloudflare Workers：✅ 原生支持（send_email binding）
 * - VPS / Node：❌ 无 binding（需通过 Cloudflare REST API 或退回 Resend/SMTP）
 *
 * 接入方式：
 * 1. wrangler.jsonc 配置 `send_email: [{ "name": "EMAIL" }]`
 * 2. 消费方 `new EmailService({ emailBinding: env.EMAIL, from })`
 * 3. 发送逻辑自动优先走 Cloudflare binding
 */
import type { SendResult } from "./index.js";

/** Cloudflare Email Service 的 send_email binding 接口（env.EMAIL.send） */
export interface CloudflareEmailBinding {
  send(opts: CloudflareSendOptions): Promise<{ messageId: string }>;
}

export type CloudflareEmailAddress =
  | string
  | { email: string; name?: string };

export interface CloudflareSendOptions {
  to: CloudflareEmailAddress | CloudflareEmailAddress[];
  from: CloudflareEmailAddress;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: CloudflareEmailAddress;
  headers?: Record<string, string>;
}

/**
 * 通过 Cloudflare Email Service 发送单封邮件。
 *
 * @param email - env.EMAIL binding（wrangler send_email binding）
 * @param opts - 统一发送参数（from/to/subject/html）
 * @returns 统一 SendResult（与 Resend/SMTP 通道一致）
 */
export async function sendViaCloudflareEmail(
  email: CloudflareEmailBinding,
  opts: { from: string; to: string; subject: string; html: string },
): Promise<SendResult> {
  try {
    const result = await email.send({
      to: opts.to,
      from: opts.from,
      subject: opts.subject,
      html: opts.html,
    });
    return { ok: true, messageId: result.messageId };
  } catch (err) {
    // Cloudflare 返回标准 Error，带 code 属性（E_SENDER_NOT_VERIFIED 等）
    const code = (err as { code?: string })?.code;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: code ? `${code}: ${message}` : message };
  }
}

/** 判断是否已配置 Cloudflare binding（供消费方检测通道可用性） */
export function isCloudflareEmailBinding(value: unknown): value is CloudflareEmailBinding {
  return typeof value === "object" && value !== null && typeof (value as CloudflareEmailBinding).send === "function";
}

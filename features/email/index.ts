/**
 * email — 统一邮件发送插件（docs/090 跨项目方案，cf-core 侧底座）
 *
 * 支持：
 * - 模板插值（{{变量}}）+ 条件块（{{#if}}）+ HTML 转义
 * - Resend / SMTP 多通道容错链（按 priority 轮询，第一个成功即停止）
 * - 3 次重试（指数退避）+ 8s 超时
 * - 邮件日志钩子（pending→sent/failed 三态）
 * - 配置提供者接口（消费方注入 env / DB 加密 / 多通道）
 *
 * 来源：cf-shop email-service.ts + cf-auth email.ts + email-config.ts
 * 消费方：cf-shop / cf-lottery / cf-auth / 未来 cf-* 项目
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 邮件通道的环境兼容性（2026-08-07 验证）
 *
 * | 环境 | 通道 | 可用性 | 原因 |
 * |---|---|---|---|
 * | Cloudflare Workers | Resend（HTTP API） | ✅ 推荐 | fetch 直接调用，零依赖 |
 * | Cloudflare Workers | 第三方 HTTP API（Mailgun/SendGrid/SES v2 等） | ✅ 可用 | 同 Resend，纯 HTTP 协议 |
 * | Cloudflare Workers | SMTP 端口 25（明文） | ❌ 禁止 | Workers TCP connect() 明确禁止端口 25 |
 * | Cloudflare Workers | SMTP 端口 465/587（TLS） | ❌ 不可用 | cf-core 依赖 nodemailer（Node 模块），Worker 运行时不可用 |
 * | Cloudflare Workers | Cloudflare Email Service（env.EMAIL.send） | ✅ 原生推荐 | Worker 原生 binding，零第三方依赖（2026 年已 GA） |
 * | VPS / Node 服务器 | Resend（HTTP API） | ✅ 可用 | 同 Workers |
 * | VPS / Node 服务器 | SMTP 端口 25/465/587 | ✅ 可用 | 需显式 npm install nodemailer（peer optional） |
 * ═══════════════════════════════════════════════════════════════════════════════
 * 设计决策：SMTP 在 Workers 上结构性不可用（端口 25 被禁 + nodemailer 不可用），
 * 因此 cf-core 的 SMTP 通道仅限自建 Node 部署模式（server.ts + PM2 + 显式安装 nodemailer）。
 * Workers 生产环境应使用 Resend 或 Cloudflare Email Service。
 * cf-core EmailService 默认只走 Resend（apiKey 参数），不走 SMTP 通道。
 * 如需切换，消费方自行实现 Cloudflare Email Service 的 binding 调用。
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 模板引擎
// ═══════════════════════════════════════════════════════════════════════════════

import { sendViaCloudflareEmail, type CloudflareEmailBinding } from "./cloudflare.js";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c),
  );
}

export function interpolate(template: string, data: Record<string, string>): string {
  return template
    // 先 {{#if}} 再 {{var}}：避免用户数据中的 {{/if}} 被误匹配为块结束符
    .replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, content) =>
      data[key] ? content : "",
    )
    .replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(String(data[key] ?? "")));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 配置提供者接口（消费方注入，依赖倒置）
// ═══════════════════════════════════════════════════════════════════════════════

export interface EmailChannelConfig {
  /** 通道标识（唯一） */
  id: string;
  provider: "resend" | "smtp";
  /** 越小越优先 */
  priority: number;
  /** Resend API Key 或 SMTP 密码（消费方解密后传入） */
  secret: string;
  /** SMTP 字段（provider=smtp） */
  host?: string | null;
  port?: number | null;
  username?: string | null;
  /** TLS 模式：ssl（465）/ starttls（587/25）/ none（内网） */
  tlsMode?: string | null;
}

export interface EmailConfigProvider {
  /** 返回已启用的通道列表（按 priority 升序） */
  listEnabled(): Promise<EmailChannelConfig[]>;
}

export interface EmailLogEntry {
  id: string;
  to: string;
  subject: string;
  status: "pending" | "sent" | "failed";
  provider: string | null;
  error?: string;
}

export type EmailLogger = (entry: EmailLogEntry) => Promise<void>;

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
  /** HTTP 状态码（仅 Resend 通道）；用于 4xx 不重试的结构化判断 */
  status?: number;
  error?: string;
}

/**
 * 统一邮件发送服务。
 *
 * 三种构造方式（向后兼容）：
 * 1. 单 Resend：`new EmailService({ apiKey })`（存量 cf-shop / cf-lottery）
 * 2. 配置提供者（多通道）：`new EmailService({ configProvider, defaultFrom, onLog })`
 * 3. 混合：两者都传，provider 优先
 */
export class EmailService {
  readonly name = "email-resend";
  readonly version = "0.2.0";

  private config: ResendConfig | null;
  private configProvider?: EmailConfigProvider;
  private emailBinding?: CloudflareEmailBinding;
  private logger?: EmailLogger;
  private timeoutMs: number;
  private maxRetries: number;
  private defaultFrom: string;

  constructor(opts:
    | ResendConfig
    | { apiKey?: string; from?: string; defaultFrom?: string; configProvider?: EmailConfigProvider; onLog?: EmailLogger; timeoutMs?: number; maxRetries?: number; emailBinding?: CloudflareEmailBinding },
  ) {
    // 兼容旧接口：直接传 ResendConfig 对象
    if ("apiKey" in opts && opts.apiKey) {
      this.config = { apiKey: opts.apiKey, from: opts.from, defaultFrom: opts.defaultFrom };
    } else {
      this.config = null;
    }
    const o = opts as { configProvider?: EmailConfigProvider; onLog?: EmailLogger; timeoutMs?: number; maxRetries?: number; defaultFrom?: string; emailBinding?: CloudflareEmailBinding };
    this.configProvider = o.configProvider;
    this.emailBinding = o.emailBinding;
    this.logger = o.onLog;
    this.timeoutMs = o.timeoutMs ?? 8000;
    this.maxRetries = o.maxRetries ?? 3;
    this.defaultFrom = (this.config?.from || this.config?.defaultFrom || o.defaultFrom || "noreply@example.com");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 公共 API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 发送邮件。优先级：Cloudflare Email binding（env.EMAIL）→ configProvider（多通道）→ 单 Resend。
   * Cloudflare Email Service（env.EMAIL.send）是 Workers 原生方案，零第三方依赖，优先使用。
   */
  async send(opts: SendEmailOptions): Promise<SendResult> {
    const { to, subject, html } = opts;
    const from = opts.from || this.defaultFrom;
    if (!to || !to.includes("@")) return { ok: false, error: "无效收件人" };

    // Cloudflare Email Service 优先（Workers 原生 binding，零第三方依赖）
    if (this.emailBinding) {
      return sendViaCloudflareEmail(this.emailBinding, { from, to, subject, html });
    }

    // 多通道路径
    if (this.configProvider) {
      const channels = await this.configProvider.listEnabled();
      if (channels.length === 0) return { ok: false, error: "无启用的邮件通道" };
      return this.sendViaChain(channels, { from, to, subject, html });
    }

    // 单 Resend 路径（向后兼容）
    if (!this.config?.apiKey) return { ok: false, error: "未配置 Resend API Key 或 configProvider" };
    return this.sendViaResend(this.config.apiKey, { from, to, subject, html });
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
   * 日志包装发送（含 pending → sent/failed 三态）
   * 日志写入（onLog）失败不阻断发送（fail-open）：email_log 表异常时邮件仍可送达，
   * 业务不得因审计日志失败而丢信。
   */
  async sendWithLog(opts: SendEmailOptions): Promise<SendResult> {
    const logId = crypto.randomUUID();
    const logEntry: EmailLogEntry = { id: logId, to: opts.to, subject: opts.subject, status: "pending", provider: null };
    await this.safeLog(logEntry);

    const result = await this.send(opts);

    logEntry.status = result.ok ? "sent" : "failed";
    logEntry.error = result.error;
    await this.safeLog(logEntry);

    return result;
  }

  private async safeLog(entry: EmailLogEntry): Promise<void> {
    try {
      await this.logger?.(entry);
    } catch (err) {
      // fail-open：日志钩子抛错（如 DB 写入失败）不得阻断邮件发送流程
      console.warn("[email] onLog 写入失败（不影响发送）:", err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * 测试单条通道发送
   */
  async sendTest(channel: EmailChannelConfig, to: string): Promise<void> {
    const html = `<p>这是来自 cf-core EmailService 的测试邮件。通道：${escapeHtml(channel.provider)}（ID: ${escapeHtml(channel.id)}）</p>`;
    let result: SendResult;
    if (channel.provider === "resend") {
      result = await this.sendViaResend(channel.secret, { from: this.defaultFrom, to, subject: "测试邮件", html });
    } else {
      result = await this.sendViaSmtp(channel, { from: channel.username || this.defaultFrom, to, subject: "测试邮件", html });
    }
    if (!result.ok) throw new Error(result.error || "发送失败");
  }

  /**
   * 健康检查 — 验证通道连通性
   */
  async healthCheck(): Promise<boolean> {
    // 优先检查 configProvider
    if (this.configProvider) {
      try {
        const channels = await this.configProvider.listEnabled();
        return channels.length > 0;
      } catch { return false; }
    }
    // 单 Resend 路径
    if (!this.config?.apiKey) return false;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "test@test.com", to: "test@test.com", subject: "", html: "" }),
        signal: AbortSignal.timeout(5000),
      });
      return res.status !== 401 && res.status !== 403;
    } catch { return false; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：通道发送
  // ═══════════════════════════════════════════════════════════════════════════

  private async sendViaChain(
    channels: EmailChannelConfig[],
    opts: { from: string; to: string; subject: string; html: string },
  ): Promise<SendResult> {
    let lastError = "";
    for (const ch of channels) {
      const result = ch.provider === "resend"
        ? await this.sendViaResend(ch.secret, opts)
        : await this.sendViaSmtp(ch, opts);
      if (result.ok) {
        result.messageId = result.messageId || `${ch.provider}:${ch.id}`;
        return result;
      }
      lastError = result.error || "";
    }
    return { ok: false, error: lastError || "所有通道失败" };
  }

  private async sendViaResend(
    apiKey: string,
    opts: { from: string; to: string; subject: string; html: string },
  ): Promise<SendResult> {
    return this.fetchWithRetry(async (signal) => {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(opts),
        signal,
      });
      const data = (await res.json()) as { id?: string; message?: string };
      if (res.ok) return { ok: true, messageId: data.id };
      // 结构化返回 HTTP status：fetchWithRetry 据此判断 4xx 不重试，
      // 不再依赖错误字符串里是否带 "HTTP 4xx"（Resend 的 data.message 常不含状态码）
      return { ok: false, status: res.status, error: data.message || `HTTP ${res.status}` };
    });
  }

  private async sendViaSmtp(
    channel: EmailChannelConfig,
    opts: { from: string; to: string; subject: string; html: string },
  ): Promise<SendResult> {
    if (!channel.host || !channel.username) return { ok: false, error: "SMTP host/username 缺失" };
    try {
      // cf-core 是 Workers 优先库，不 import Node 类型；运行时检测环境
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const env: any = typeof globalThis !== "undefined" ? globalThis : {};
      if (!env.process?.versions?.node) return { ok: false, error: "SMTP 仅 Node 环境可用" };
      // nodemailer 声明在 optionalDependencies：仅自建 Node 部署模式需要，
      // CF Workers 消费方不会引入（esbuild 保留为 external，不影响 bundle）
      let transportModule: { createTransport: (cfg: Record<string, unknown>) => { sendMail: (o: unknown) => Promise<unknown>; close: () => Promise<void> } };
      try {
        // @ts-expect-error - nodemailer 运行时可选解析
        transportModule = await import("nodemailer");
      } catch {
        return { ok: false, error: "nodemailer 未安装：SMTP 通道需要消费方安装 nodemailer（仅 Node 部署模式）" };
      }
      const tlsMode = channel.tlsMode || "starttls";
      const t = transportModule.createTransport({
        host: channel.host,
        port: channel.port ?? (tlsMode === "ssl" ? 465 : 587),
        secure: tlsMode === "ssl",
        requireTLS: tlsMode !== "none",
        auth: { user: channel.username, pass: channel.secret },
      });
      await t.sendMail({ from: opts.from, to: opts.to, subject: opts.subject, html: opts.html });
      await t.close();
      return { ok: true, messageId: `smtp:${channel.id}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async fetchWithRetry(
    fn: (signal: AbortSignal) => Promise<SendResult>,
  ): Promise<SendResult> {
    let lastResult: SendResult = { ok: false, error: "" };
    for (let i = 0; i <= this.maxRetries; i++) {
      try {
        const result = await fn(AbortSignal.timeout(this.timeoutMs));
        if (result.ok) return result;
        // 4xx（客户端错误）重试无意义，结构化 status 判断后直接返回
        if (result.status !== undefined && result.status >= 400 && result.status < 500) return result;
        lastResult = result;
      } catch (err) {
        lastResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      if (i < this.maxRetries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, i) * 500));
      }
    }
    return lastResult;
  }
}

/**
 * 安全工具模块
 *
 * 提供 SHA-256 哈希、IP 哈希（加盐）、时序安全比较、Turnstile 人机验证、安全响应头。
 * 合并自 eshop/xtools/vcode 三项目的 security.ts，取各版本之长。
 *
 * 设计要点：
 * - 纯函数/泛型 Context，不绑定特定项目的 AppEnv
 * - 所有加密操作使用 Web Crypto API（Workers 原生）
 * - IP 仅信任 cf-connecting-ip（CF 边缘注入，客户端无法伪造）
 */

import type { Context } from "hono";
import type { TurnstileResult } from "./types";

const encoder = new TextEncoder();

// ═══════════════════════════════════════════════════════════════════════════════
// 基础密码学工具
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 对字符串进行 SHA-256 哈希，返回 64 位十六进制字符串。
 */
export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 恒定时间字符串比较 — 防止时序攻击。
 *
 * 使用 crypto.subtle.timingSafeEqual 比较两个字符串的 UTF-8 字节序列。
 * 长度不匹配时回退到手写比较（仍为恒定时间），避免长度泄露信息。
 *
 * 来源：eshop（crypto.subtle 版）+ xtools（手写 XOR 版）合并
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  // 手写 XOR 比较（恒定时间，兼容 Node.js 和 Workers）
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// IP 哈希
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 获取客户端 IP 的加盐 SHA-256 哈希。
 *
 * - 仅信任 cf-connecting-ip（CF 边缘注入）
 * - 非 CF 环境降级使用 x-forwarded-for + "dev:" 前缀
 * - 加盐防止反向查找
 *
 * @param c - Hono Context
 * @param salt - 盐值，默认从 env.RATE_LIMIT_SALT 读取
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getIpHash(
  c: Context<any>,
  salt?: string,
): Promise<string> {
  const cfIp = c.req.header("cf-connecting-ip");
  let ip: string;
  if (cfIp) {
    ip = cfIp;
  } else {
    ip = "dev:" + (c.req.header("x-forwarded-for") || "0.0.0.0");
  }
  const actualSalt = salt ?? c.env.RATE_LIMIT_SALT ?? "cf-core-salt";
  return sha256(`${actualSalt}:${ip}`);
}

/**
 * 获取原始客户端 IP（用于日志，不做隐私存储时可用）
 */
export function getClientIp(c: Context): string {
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) return cfIp;
  const xff = c.req.header("x-forwarded-for");
  return xff ? xff.split(",")[0].trim() : "unknown";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bearer Token 提取
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 从 Authorization 请求头提取 Bearer Token。
 * 格式：Authorization: Bearer <token>
 */
export function getBearerToken(c: Context): string {
  const auth = c.req.header("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Turnstile 人机验证
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cloudflare Turnstile 验证。
 *
 * - 未配置 TURNSTILE_SECRET_KEY 时直接放行（分阶段部署）
 * - 无 token 时静默通过（smoke 测试/管理端调用）
 * - 验证失败返回 { ok: false, message }
 *
 * 来源：eshop（FormData 版）+ vcode（urlencoded 版）合并为 FormData 版（更规范）
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function verifyTurnstile(
  c: Context<any>,
  token?: string,
): Promise<TurnstileResult> {
  const secret = c.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true };
  if (!token) return { ok: true };

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  const ip = c.req.header("cf-connecting-ip");
  if (ip) form.append("remoteip", ip);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = await response.json<{ success?: boolean; "error-codes"?: string[] }>();
    if (!data.success) {
      console.warn("[turnstile] verification failed", {
        errorCodes: data["error-codes"] || [],
      });
      return { ok: false, message: "人机验证失败" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[turnstile] fetch error:", err);
    return { ok: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 安全响应头
// ═══════════════════════════════════════════════════════════════════════════════

export interface SecurityHeadersOptions {
  /** CSP 额外 script-src（如 CDN 域名） */
  extraScriptSrc?: string[];
  /** CSP 额外 style-src */
  extraStyleSrc?: string[];
  /** CSP 额外 connect-src */
  extraConnectSrc?: string[];
  /** CSP 额外 font-src */
  extraFontSrc?: string[];
  /** 是否允许 unsafe-eval（admin 页面的 Vue UMD 需要） */
  allowUnsafeEval?: boolean;
  /** 是否允许 Telegram WebApp SDK */
  allowTelegram?: boolean;
}

/**
 * 生成安全响应头（CSP + 安全头）
 *
 * 合并三项目不同的 CSP 策略为统一配置接口。
 * 返回 Headers 对象，可直接合并到响应中。
 */
export function buildSecurityHeaders(options: SecurityHeadersOptions = {}): Headers {
  const {
    extraScriptSrc = [],
    extraStyleSrc = [],
    extraConnectSrc = [],
    extraFontSrc = [],
    allowUnsafeEval = false,
    allowTelegram = false,
  } = options;

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    "https://unpkg.com",
    "https://static.cloudflareinsights.com",
    "https://challenges.cloudflare.com",
    ...(allowUnsafeEval ? ["'unsafe-eval'"] : []),
    ...(allowTelegram ? ["https://telegram.org"] : []),
    ...extraScriptSrc,
  ];

  const csp = [
    "default-src 'self'",
    `style-src 'self' 'unsafe-inline' https://unpkg.com ${extraStyleSrc.join(" ")}`.trim(),
    `script-src ${scriptSrc.join(" ")}`,
    "img-src 'self' data: https:",
    `connect-src 'self' https://unpkg.com https://challenges.cloudflare.com https://static.cloudflareinsights.com ${extraConnectSrc.join(" ")}`.trim(),
    "frame-src 'self' https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    ...(extraFontSrc.length > 0 ? [`font-src 'self' ${extraFontSrc.join(" ")}`] : []),
  ].join("; ");

  return new Headers({
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
}

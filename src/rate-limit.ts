/**
 * 统一限流模块 — 支持 DB / KV / 内存 三种存储后端
 *
 * 三项目的限流实现各有特点：
 * - cf-shop: DB 版（原子 upsert，最可靠，适合无 KV 的项目）
 * - xtools: KV 版（滑动窗口，跨实例共享）
 * - vcode: 内存版（最轻量，但重启丢失）
 *
 * 本模块统一接口，项目按自己的基础设施选择后端。
 */

import { sql } from "drizzle-orm";
import type { RateLimitResult } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 统一接口
// ═══════════════════════════════════════════════════════════════════════════════

export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 内存版（最轻量 — 适合 vcode 类项目）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 内存固定窗口限流器
 *
 * Workers 实例级别，重启后重置。
 * 适合请求量不大、对精确性要求不高的场景。
 */
export class MemoryRateLimiter implements RateLimiter {
  private store = new Map<string, { count: number; resetAt: number }>();

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const record = this.store.get(key);

    if (!record || now > record.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, remaining: limit - 1 };
    }

    if (record.count >= limit) {
      const resetMs = Math.max(0, record.resetAt - now);
      return { ok: false, message: "请求过于频繁，请稍后再试", status: 429, resetMs };
    }

    record.count++;
    return { ok: true, remaining: limit - record.count };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// KV 版（跨实例共享 — 适合 xtools 类项目）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * KV 滑动窗口限流器
 *
 * 使用 Cloudflare KV 存储，跨 Workers 实例共享状态。
 * 滑动窗口算法，避免固定窗口边界突发。
 *
 * 来源：xtools src/lib/rate-limiter.ts
 */
export class KvRateLimiter implements RateLimiter {
  private kv: KVNamespace;
  private prefix: string;

  constructor(kv: KVNamespace, prefix = "rate") {
    this.kv = kv;
    this.prefix = prefix;
  }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const kvKey = `${this.prefix}:${key}`;

    try {
      const data = await this.kv.get(kvKey, "json");
      const timestamps: number[] = Array.isArray(data) ? data : [];
      const valid = timestamps.filter((ts) => ts > windowStart);

      if (valid.length >= limit) {
        const oldest = Math.min(...valid);
        const resetMs = Math.max(0, oldest + windowMs - now);
        return { ok: false, message: "请求过于频繁，请稍后再试", status: 429, remaining: 0, resetMs };
      }

      valid.push(now);
      const ttlSeconds = Math.ceil(windowMs / 1000) + 10;
      await this.kv.put(kvKey, JSON.stringify(valid), { expirationTtl: ttlSeconds });

      const remaining = Math.max(0, limit - valid.length);
      return { ok: true, remaining };
    } catch (err) {
      console.warn("[KvRateLimiter] KV error, failing open:", err instanceof Error ? err.message : String(err));
      return { ok: true, remaining: limit };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DB 版（最可靠 — 适合 cf-shop 类项目）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 数据库固定窗口限流器
 *
 * 使用 rate_limit_windows 表，通过原子 upsert（INSERT ON CONFLICT UPDATE）实现。
 * UPDATE 自带 WHERE request_count < :limit 条件，确保计数器永远不会超过阈值，
 * 从根本上消除高并发场景下的竞态条件。
 *
 * 来源：cf-shop src/lib/rate-limit.ts（竞态修复版）
 */
export class DbRateLimiter implements RateLimiter {
  private db: {
    execute: (query: unknown) => Promise<{ rows?: Array<{ request_count: number }> }>;
  };
  private tableName: string;

  constructor(db: DbRateLimiter["db"]) {
    this.db = db;
    this.tableName = "rate_limit_windows";
  }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const windowSeconds = Math.floor(windowMs / 1000);
    const windowStart = Math.floor(now / windowSeconds) * windowSeconds;

    try {
      // 使用 raw SQL + WHERE 条件保证计数器不会超过 limit：
      // - 首次插入: request_count = 1
      // - 后续更新: request_count += 1，但 WHERE request_count < :limit 阻止超额
      const result = await this.db.execute(
        sql`INSERT INTO ${sql.identifier(this.tableName)} (action, ip_hash, window_start, request_count)
            VALUES (${key}, '', ${windowStart}, 1)
            ON CONFLICT(action, ip_hash, window_start) DO UPDATE SET
              request_count = request_count + 1
            WHERE rate_limit_windows.request_count < ${limit}
            RETURNING request_count`,
      );

      const currentCount = result.rows?.[0]?.request_count ?? 0;

      // 如果 WHERE 条件不满足（count >= limit），UPDATE 被跳过，返回旧值
      if (currentCount > limit) {
        const resetInSeconds = windowStart + windowSeconds - now;
        return {
          ok: false,
          message: "请求过于频繁，请稍后再试",
          status: 429,
          remaining: 0,
          resetMs: Math.max(0, resetInSeconds * 1000),
        };
      }

      return { ok: true, remaining: Math.max(0, limit - currentCount) };
    } catch {
      // 限流失败时 fail-open 以保持服务可用
      return { ok: true, remaining: limit };
    }
  }
}

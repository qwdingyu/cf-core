/**
 * 运行时系统配置模块（热生效 KV 存储）
 *
 * 使用 system_config 表存储运行时配置，支持热生效（无需重启）。
 * 可选启用 Cache API 缓存以减少数据库查询。
 *
 * 三项目均有 system_config 表且结构完全一致。
 *
 * 来源：eshop/xtools/vcode system_config 表 + eshop cache.ts 合并
 */

import { eq } from "drizzle-orm";
import { systemConfig } from "./db/schema";

interface ConfigDbLike {
  select: (cols: { value: typeof systemConfig.value }) => {
    from: (table: typeof systemConfig) => {
      where: (cond: unknown) => {
        limit: (n: number) => Promise<{ value: string }[]>;
      };
    };
  };
  insert: (table: typeof systemConfig) => {
    values: (data: { key: string; value: string; updatedAt: string }) => {
      onConflictDoUpdate: (opts: {
        target: typeof systemConfig.key;
        set: { value: string; updatedAt: string };
      }) => Promise<unknown>;
    };
  };
  delete: (table: typeof systemConfig) => {
    where: (cond: unknown) => Promise<unknown>;
  };
}

export interface SystemConfigOptions {
  /** 内存缓存 TTL（毫秒），0 表示不缓存，默认 5 分钟 */
  cacheTtlMs?: number;
}

/**
 * 系统配置管理器
 */
export class SystemConfig {
  private db: ConfigDbLike;
  private cache = new Map<string, { value: string; expiresAt: number }>();
  private cacheTtlMs: number;

  constructor(db: ConfigDbLike, options: SystemConfigOptions = {}) {
    this.db = db;
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000; // 5 分钟
  }

  /**
   * 读取配置值
   *
   * 优先从内存缓存读取，过期后从数据库重新加载。
   */
  async get(key: string, defaultValue = ""): Promise<string> {
    // 内存缓存
    if (this.cacheTtlMs > 0) {
      const cached = this.cache.get(key);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.value;
      }
    }

    try {
      const [row] = await this.db
        .select({ value: systemConfig.value })
        .from(systemConfig)
        .where(eq(systemConfig.key, key))
        .limit(1);

      const value = row?.value ?? defaultValue;

      if (this.cacheTtlMs > 0) {
        this.cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
      }

      return value;
    } catch {
      return defaultValue;
    }
  }

  /**
   * 读取配置值并解析为数字
   */
  async getNumber(key: string, defaultValue: number): Promise<number> {
    const raw = await this.get(key, String(defaultValue));
    const num = Number(raw);
    return Number.isFinite(num) ? num : defaultValue;
  }

  /**
   * 读取配置值并解析为布尔
   */
  async getBoolean(key: string, defaultValue = false): Promise<boolean> {
    const raw = await this.get(key, String(defaultValue));
    return raw === "true" || raw === "1";
  }

  /**
   * 写入配置值（UPSERT）
   */
  async set(key: string, value: string): Promise<void> {
    await this.db
      .insert(systemConfig)
      .values({ key, value, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value, updatedAt: new Date().toISOString() },
      });

    // 清除内存缓存
    this.cache.delete(key);
  }

  /**
   * 删除配置
   */
  async delete(key: string): Promise<void> {
    await this.db.delete(systemConfig).where(eq(systemConfig.key, key));
    this.cache.delete(key);
  }

  /**
   * 清除所有内存缓存（用于强制刷新）
   */
  clearCache(): void {
    this.cache.clear();
  }
}

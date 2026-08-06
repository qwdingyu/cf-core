/**
 * 运行时系统配置模块（热生效 KV 存储）
 *
 * 使用 system_config 表存储运行时配置，支持热生效（无需重启）。
 * 可选启用 Cache API 缓存以减少数据库查询。
 *
 * 三项目均有 system_config 表且结构完全一致。
 *
 * 来源：cf-shop/xtools/vcode system_config 表 + cf-shop cache.ts 合并
 */

import { eq } from "drizzle-orm";
import { systemConfig } from "./db/schema.js";

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

// ═══════════════════════════════════════════════════════════════════════════════
// 定义驱动注册表（docs/091 P1-11）
// 从 cf-shop / cf-lottery 的 system-config-registry 抽取共性引擎；业务键 definitions 由消费方传入。
// ═══════════════════════════════════════════════════════════════════════════════

export type SystemConfigValueType = "string" | "integer" | "boolean";

/** integer 存储单位；cents 表示后台 UI 按「元」编辑、库内仍是分 */
export type SystemConfigIntegerUnit = "cents" | "count";

export type SystemConfigDefinition = {
  key: string;
  label: string;
  description: string;
  effect: string;
  scope: "public" | "admin";
  type: SystemConfigValueType;
  /** 仅 type=integer：cents=金额（分存储，Admin 按元展示）；count/缺省=纯整数 */
  unit?: SystemConfigIntegerUnit;
  sensitive?: boolean;
  defaultValue: string;
  format?: "email";
  maxLength?: number;
  /** type=integer 时与存储单位一致（cents 时为分） */
  min?: number;
  max?: number;
  group?: string;
  order?: number;
};

export type NormalizeResult = { ok: true; value: string } | { ok: false; message: string };

type CustomNormalize = (
  key: string,
  value: string,
  definition: SystemConfigDefinition,
) => NormalizeResult | undefined;

function formatCentsBoundForMessage(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

/**
 * 定义驱动的系统配置注册表工厂。
 *
 * 消费方传入业务键 definitions（JSON），得到类型校验、批量构建、敏感判定等引擎能力。
 * 项目特有校验（如 email 域名白名单、多选枚举）通过 customNormalize hook 注入。
 */
export function createSystemConfigRegistry(
  definitions: readonly SystemConfigDefinition[],
  options?: { customNormalize?: CustomNormalize },
) {
  const definitionByKey = new Map<string, SystemConfigDefinition>(definitions.map((d) => [d.key, d]));
  const keys = definitions.map((d) => d.key);

  const getDefinition = (key: string): SystemConfigDefinition | undefined => definitionByKey.get(key);
  const isSupported = (key: string): boolean => definitionByKey.has(key);
  const isSensitive = (key: string): boolean => Boolean(getDefinition(key)?.sensitive);

  /**
   * 校验并规范化配置值（boolean / integer / string / email / maxLength）。
   */
  function normalizeValue(key: string, value: string): NormalizeResult {
    const definition = getDefinition(key);
    if (!definition) {
      return { ok: false, message: `系统参数 "${key}" 未注册，保存后不会被业务代码读取，已拒绝写入` };
    }

    const trimmed = value.trim();

    // 项目特有校验优先（如 email 域名白名单、多选枚举）
    if (options?.customNormalize) {
      const custom = options.customNormalize(key, trimmed, definition);
      if (custom) return custom;
    }

    if (definition.type === "boolean") {
      if (trimmed !== "true" && trimmed !== "false") {
        return { ok: false, message: `${definition.label} 只能填写 true 或 false` };
      }
      return { ok: true, value: trimmed };
    }

    if (definition.type === "integer") {
      if (!/^-?\d+$/.test(trimmed)) {
        return {
          ok: false,
          message: definition.unit === "cents"
            ? `${definition.label} 必须是整数（库内以分为单位存储）`
            : `${definition.label} 必须是整数`,
        };
      }
      const parsed = Number(trimmed);
      if (definition.min !== undefined && parsed < definition.min) {
        return {
          ok: false,
          message: definition.unit === "cents"
            ? `${definition.label} 不能小于 ${formatCentsBoundForMessage(definition.min)} 元`
            : `${definition.label} 不能小于 ${definition.min}`,
        };
      }
      if (definition.max !== undefined && parsed > definition.max) {
        return {
          ok: false,
          message: definition.unit === "cents"
            ? `${definition.label} 不能大于 ${formatCentsBoundForMessage(definition.max)} 元`
            : `${definition.label} 不能大于 ${definition.max}`,
        };
      }
      return { ok: true, value: String(parsed) };
    }

    if (definition.maxLength !== undefined && trimmed.length > definition.maxLength) {
      return { ok: false, message: `${definition.label} 不能超过 ${definition.maxLength} 个字符` };
    }
    if (definition.format === "email" && trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return { ok: false, message: `${definition.label} 必须是有效邮箱地址` };
    }
    return { ok: true, value: trimmed };
  }

  /**
   * 从 DB 行构建配置 map（按 keys 顺序）。
   */
  function buildMap(
    rows: Array<{ key: string; value: string }>,
    useKeys: string[] = keys,
  ): Record<string, string> {
    const rowMap = new Map(rows.map((r) => [r.key, r.value]));
    const config: Record<string, string> = {};
    for (const key of useKeys) {
      config[key] = rowMap.get(key) ?? "";
    }
    return config;
  }

  return {
    definitions,
    keys,
    publicKeys: definitions.filter((d) => d.scope === "public").map((d) => d.key),
    getDefinition,
    isSupported,
    isSensitive,
    normalizeValue,
    buildMap,
  };
}

export type SystemConfigRegistry = ReturnType<typeof createSystemConfigRegistry>;

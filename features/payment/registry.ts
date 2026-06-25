/**
 * 支付功能模块 — Provider 注册表
 *
 * per-request 工厂模式：根据 env 中配置的凭证，自动实例化已配置的渠道。
 * 支持从 DB 加载加密配置（通过 dbConfigs 参数），数据库中的配置优先于环境变量。
 * 优先级由调用方传入 factory 数组的顺序决定。
 *
 * @example
 * ```ts
 * import { createProviderRegistry, stripeFactory, alipayFactory } from "@usethink/cf-core/features/payment";
 *
 * // 纯环境变量模式（向后兼容）
 * const registry = createProviderRegistry(env, [stripeFactory, alipayFactory]);
 *
 * // 混合模式：DB 配置优先于 env var
 * const registry = createProviderRegistry(env, factories, dbConfigs);
 * const provider = registry.selectOnline();
 * ```
 */

import type { PaymentProvider, ProviderFactory, ProviderRegistry } from "./types";

/** DB 加密支付配置的扁平键值对结构 */
export interface DbProviderConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 配置项键值对（如 { ZPAY_PID: "xxx", ZPAY_KEY: "xxx" }） */
  config: Record<string, unknown>;
}

/**
 * 从数据库解密后的支付配置映射。
 * key = provider 名称（如 "zpay", "alipay"），value = 解密后的完整配置
 */
export type DbProviderConfigMap = Record<string, DbProviderConfig>;

/**
 * 创建 per-request 的 Provider 注册表。
 *
 * 配置加载优先级（高到低）：
 * 1. dbConfigs[factory.name].config — 数据库中的支付配置（解密后）
 * 2. env — 环境变量（兜底）
 *
 * 当 dbConfigs 存在且 enabled=true 时，DB 配置覆盖 env 中同名的键。
 */
export function createProviderRegistry(
  env: Record<string, unknown>,
  factories: ProviderFactory[],
  dbConfigs?: DbProviderConfigMap,
): ProviderRegistry {
  const registry = new Map<string, PaymentProvider>();

  for (const factory of factories) {
    // 检查是否有 DB 配置
    const dbEntry = dbConfigs?.[factory.name];

    if (dbEntry?.enabled && dbEntry.config) {
      // DB 配置优先：将 DB 配置合入 env（DB 值覆盖 env 同名键）
      const mergedEnv = { ...env, ...dbEntry.config };

      if (factory.fromDbConfig) {
        // 工厂有专用方法则直接调用
        registry.set(factory.name, factory.fromDbConfig(dbEntry.config));
      } else if (factory.isAvailable(mergedEnv)) {
        // 否则合入 env 后走标准 create 路径
        registry.set(factory.name, factory.create(mergedEnv));
      }
    } else if (factory.isAvailable(env)) {
      // 无 DB 配置，走环境变量路径
      registry.set(factory.name, factory.create(env));
    }
  }

  const sorted = [...factories].sort((a, b) => a.priority - b.priority);

  return {
    get(name) { return registry.get(name); },
    selectOnline() {
      for (const f of sorted) {
        const p = registry.get(f.name);
        if (p) return p;
      }
      return null;
    },
    list() { return [...registry.keys()]; },
  };
}

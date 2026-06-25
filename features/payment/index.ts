/**
 * @iusethink/cf-core/features/payment — 支付功能模块
 *
 * 统一导出所有支付相关能力。支持两种导入方式：
 *
 * 1. 从根导入（适合小项目）：
 *    import { alipayFactory, stripeFactory } from "@iusethink/cf-core/features/payment";
 *
 * 2. 按子路径导入（推荐，tree-shakeable）：
 *    import { alipayFactory } from "@iusethink/cf-core/features/payment/providers/alipay";
 *    import { stripeFactory } from "@iusethink/cf-core/features/payment/providers/stripe";
 */

// ── 类型 ──
export type {
  CreatePaymentInput,
  CreatePaymentResult,
  CallbackResult,
  QueryStatusResult,
  RefundInput,
  RefundResult,
  PaymentProvider,
  ProviderRegistry,
  ProviderFactory,
} from "./types";

// ── 注册表 ──
export { createProviderRegistry } from "./registry";
export type { DbProviderConfig, DbProviderConfigMap } from "./registry";

// ── 支付宝 ──
export { AlipayProvider, alipayFactory, signRSA2, verifyRSA2 } from "./providers/alipay";
export type { AlipayConfig } from "./providers/alipay";

// ── Stripe ──
export { StripeProvider, stripeFactory } from "./providers/stripe";

// ── USDT/TRC20 ──
export { Trc20Provider, trc20Factory } from "./providers/trc20";

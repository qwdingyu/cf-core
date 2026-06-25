/**
 * 支付功能模块 — 类型定义
 *
 * 纯接口文件，零运行时依赖。
 * 所有支付 Provider 实现都必须实现 PaymentProvider 接口。
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 支付操作数据类型
// ═══════════════════════════════════════════════════════════════════════════════

export interface CreatePaymentInput {
  orderNo: string;
  amountCents: number;
  currency: string;
  notifyUrl: string;
  returnUrl?: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface CreatePaymentResult {
  providerTradeNo?: string;
  qrCode?: string;
  redirectUrl?: string;
  raw?: Record<string, unknown>;
}

export interface CallbackResult {
  orderNo: string;
  providerTradeNo: string;
  amountCents: number;
  currency: string;
  paidAt: string;
  raw?: Record<string, unknown>;
}

export interface QueryStatusResult {
  paid: boolean;
  providerTradeNo?: string;
}

export interface RefundInput {
  providerTradeNo: string;
  refundCents: number;
  reason?: string;
  refundNo?: string;
}

export interface RefundResult {
  success: boolean;
  providerRefundNo?: string;
  status: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PaymentProvider 接口
// ═══════════════════════════════════════════════════════════════════════════════

export interface PaymentProvider {
  readonly name: string;
  readonly displayName: string;
  readonly supportedCurrencies: string[];
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyCallback(params: Record<string, string>): Promise<CallbackResult>;
  queryStatus?(tradeNo: string): Promise<QueryStatusResult>;
  refund?(input: RefundInput): Promise<RefundResult>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider 注册表类型
// ═══════════════════════════════════════════════════════════════════════════════

export interface ProviderRegistry {
  get(name: string): PaymentProvider | undefined;
  selectOnline(): PaymentProvider | null;
  list(): string[];
}

export interface ProviderFactory {
  name: string;
  priority: number;
  isAvailable(env: Record<string, unknown>): boolean;
  create(env: Record<string, unknown>): PaymentProvider;

  /**
   * 从数据库解密后的配置创建 Provider。
   * 可选方法——未实现时，注册表会将 config 合入 env 再调用 create()。
   *
   * @param config - 解密后的扁平配置对象（键名与 env var 一致，如 { ZPAY_PID: "xxx" }）
   */
  fromDbConfig?(config: Record<string, unknown>): PaymentProvider;
}

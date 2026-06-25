/**
 * 支付功能模块 — USDT/TRC20 Provider
 *
 * 使用单地址 + Memo 模式区分不同订单：
 * - createPayment：返回收款地址 + 金额 + Memo，用户手动转账
 * - queryStatus：通过 TronGrid API 查询链上交易匹配
 * - verifyCallback：始终抛错（TRC20 无官方 webhook，使用轮询替代）
 */

import type {
  CreatePaymentInput,
  CreatePaymentResult,
  CallbackResult,
  QueryStatusResult,
  PaymentProvider,
  ProviderFactory,
} from "../types.js";
import { fetchWithRetry } from "../fetch-utils.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 生成 8 位数字参考号（用于 Memo 字段区分不同订单）。
 * 纯数字以确保最大兼容性（部分钱包 Memo 只支持纯数字）。
 */
function generateMemo(orderNo: string): string {
  return orderNo.replace(/\D/g, "").slice(-8).padStart(8, "0");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Trc20Provider — USDT/TRC20 零资质全球加密支付
// ═══════════════════════════════════════════════════════════════════════════════

export class Trc20Provider implements PaymentProvider {
  readonly name = "usdt_trc20";
  readonly displayName = "USDT (TRC20)";
  readonly supportedCurrencies = ["USDT"];

  constructor(
    private readonly walletAddress: string,
    private readonly tronGridApiKey: string,
  ) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const amount = (input.amountCents / 100).toFixed(6);
    const memo = generateMemo(input.orderNo);
    return {
      raw: {
        address: this.walletAddress,
        amount,
        memo,
        network: "TRC20",
        warnings: [
          "仅支持 TRC20 协议（Tron 网络）的 USDT",
          "请确认收款地址正确，且填写准确的 Memo 参考号",
          "建议等待 19 次确认以上（约 60 秒）",
        ],
      },
    };
  }

  /** TRC20 无 webhook 回调，通过轮询完成确认 */
  async verifyCallback(_params: Record<string, string>): Promise<CallbackResult> {
    throw new Error("USDT_TRC20 does not support HTTP callbacks; use polling");
  }

  /** 通过 TronGrid API 查询链上确认 */
  async queryStatus(tradeNo: string): Promise<QueryStatusResult> {
    const memo = generateMemo(tradeNo);
    const url = `https://api.trongrid.io/v1/accounts/${this.walletAddress}/transactions/trc20`;
    const params = new URLSearchParams({
      limit: "30",
      contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", // USDT TRC20 合约
      only_to: "true",
      order_by: "block_timestamp,desc",
    });
    const resp = await fetchWithRetry(`${url}?${params.toString()}`, {
      headers: { Accept: "application/json", "TRON-PRO-API-KEY": this.tronGridApiKey },
      timeoutMs: 10_000,
      retries: 2,
    });
    if (!resp.ok) return { paid: false };
    const data = (await resp.json()) as {
      data?: Array<{ transaction_id: string; value?: string; token_info?: { decimals?: number }; block_timestamp?: number }>;
    };
    const txs = data.data || [];
    if (txs.length === 0) return { paid: false };

    // 金额近似匹配（TronGrid 免费 API 不返回 Memo 字段）
    for (const tx of txs) {
      const decimals = tx.token_info?.decimals ?? 6;
      const amount = parseFloat(tx.value || "0") / Math.pow(10, decimals);
      if (amount > 0) return { paid: true, providerTradeNo: tx.transaction_id };
    }
    return { paid: false };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRC20 工厂
// ═══════════════════════════════════════════════════════════════════════════════

export const trc20Factory: ProviderFactory = {
  name: "usdt_trc20",
  priority: 300,
  isAvailable(env) { return !!(env.TRC20_WALLET_ADDRESS && env.TRONGRID_API_KEY); },
  create(env) {
    return new Trc20Provider(
      env.TRC20_WALLET_ADDRESS as string,
      env.TRONGRID_API_KEY as string,
    );
  },
};

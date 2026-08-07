# payment — 支付功能模块

## 包含

- `PaymentProvider` 接口（统一支付渠道抽象）
- `ProviderRegistry` + `ProviderFactory`（per-request 工厂）
- 严格的币种代码、整数最小单位转换与 Provider 币种能力工具
- `AlipayProvider`（支付宝当面付，RSA2 签名，优先级 100）
- `EasyPayProvider`（易支付兼容协议，覆盖 ZPay 等网关，MD5 签名，优先级 40）
- `StripeProvider`（Stripe Checkout Sessions，国际信用卡，优先级 200）
- `Trc20Provider`（USDT/TRC20 零资质加密支付，单地址+Memo 模式，优先级 300）
- `signRSA2` / `verifyRSA2`（Web Crypto API 签名工具）

## 快速使用

### 支付宝

```ts
import { AlipayProvider } from "@usethink/cf-core/features/payment";

const alipay = new AlipayProvider({
  appId: env.ALIPAY_APP_ID,
  privateKey: env.ALIPAY_PRIVATE_KEY,
  alipayPublicKey: env.ALIPAY_PUBLIC_KEY,
});

// 创建支付（返回二维码 URL）
const result = await alipay.createPayment({
  orderNo: "ORDER_001",
  amountCents: 9900,
  currency: "CNY",
  notifyUrl: "https://your-domain.com/api/pay/callback/alipay",
});
// result.qrCode → 支付宝二维码 URL

// 验证回调
const callback = await alipay.verifyCallback(callbackParams);
// callback.orderNo / callback.amountCents / callback.paidAt
```

### 易支付兼容（ZPay 等网关）

```ts
import { EasyPayProvider } from "@usethink/cf-core/features/payment";

const easypay = new EasyPayProvider({
  pid: env.EASYPAY_PID,
  key: env.EASYPAY_KEY,
  apiBase: env.EASYPAY_API_BASE, // 可填 https://zpayz.cn，也可粘贴 submit.php / mapi.php / api.php
  payType: env.EASYPAY_PAY_TYPE || "alipay",
  enabledPayTypes: env.EASYPAY_ENABLED_PAY_TYPES || "alipay",
});

const result = await easypay.createPayment({
  orderNo: "ORDER_001",
  amountCents: 9900,
  currency: "CNY",
  notifyUrl: "https://your-domain.com/api/pay/callback/easypay",
  returnUrl: "https://your-domain.com/order/ORDER_001",
  description: "商品购买",
  metadata: { payType: "alipay" },
});
// result.redirectUrl / result.qrCode / result.providerTradeNo

const callback = await easypay.verifyCallback(callbackParams);
// callback.orderNo / callback.providerTradeNo / callback.amountCents

const status = await easypay.queryStatus?.("ORDER_001");
// status.paid / status.amountCents / status.providerTradeNo
```

约束：

- Provider 名称是 `easypay`，不是 `zpay`。ZPay 是兼容易支付协议的服务商实例，通过 `EASYPAY_API_BASE` 指向对应网关。
- 支持币种只声明 `CNY`；跨币种扩展必须先补币种指数、金额格式和真实网关验收。
- `code=1` 只代表查单接口成功，不等于已支付；支付成功必须看 `status=1` 或 `trade_status=TRADE_SUCCESS`。
- `apiBase` 入库前应统一走 `normalizeEasyPayApiBaseUrl`，防止把 `submit.php` 当成查单地址。

### Stripe（国际信用卡）

```ts
import { StripeProvider } from "@usethink/cf-core/features/payment";

const stripe = new StripeProvider(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);

// 创建 Checkout Session（返回跳转 URL）
const result = await stripe.createPayment({
  orderNo: "ORDER_001",
  amountCents: 2999,
  currency: "USD",
  notifyUrl: "https://your-domain.com/api/pay/callback/stripe",
});
// result.redirectUrl → Stripe 托管页面 URL

// 验证 webhook 回调（路由层需传递 _raw_body + _stripe_signature）
const callback = await stripe.verifyCallback({
  _raw_body: rawRequestBody,
  _stripe_signature: stripeSignatureHeader,
});
```

### USDT/TRC20（加密支付）

```ts
import { Trc20Provider } from "@usethink/cf-core/features/payment";

const trc20 = new Trc20Provider(env.TRC20_WALLET_ADDRESS, env.TRONGRID_API_KEY);

// 创建支付（返回收款地址 + Memo，用户手动转账）
const result = await trc20.createPayment({
  orderNo: "ORDER_001",
  amountCents: 5000,  // $50.00
  currency: "USDT",
  notifyUrl: "https://your-domain.com/api/pay/callback/trc20",
});
// result.raw.address / result.raw.amount / result.raw.memo

// 主动查询链上状态（走轮询，无 HTTP 回调）
const status = await trc20.queryStatus("ORDER_001");
// status.paid / status.providerTradeNo
```

## Registry 模式（多渠道自动选择）

只需传递所有工厂，系统自动根据 env 配置实例化可用渠道：

```ts
import {
  createProviderRegistry,
  alipayFactory,
  easyPayFactory,
  stripeFactory,
  trc20Factory,
} from "@usethink/cf-core/features/payment";

const registry = createProviderRegistry(env, [
  alipayFactory,   // 需 ALIPAY_APP_ID + ALIPAY_PRIVATE_KEY + ALIPAY_PUBLIC_KEY
  easyPayFactory,  // 需 EASYPAY_PID + EASYPAY_KEY + EASYPAY_API_BASE
  stripeFactory,   // 需 STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
  trc20Factory,    // 需 TRC20_WALLET_ADDRESS + TRONGRID_API_KEY
]);

// 按优先级选择第一个可用的线上渠道（easypay > alipay > stripe > usdt_trc20）
const provider = registry.selectOnline();

// 按订单币种选择；不支持该币种的高优先级渠道会被跳过
const jpyProvider = registry.selectOnline("JPY");

// 按名称获取指定渠道
const alipay = registry.get("alipay");

// 列出所有已注册渠道
const channels = registry.list(); // ["alipay", "stripe", ...]
```

## 环境变量速查

| 变量名 | 所属渠道 | 说明 |
|--------|----------|------|
| `ALIPAY_APP_ID` | alipay | 支付宝应用 ID |
| `ALIPAY_PRIVATE_KEY` | alipay | 商户 RSA2 私钥（PKCS8 PEM） |
| `ALIPAY_PUBLIC_KEY` | alipay | 支付宝 RSA2 公钥 |
| `EASYPAY_PID` | easypay | 易支付兼容网关商户 PID |
| `EASYPAY_KEY` | easypay | 易支付兼容网关商户密钥 |
| `EASYPAY_API_BASE` | easypay | 易支付接口根地址；ZPay 等兼容网关填服务商根地址 |
| `EASYPAY_RETURN_URL` | easypay | 默认支付完成跳转 URL（可选） |
| `EASYPAY_PAY_TYPE` | easypay | 默认收款方式：`alipay` / `wxpay` / `qqpay` |
| `EASYPAY_ENABLED_PAY_TYPES` | easypay | 启用收款方式，逗号分隔 |
| `STRIPE_SECRET_KEY` | stripe | Stripe Secret Key（sk_开头） |
| `STRIPE_WEBHOOK_SECRET` | stripe | Stripe Webhook Signing Secret（whsec_开头） |
| `TRC20_WALLET_ADDRESS` | usdt_trc20 | USDT 收款地址（T 开头 TRC20 地址） |
| `TRONGRID_API_KEY` | usdt_trc20 | TronGrid API Key（免费注册） |

## 设计原则

1. **纯类、零框架依赖** — 所有 Provider 可在任何 JavaScript 环境使用（Workers / Node / Deno / Bun）
2. **per-request 实例化** — `createProviderRegistry` 每次请求调用，避免全局状态泄漏
3. **统一接口** — `createPayment` → `verifyCallback` / `queryStatus`，应用层无需区分渠道
4. **金额使用整数最小单位** — `amountCents` 是兼容字段名，真实语义由订单币种指数决定；JPY 为整数日元，CNY/USD 为分
5. **工厂模式** — 新渠道只需实现 `PaymentProvider` + `ProviderFactory`，注册即可使用

## 与未来 cf-pay 微服务的边界

`cf-core` 是协议与类型层，`cf-pay` 应该是支付编排服务。两者分工如下：

| 层级 | 归属 | 说明 |
|------|------|------|
| Provider 协议实现 | `cf-core/features/payment/providers/*` | 支付宝、易支付兼容、Stripe、TRC20 等纯 Provider；不依赖订单表、不依赖租户表 |
| 金额/币种/签名原语 | `cf-core/features/payment` | 整数金额、Provider 选择、验签、查单、退款接口 |
| 租户支付配置 | `cf-pay` | 凭据加密、启用/禁用、健康检查、字段元数据、审计 |
| 订单编排 | `cf-pay` | 创建支付单、回调路由、幂等、状态机、主动对账、退款工作流 |
| 业务接入 | cf-shop / cf-lottery 等消费方 | 只调用 `cf-pay` 或复用 `cf-core` Provider；禁止复制 Provider 协议代码 |

红线：

- 不在业务项目里再写 `easypay.ts` / `zpay.ts` 的协议实现。
- 不把 `zpay` 当成独立 Provider 名称散落到不同项目；统一用 `easypay`，用 `apiBase` 区分具体兼容网关。
- `cf-pay` 可以维护 Provider catalog 和租户配置 UI，但 catalog 字段必须映射到 `cf-core` Provider 的 env/config key。

## 币种与金额边界

新代码应从独立子路径导入纯函数，避免把 Provider 实现打进前端包：

```ts
import {
  formatProviderMajorAmount,
  parseMajorToMinor,
  selectPaymentProviderForCurrency,
} from "@usethink/cf-core/features/payment/currency";

const exponents = { CNY: 2, USD: 2, JPY: 0 } as const;
parseMajorToMinor("9.90", "CNY", exponents); // 990
parseMajorToMinor("500", "JPY", exponents); // 500

const amount = formatProviderMajorAmount(990, "CNY", ["CNY"], exponents); // "9.90"
const provider = selectPaymentProviderForCurrency(orderedProviders, "CNY");
```

约束：

- 持久化和支付比较使用安全整数，不使用浮点数。
- 未配置指数的币种、科学计数法、千分位、超精度和非安全整数全部 fail closed。
- Provider 在创建支付前必须验证 `supportedCurrencies`，不能把相同数字换一种币种提交。
- `QueryStatusResult` 可以返回 `amountCents`、`currency`、`paidAt` 和 `providerCreatedAt`，便于调用方做主动对账。
- TRC20 Provider 在 `0.3.x` 为兼容历史调用仍把 `amountCents` 按两位小数解释；它不代表 USDT 的 6 位链上最小单位。修正该历史契约需要单独的破坏性版本，不能在 patch 版本静默改变。

## 添加新支付渠道

实现 `PaymentProvider` 接口 + 创建 `ProviderFactory`：

```ts
import type { PaymentProvider, ProviderFactory } from "@usethink/cf-core/features/payment";

class WechatPayProvider implements PaymentProvider { /* ... */ }

export const wechatFactory: ProviderFactory = {
  name: "wechat",
  priority: 150, // alipay(100) < wechat(150) < stripe(200)
  isAvailable: (env) => !!env.WECHAT_APP_ID && !!env.WECHAT_KEY,
  create: (env) => new WechatPayProvider({ appId: env.WECHAT_APP_ID, key: env.WECHAT_KEY }),
};
```

# payment — 支付功能模块

## 包含

- `PaymentProvider` 接口（统一支付渠道抽象）
- `ProviderRegistry` + `ProviderFactory`（per-request 工厂）
- `AlipayProvider`（支付宝当面付，RSA2 签名，优先级 100）
- `StripeProvider`（Stripe Checkout Sessions，国际信用卡，优先级 200）
- `Trc20Provider`（USDT/TRC20 零资质加密支付，单地址+Memo 模式，优先级 300）
- `signRSA2` / `verifyRSA2`（Web Crypto API 签名工具）

## 快速使用

### 支付宝

```ts
import { AlipayProvider } from "@iusethink/cf-core/features/payment";

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

### Stripe（国际信用卡）

```ts
import { StripeProvider } from "@iusethink/cf-core/features/payment";

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
import { Trc20Provider } from "@iusethink/cf-core/features/payment";

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
  stripeFactory,
  trc20Factory,
} from "@iusethink/cf-core/features/payment";

const registry = createProviderRegistry(env, [
  alipayFactory,   // 需 ALIPAY_APP_ID + ALIPAY_PRIVATE_KEY + ALIPAY_PUBLIC_KEY
  stripeFactory,   // 需 STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
  trc20Factory,    // 需 TRC20_WALLET_ADDRESS + TRONGRID_API_KEY
]);

// 按优先级选择第一个可用的线上渠道（alipay > stripe > usdt_trc20）
const provider = registry.selectOnline();

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
| `STRIPE_SECRET_KEY` | stripe | Stripe Secret Key（sk_开头） |
| `STRIPE_WEBHOOK_SECRET` | stripe | Stripe Webhook Signing Secret（whsec_开头） |
| `TRC20_WALLET_ADDRESS` | usdt_trc20 | USDT 收款地址（T 开头 TRC20 地址） |
| `TRONGRID_API_KEY` | usdt_trc20 | TronGrid API Key（免费注册） |

## 设计原则

1. **纯类、零框架依赖** — 所有 Provider 可在任何 JavaScript 环境使用（Workers / Node / Deno / Bun）
2. **per-request 实例化** — `createProviderRegistry` 每次请求调用，避免全局状态泄漏
3. **统一接口** — `createPayment` → `verifyCallback` / `queryStatus`，应用层无需区分渠道
4. **金额统一分** — 所有金额以 `cents`（分）为单位，无浮点精度问题
5. **工厂模式** — 新渠道只需实现 `PaymentProvider` + `ProviderFactory`，注册即可使用

## 添加新支付渠道

实现 `PaymentProvider` 接口 + 创建 `ProviderFactory`：

```ts
import type { PaymentProvider, ProviderFactory } from "@iusethink/cf-core/features/payment";

class WechatPayProvider implements PaymentProvider { /* ... */ }

export const wechatFactory: ProviderFactory = {
  name: "wechat",
  priority: 150, // alipay(100) < wechat(150) < stripe(200)
  isAvailable: (env) => !!env.WECHAT_APP_ID && !!env.WECHAT_KEY,
  create: (env) => new WechatPayProvider({ appId: env.WECHAT_APP_ID, key: env.WECHAT_KEY }),
};
```

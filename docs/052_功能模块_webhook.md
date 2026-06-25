# webhook — Webhook 通知功能模块

## 快速使用

```ts
import { WebhookService } from "@eforge/cf-core/features/webhook";

const hook = new WebhookService({
  urls: "https://hooks.example.com/a,https://hooks.example.com/b",
  secret: "my-hmac-secret",
  timeoutMs: 5000,
  maxRetries: 2,
});

const results = await hook.notify("order.paid", {
  orderId: "12345",
  amount: 9900,
});
```

## 特性

- 多 URL 并行通知
- HMAC-SHA256 签名（`X-Webhook-Signature` 请求头）
- 5s 超时 + 最多 2 次重试
- `isConfigured` 属性检查是否有可用 URL

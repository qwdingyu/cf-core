# email — Resend 邮件功能模块

## 包含

- `EmailService` 类（Resend API 发送）
- `interpolate()` / `escapeHtml()`（模板引擎）

## 快速使用

```ts
import { EmailService } from "@usethink/cf-core/features/email";

const email = new EmailService({
  apiKey: env.RESEND_API_KEY,
  from: "商城 <noreply@example.com>",
});

// 直接发送
const result = await email.send({
  to: "buyer@example.com",
  subject: "订单确认",
  html: "<h1>您的订单已确认</h1>",
});

// 模板发送
await email.sendWithTemplate("buyer@example.com", {
  subject: "🎉 订单 {{orderNo}} 已完成",
  html: "<p>卡密：{{cardData}}</p>",
}, { orderNo: "12345", cardData: "XXXX-XXXX" });
```

## 特性

- 3 次自动重试（500ms → 1s → 2s 指数退避）
- 4xx 错误不重试，5xx 和网络错误重试
- HTML 自动转义（防 XSS）
- 健康检查：`email.healthCheck()`

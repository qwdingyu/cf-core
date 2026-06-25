# security — 安全工具

## 导出

| 函数 | 说明 |
|------|------|
| `sha256(input)` | SHA-256 哈希（64 位 hex） |
| `constantTimeEqual(a, b)` | 恒定时间字符串比较（防时序攻击） |
| `getIpHash(c, salt?)` | IP 加盐 SHA-256 哈希 |
| `getClientIp(c)` | 获取原始客户端 IP |
| `getBearerToken(c)` | 提取 Bearer Token |
| `verifyTurnstile(c, token?)` | Cloudflare Turnstile 验证 |
| `buildSecurityHeaders(options?)` | 生成 CSP + 安全响应头 |

## 示例

```ts
import { getIpHash, verifyTurnstile } from "@usethink/cf-core/security";

api.post("/orders", async (c) => {
  const turnstile = await verifyTurnstile(c, body.turnstileToken);
  if (!turnstile.ok) return fail(c, turnstile.message, 403);
  const ipHash = await getIpHash(c);
  // ...
});
```

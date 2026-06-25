# @eforge/cf-core

Cloudflare Workers 共享内核 — Hono + Turso + Drizzle 标准化基础设施。

从 eshop / xtools / vcode 三个项目中提取的公共代码，为批量产品复制提供统一基础。

## 快速开始

```bash
# 安装
cd packages/cf-core && npm install

# 类型检查
npm run type-check

# 测试
npm test
```

## 在项目中使用

### 方式 1：子路径导入（推荐）

```ts
import { ok, fail, maskContact } from "@eforge/cf-core/http";
import { sha256, verifyTurnstile, getIpHash } from "@eforge/cf-core/security";
import { initDatabase } from "@eforge/cf-core/db";
import { createAdminAuth } from "@eforge/cf-core/middleware";
import { bootstrap } from "@eforge/cf-core/bootstrap";
```

### 方式 2：根导入

```ts
import { ok, fail, sha256, initDatabase, bootstrap } from "@eforge/cf-core";
```

## 模块清单

| 模块 | 子路径 | 功能 |
|------|--------|------|
| **http** | `/http` | ok/fail 响应、maskContact、csvEscape、toCsv |
| **security** | `/security` | sha256、constantTimeEqual、getIpHash、verifyTurnstile、buildSecurityHeaders |
| **db** | `/db` | initDatabase（Isolate 级连接复用）、公共 Schema |
| **db/schema** | `/db/schema` | systemConfig、adminAuditLogs、rateLimitWindows、idempotencyKeys、apiKeys |
| **rate-limit** | `/rate-limit` | MemoryRateLimiter / KvRateLimiter / DbRateLimiter |
| **cache** | `/cache` | Workers Cache API 封装（Free 套餐不计入请求配额） |
| **idempotency** | `/idempotency` | 原子 UPSERT + 哨兵值幂等保护 |
| **audit** | `/audit` | fire-and-forget 审计日志 |
| **config** | `/config` | SystemConfig 类（运行时 KV 配置，热生效） |
| **bootstrap** | `/bootstrap` | Worker 入口工厂（DB 中间件 + 安全头 + 路由分流） |
| **auth/jwt** | `/auth/jwt` | JWT 签发/验证（HMAC-SHA256，纯 Web Crypto） |
| **auth/password** | `/auth/password` | PBKDF2 密码哈希 |
| **middleware** | `/middleware` | createAdminAuth / createApiKeyAuth |
| **error** | `/error` | classifyError + retryWithBackoff |
| **logger** | `/logger` | 结构化 JSON 日志 |
| **crypto** | `/crypto` | AES-256-GCM 加解密、generateUUID |

## 新项目模板使用

```ts
// src/index.ts
import * as schema from "./db/schema";
import { bootstrap } from "@eforge/cf-core/bootstrap";
import { createAdminAuth } from "@eforge/cf-core/middleware";
import { productRoutes } from "./routes/products";
import { orderRoutes } from "./routes/orders";

export default bootstrap({
  schema,
  securityHeaders: { allowTelegram: true },
  registerRoutes: (api) => {
    api.route("/products", productRoutes);
    api.route("/orders", orderRoutes);
    api.route("/admin", new Hono().use("*", createAdminAuth()).route("/", adminRoutes));
  },
  pageRoutes: { "/admin": "/admin.html" },
  spaRoutes: { fallback: "/_app/index.html", paths: ["/shop", "/order"] },
  immutablePrefixes: ["/_app/assets/"],
});
```

## 设计原则

1. **泛型优先** — 所有函数使用泛型 `Context<E>` 而非特定 `AppEnv`，兼容任意项目
2. **零耦合** — 模块间仅通过导入引用，不依赖全局状态
3. **Web Crypto** — 所有加密操作使用 Workers 原生 API，零外部依赖
4. **Free 友好** — Cache API 优先、Isolate 级缓存、惰性清理

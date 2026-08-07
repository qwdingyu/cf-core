# @usethink/cf-core

Cloudflare Workers 共享内核 — Hono + Turso + Drizzle 标准化基础设施。

从 cf-shop / xtools / vcode 三个项目中提取的公共代码，为批量产品复制提供统一基础。

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
import { ok, fail, maskContact } from "@usethink/cf-core/http";
import { sha256, verifyTurnstile, getIpHash } from "@usethink/cf-core/security";
import { initDatabase } from "@usethink/cf-core/db";
import { createAdminAuth } from "@usethink/cf-core/middleware";
import { bootstrap } from "@usethink/cf-core/bootstrap";
```

### 方式 2：根导入

```ts
import { ok, fail, sha256, initDatabase, bootstrap } from "@usethink/cf-core";
```

## 模块清单

| 模块 | 子路径 | 功能 |
|------|--------|------|
| **http** | `/http` | ok/fail 响应、maskContact、csvEscape、toCsv；并 re-export `clampInteger` / `isValidEmail` |
| **security** | `/security` | sha256、constantTimeEqual、timingSafeEqualHex/String、getIpHash、verifyTurnstile、buildSecurityHeaders |
| **media-image** | `/media-image` | 图片魔数检测/校验/R2 key 约束（`maxBytes` 与文案由产品注入） |
| **api-body-limit** | `/api-body-limit` | 路径→body 上限工厂、multipart 开销；流式 `readRequestBodyWithinLimit`（防 chunked 绕过） |
| **secret-config** | `/secret-config` | 敏感配置版本化加密：新写 `enc:v2:corejson:`；双读 v1 core-json / raw；可观测解密 |
| **utils** | `/utils` | 无业务语义小工具：`clampInteger`、`isValidEmail` |
| **db** | `/db` | initDatabase（Isolate 级连接复用）、公共 Schema |
| **db/schema** | `/db/schema` | systemConfig、adminAuditLogs、rateLimitWindows、idempotencyKeys、apiKeys |
| **rate-limit** | `/rate-limit` | MemoryRateLimiter / KvRateLimiter / DbRateLimiter |
| **cache** | `/cache` | Workers Cache API 封装（Free 套餐不计入请求配额） |
| **idempotency** | `/idempotency` | 复合主键 + requestHash 绑定 + pending 租约 fencing（兼容旧 3/5 参签名） |
| **audit** | `/audit` | fire-and-forget 审计日志 |
| **config** | `/config` | SystemConfig 类（运行时 KV 配置，热生效） |
| **bootstrap** | `/bootstrap` | Worker 入口工厂（DB 中间件 + 安全头 + 路由分流） |
| **auth/jwt** | `/auth/jwt` | JWT 签发/验证（HMAC-SHA256，固定 `sub`+`email` payload；多租户 claims 见下方边界） |
| **auth/password** | `/auth/password` | PBKDF2 密码哈希 |
| **middleware** | `/middleware` | createAdminAuth / createApiKeyAuth |
| **error** | `/error` | classifyError + retryWithBackoff |
| **logger** | `/logger` | 结构化 JSON 日志 |
| **crypto** | `/crypto` | AES-256-GCM 加解密、generateUUID |
| **features/payment** | `/features/payment` | Provider/Registry、支付宝、易支付兼容（ZPay 等）、Stripe、TRC20、按币种渠道选择、主动对账类型 |
| **payment currency** | `/features/payment/currency` | 严格主单位/最小单位转换与币种能力判断 |

### A′ 边界（与产品族对齐时请遵守）

- **会进 core**：纯函数、版本化加密封装、媒体魔数校验、body 上限工厂与流式闸门。
- **暂不进 / 禁止整包替换**：业务域（订单/抽奖/租户 RBAC）、限流表合并、HTTP fail 的 `error` vs `message` 全站契约迁移。
- **JWT**：当前 `signJwt(userId, email, …)` 固定 payload，**不能**直接替换需要 `tenantId` 等自定义 claims 的产品会话；generic claims API 属于后续 Phase B′。
- **Admin UI**：Vue 管理端共性在独立包 **`@usethink/cf-admin-fe`**（不是 `@usethink/cf-admin`），**不**并入本库。

### 与 `@usethink/cf-admin-fe` 的边界（正交分工，禁止越界）

cf-core 与 cf-admin-fe 是**互补而非重叠**的两个包（边界权威侧为本表；cf-admin-fe README 同名单向引用本表）：

| 域 | 归属包 | 说明 |
|---|---|---|
| Worker/API 基础设施（后端优先 + 前后端可用的纯 TS） | **cf-core（本包）** | http、crypto、rate-limit、JWT、features/email、features/payment |
| 前后端皆可用的纯 TS 原语 | **cf-core** | interpolate/escapeHtml、currency 转换、generateUUID |
| storefront 端共享 composable | **cf-core** | features/telegram-miniapp（前台，非管理端；允许纯 TS composable，**禁止 .vue 组件**） |
| 管理端前端套件（Vue 组件/composables/utils/i18n/styles） | **@usethink/cf-admin-fe** | AdminShell、AdminModal、createAdminRequest、useTableSelection |

**硬性纪律（`npm run verify:boundaries` 强制执行）**：
- **`src/` 与 `features/` 禁止 .vue 组件文件**：本包是基础设施内核（可含前端可用的纯 TS），不承载 UI 组件；管理端 UI 归 cf-admin-fe，storefront UI 归消费方。
- **禁止依赖或 import `@usethink/cf-admin-fe`**：内核不被管理端套件反向污染；两包双向零依赖、正交（管理端套件同样禁止依赖本包）。

### 敏感配置与 body 闸门示例

```ts
import {
  encryptSecretConfigValue,
  decryptSecretConfigValueObserved,
} from "@usethink/cf-core/secret-config";
import {
  createApiBodyLimitResolver,
  isContentLengthOverLimit,
  readRequestBodyWithinLimit,
  rebuildRequestWithBody,
} from "@usethink/cf-core/api-body-limit";
import { validateMediaImage } from "@usethink/cf-core/media-image";

// 新写入始终 v2；读路径用 Observed 以便解密失败可打日志（不传明文）
const cipher = await encryptSecretConfigValue(secret, encryptionKeyHex);
const plain = await decryptSecretConfigValueObserved(cipher, encryptionKeyHex, (e) => {
  console.warn("[secret-config]", e.reason);
});

const getLimit = createApiBodyLimitResolver({
  defaultBytes: 100 * 1024,
  mediaUploadBytes: 5 * 1024 * 1024 + 64 * 1024,
  mediaUploadPath: "/admin/media/images",
});
```

## 新项目模板使用

```ts
// src/index.ts
import * as schema from "./db/schema";
import { bootstrap } from "@usethink/cf-core/bootstrap";
import { createAdminAuth } from "@usethink/cf-core/middleware";
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

## 初始化 system_config

部署 `cf-shop` 模板时，Web 端和管理后台需要少量公开运行时配置。部署脚本生成 `.credentials/` 后运行：

```bash
npx cf-core-init-system-config --credentials-dir .credentials
```

脚本会幂等写入 `PROJECT_NAME`、`WORKER_NAME`、`DOMAIN`、`BASE_URL`、`TURNSTILE_SITE_KEY`，并默认拒绝把 Secret/Token 类字段写入 `system_config`。域名示例保持为 `shop.eforge.xyz`，项目/模板命名统一使用 `cf-shop`。

## 设计原则

1. **泛型优先** — 所有函数使用泛型 `Context<E>` 而非特定 `AppEnv`，兼容任意项目
2. **零耦合** — 模块间仅通过导入引用，不依赖全局状态
3. **Web Crypto** — 所有加密操作使用 Workers 原生 API，零外部依赖
4. **Free 友好** — Cache API 优先、Isolate 级缓存、惰性清理

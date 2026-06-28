# Token & Secret 速查表

> 日期：2026-05-29
> 范围：cf-core + 三个模板 + 部署脚本中所有 Token 的权威命名和用途

---

## 一、两类 Token 的本质区别

| Token | 用途 | 使用场景 | 何时需要 |
|-------|------|---------|---------|
| **CLOUDFLARE_API_TOKEN** | Cloudflare 管理 API | 部署 Worker、绑定域名、创建 Turnstile | **部署时**（一次性） |
| **TURSO_API_TOKEN** | Turso 管理 API | 创建数据库、创建 Token | **仅 Step 01**（一次性） |

> ⚠️ **最常见的错误**：把 `TURSO_API_TOKEN`（管理 API）和 `TURSO_TOKEN`（数据库连接）搞混。
> - `TURSO_API_TOKEN`：在 turso.tech 创建，用于 `api.turso.tech` 管理端点
> - `TURSO_TOKEN`：由 Turso 自动生成（Step 01），用于 `libsql://` 数据库连接

---

## 二、完整 Token 清单

### 2.1 部署时 Token（仅部署脚本使用）

| 名称 | 来源 | 用途 | 传给谁 |
|------|------|------|--------|
| `CLOUDFLARE_API_TOKEN` | [CF Dashboard](https://dash.cloudflare.com/profile/api-tokens) | Worker 部署/域名绑定/Turnstile | 部署脚本 + GitHub Actions |
| `TURSO_API_TOKEN` | [Turso Tokens](https://turso.tech/app/tokens) | 创建数据库 + 数据库 Token | 仅 `01-setup-turso.sh` |

### 2.2 运行时 Secret（Worker 环境变量）

| 名称 | 生成方式 | 用途 | 使用模块 |
|------|---------|------|---------|
| `TURSO_URL` | Step 01 自动创建 | 数据库连接 URL | `bootstrap()` 中间件 |
| `TURSO_TOKEN` | Step 01 自动创建 | 数据库认证 Token | `bootstrap()` 中间件 |
| `ADMIN_TOKEN` | Step 02 自动生成 | 管理后台认证 | `createAdminAuth()` 中间件 |
| `RATE_LIMIT_SALT` | Step 02 自动生成 | IP 哈希加盐 | `getIpHash()` |
| `JWT_SECRET` | Step 02 自动生成 | JWT 签名密钥 | `signJwt()` / `verifyJwt()` |
| `CREDENTIALS_ENCRYPTION_KEY` | Step 02 自动生成（64 hex = 256 bit） | AES-256-GCM 加解密 | `encrypt()` / `decrypt()` |

### 2.3 system_config 公开运行时配置

| 名称 | 来源 | 用途 | 使用模块 |
|------|------|------|---------|
| `PROJECT_NAME` | Step 06 写入 | 项目标识，统一使用 `cf-shop` 模板命名 | Web / 管理后台展示 |
| `WORKER_NAME` | Step 06 写入 | Worker 服务名 | 管理后台诊断 |
| `DOMAIN` | Step 06 写入 | 对外域名，例如 `shop.eforge.xyz` | Web / 管理后台跳转 |
| `BASE_URL` | Step 06 写入 | 对外基础 URL | Web / 管理后台 API 地址 |
| `TURNSTILE_SITE_KEY` | Step 05 创建、Step 06 写入 | 前端 Turnstile Widget 公开 key | Web 表单 |

### 2.4 可选运行时 Secret（按需配置）

| 名称 | 来源 | 用途 | 使用模块 |
|------|------|------|---------|
| `TURNSTILE_SECRET_KEY` | Step 05 自动创建 | Turnstile 人机验证 | `verifyTurnstile()` |
| `RESEND_API_KEY` | [Resend Dashboard](https://resend.com/api-keys) | 邮件发送 | `EmailService` |
| `EMAIL_FROM` | 手动配置 | 邮件发件人 | `EmailService` |
| `ALIPAY_APP_ID` | [支付宝开放平台](https://open.alipay.com) | 支付宝当面付 | `AlipayProvider` |
| `ALIPAY_PRIVATE_KEY` | 支付宝开放平台 | 支付宝 RSA2 签名 | `AlipayProvider` |
| `ALIPAY_PUBLIC_KEY` | 支付宝开放平台 | 支付宝回调验签 | `AlipayProvider` |

---

## 三、命名一致性保证

### 3.1 绝对禁止的命名变体

| ❌ 错误命名 | ✅ 正确命名 | 说明 |
|------------|------------|------|
| `TURSO_DB_URL` | `TURSO_URL` | cf-shop 旧脚本用过 |
| `TURSO_DB_AUTH_TOKEN` | `TURSO_TOKEN` | cf-shop 旧 GitHub Actions 用过 |
| `TURSO_AUTH_TOKEN` | `TURSO_TOKEN` | 容易混淆 |
| `CF_API_TOKEN` | `CLOUDFLARE_API_TOKEN` | vcode 旧 CI 用过 |
| `CF_AUTH_EMAIL` + `CF_GLOBAL_API_KEY` | `CLOUDFLARE_API_TOKEN` | 旧认证方式 |
| `ENCRYPTION_KEY` | `CREDENTIALS_ENCRYPTION_KEY` | cf-shop/cf-tools 旧命名 |
| `JWT_KEY` | `JWT_SECRET` | 容易混淆 |

### 3.2 权威命名来源

1. **部署脚本** `templates/.deploy/*.sh` — Secret 生成和上传的权威来源
2. **cf-core** `packages/cf-core/src/` — 运行时 API 参数名的权威来源
3. **`cf-core-init-system-config`** — `system_config` 公开配置初始化的权威入口
4. **bindings.ts** — 每个模板的 `src/bindings.ts` 必须与上述两者一致

---

## 四、数据流图

```
用户输入                    部署脚本                      Worker 运行时
─────────                  ────────                      ────────────

CLOUDFLARE_API_TOKEN ───→ 03/04/05 步骤 ───→ CF API（部署/域名/Turnstile）
                         07 步骤 ────────→ GitHub Actions Secret

TURSO_API_TOKEN ───────→ 01 步骤 ────────→ Turso API（创建数据库）
                         │
                         ├─→ .credentials/TURSO_URL ──→ 03 步骤 ──→ wrangler secret
                         │                                  │
                         └─→ .credentials/TURSO_TOKEN ──→ 03 步骤 ──→ wrangler secret
                                                                      │
                                                                      ↓
                                                               Worker 环境中
                                                               c.env.TURSO_URL
                                                               c.env.TURSO_TOKEN

02 步骤自动生成 ────────→ .credentials/ADMIN_TOKEN ──→ 03 步骤 ──→ wrangler secret
                          .credentials/RATE_LIMIT_SALT         │
                          .credentials/JWT_SECRET               │
                          .credentials/CREDENTIALS_ENCRYPTION_KEY
                                                                ↓
                                                         Worker 环境中
                                                         c.env.ADMIN_TOKEN
                                                         c.env.RATE_LIMIT_SALT
                                                         c.env.JWT_SECRET
                                                         c.env.CREDENTIALS_ENCRYPTION_KEY

05/06 步骤公开配置 ────→ .credentials/TURNSTILE_SITE_KEY ──→ system_config
                         .credentials/DOMAIN                  │
                         .credentials/BASE_URL                ↓
                                                         Web / 管理后台读取
```

`system_config` 只能存公开运行时配置。`SECRET`、`TOKEN`、`PASSWORD`、`PRIVATE`、`CREDENTIAL`、`AUTH`、`API_KEY` 等敏感值必须保留在 Worker Secret 或 GitHub Actions Secret。

---

## 五、快速排错

| 错误信息 | 原因 | 解决 |
|---------|------|------|
| `TURSO_URL is required` | Worker 中未设置 `TURSO_URL` | 检查 `wrangler secret list`，重新运行 `03-deploy-worker.sh` |
| `database not initialized` | `TURSO_URL` 或 `TURSO_TOKEN` 无效 | 检查 Turso Dashboard 数据库状态 |
| Web 端或管理后台缺少站点配置 | `system_config` 未初始化 | 运行 `npx cf-core-init-system-config --credentials-dir .credentials` |
| `ADMIN_TOKEN 未配置` | Worker 中未设置 `ADMIN_TOKEN` | `02-setup-secrets.sh` 未运行或 `03` 未上传 |
| `加密密钥必须为 64 字符 hex` | `CREDENTIALS_ENCRYPTION_KEY` 长度不对 | 重新运行 `02-setup-secrets.sh` |
| `Alipay callback signature invalid` | `ALIPAY_PUBLIC_KEY` 不正确 | 检查支付宝开放平台公钥配置 |
| `Turnstile 校验失败` | `TURNSTILE_SECRET_KEY` 与 Widget 不匹配 | 重新运行 `05-setup-turnstile.sh` |

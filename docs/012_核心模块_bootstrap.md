# bootstrap — Worker 入口工厂

## 功能

`bootstrap()` 一个配置对象创建完整的 Workers 应用，自动处理：

- 数据库初始化中间件（Isolate 级连接复用）
- 请求体大小限制（默认 100KB）
- 安全响应头注入（CSP + 标准安全头）
- API 路由 / 静态资源分流
- SPA 路由 fallback
- 长缓存静态资源（`/_app/assets/` → 1 年 immutable）
- 全局 404 + onError 处理

## 配置项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `schema` | object | - | Drizzle schema（支持关系查询） |
| `apiPrefix` | string | `"/api"` | API 路由前缀 |
| `maxBodySize` | number | `102400` | 请求体限制（字节） |
| `securityHeaders` | object | `{}` | CSP 配置选项 |
| `registerRoutes` | function | **必填** | 路由注册回调 |
| `pageRoutes` | object | `{}` | 页面路径 → HTML 文件映射 |
| `spaRoutes` | object | - | SPA fallback 配置 |
| `immutablePrefixes` | string[] | `[]` | 长缓存路径前缀 |

## 示例

```ts
import { bootstrap } from "@usethink/cf-core/bootstrap";
import { createAdminAuth } from "@usethink/cf-core/middleware";
import * as schema from "./db/schema";

export default bootstrap({
  schema,
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

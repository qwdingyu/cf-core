# http — HTTP 响应工具

## 导出

| 函数 | 说明 |
|------|------|
| `ok(c, data, status?)` | 成功响应 `{ ok: true, ...data }` |
| `fail(c, message, status?, details?)` | 失败响应 `{ ok: false, error }` |
| `getOrigin(c)` | 获取站点域名（优先 APP_ORIGIN） |
| `safeJsonBody(c)` | 安全读取 JSON body（解析失败返回 undefined） |
| `maskContact(value)` | 联系方式脱敏（`ab***@example.com`） |
| `normalizeCode(value?)` | 标准化编码（trim + lowercase） |
| `csvEscape(value)` | CSV 注入防护 |
| `toCsv(rows, columns)` | 对象数组导出为 CSV 字符串 |

## 示例

```ts
import { ok, fail, maskContact } from "@usethink/cf-core/http";

api.get("/users/:id", async (c) => {
  const user = await getUser(c.req.param("id"));
  if (!user) return fail(c, "用户不存在", 404);
  return ok(c, { user: { ...user, email: maskContact(user.email) } });
});
```

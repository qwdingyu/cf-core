---
name: npm-scope-rename
description: Diagnose npm package visibility issues caused by scope/account mismatch, decide between changing token account or renaming package scope, and systematically rename a package across the entire codebase.
source: auto-skill
extracted_at: '2026-06-25T07:31:14.792Z'
---

# npm 包作用域不匹配：诊断与重命名

## 适用场景

当发布 npm 包后，在 `https://www.npmjs.com/settings/<account>/packages` 中看不到刚发布的包时使用。

## 根因模式

npm 包的可见性与 **发布令牌所属账号** 和 **包名作用域（scope）** 强绑定：

- 包名 `@usethink/cf-core` 只能被 `iusethink` 账号的令牌发布后可见
- 如果用 `@eforge` 账号的令牌发布 `@usethink/cf-core`，包不会出现在 `iusethink` 的 packages 页面
- 同理，`@eforge/cf-core` 不会出现在 `iusethink` 的 packages 页面

## 诊断步骤

1. **确认包名**：查看 `package.json` 中的 `name` 字段
2. **确认令牌账号**：查看 GitHub Actions Secrets 或本地 `.npmrc` 中的 `//registry.npmjs.org/:_authToken` 对应哪个 npm 账号
3. **对比**：如果 `name` 的 scope 与令牌账号不一致，就会出现"发布成功但不可见"的问题

## 决策框架

遇到 scope 不匹配时，有两种修复方案：

| 方案 | 操作 | 适用场景 |
|------|------|---------|
| A | 重命名包 scope，使其与现有令牌账号一致 | 用户已有稳定的 npm 账号和令牌，不想更换 |
| B | 创建新账号/令牌，将 scope 改为匹配新账号 | 项目确实属于另一个组织/账号 |

**推荐优先评估方案 A**，因为：
- 不涉及创建新账号、转移组织、重新授权
- 对现有 CI/CD 和下游用户影响最小
- 只需一次全仓库字符串替换

## 重命名 procedure

### 1. 批量替换字符串

使用统一的 sed/批量替换命令，覆盖所有引用位置：

```bash
# 替换包名核心标识
OLD_SCOPE="old-scope"
NEW_SCOPE="new-scope"
PACKAGE_NAME="package-name"
OLD_NAME="@${OLD_SCOPE}/${PACKAGE_NAME}"
NEW_NAME="@${NEW_SCOPE}/${PACKAGE_NAME}"

# 批量替换（根据项目结构调整路径）
find . -type f \( -name "*.ts" -o -name "*.md" -o -name "*.yml" -o -name "*.yaml" -o -name "*.json" -o -name "*.mjs" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -not -path "./dist/*" \
  -exec sed -i '' "s|${OLD_NAME}|${NEW_NAME}|g" {} +
```

**注意**：macOS 的 `sed -i ''` 与 Linux 的 `sed -i` 语法不同。

### 2. 单独修改 package.json

```bash
# 修改 name 字段
sed -i '' "s|\"name\": \"${OLD_NAME}\"|\"name\": \"${NEW_NAME}\"|" package.json

# 修改 lockfile（如果存在）
sed -i '' "s|\"name\": \"${OLD_NAME}\"|\"name\": \"${NEW_NAME}\"|" package-lock.json
```

### 3. 验证无遗漏

使用 grep 确认全仓库无旧引用：

```bash
grep -rn "${OLD_NAME}" . \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=dist \
  --exclude-dir=.qwen
```

**关键**：搜索必须覆盖：
- `package.json` / `package-lock.json`
- `README.md`
- 所有 `*.md` 文档
- 所有 `*.ts` 源码文件
- `*.yml` / `*.yaml` workflow 文件
- `scripts/*` 发布脚本

### 4. 本地验证

```bash
pnpm install
pnpm type-check
pnpm test
pnpm build
```

### 5. 提交并推送

```bash
git add -A
git commit -m "refactor: rename package scope from @old/name to @new/name

Reason: npm token account mismatch; rename to match existing npm token."
git push origin main
```

### 6. 触发 CI 验证

推送后，触发 GitHub Actions workflow，确认发布流程使用新包名成功发布，并验证在 `https://www.npmjs.com/settings/<new-account>/packages` 中可见。

## 常见陷阱

- **只改了 package.json name**：如果文档、源码注释、示例代码中仍有旧包名引用，下游用户会困惑
- **忽略了 lockfile**：`package-lock.json` 或 `pnpm-lock.yaml` 中通常包含包名，需要同步替换
- **忽略了发布脚本**：`scripts/publish-package.mjs` 等发布脚本中可能有硬编码的包名
- **忽略了文档**：`README.md` 和 `docs/*.md` 中的示例代码必须同步更新
- ** scope 大小写敏感**：npm scope 是大小写敏感的，替换时保持一致性

## 与 CI 切换的协同

如果团队同时经历了 pnpm→npm 的 CI 切换，重命名 scope 应在 CI 稳定后进行，避免一次提交包含过多无关变更，降低回滚复杂度。

## 经验教训

1. **先确认令牌账号，再决定包名**：在项目早期就应确认 npm 包的 scope 与发布令牌账号一致，避免后期大规模重命名。
2. **全仓库字符串替换要系统化**：不要只改 `package.json`，必须覆盖文档、示例、注释、发布脚本。
3. **grep 验证是必须的**：批量替换后，务必用 grep 确认无遗漏。
4. **本地验证 + CI 验证缺一不可**：本地能跑不代表 CI 能发布，必须触发真实 workflow 验证。

---
name: pnpm-github-actions-install-debug
description: Debug and fix pnpm install failures in GitHub Actions caused by NPM_CONFIG_USERCONFIG overriding project .npmrc settings, especially onlyBuiltDependencies.
source: auto-skill
extracted_at: '2026-06-25T07:21:40.860Z'
---

# pnpm GitHub Actions install 调试

## 适用场景

当项目在 GitHub Actions 中 `pnpm install` 失败，且错误包含 `[ERR_PNPM_IGNORED_BUILDS]` 或类似 "Ignored build scripts" 提示时使用。

## 根因模式

`pnpm/action-setup@v4` 在 CI 环境中会设置 `NPM_CONFIG_USERCONFIG` 环境变量，指向一个临时 `.npmrc`。这会导致 pnpm **无法读取项目根目录的 `.npmrc`**，从而忽略其中的关键配置，例如：

- `onlyBuiltDependencies[]=esbuild`
- `shamefully-hoist`
- `strict-peer-dependencies`

## 诊断步骤

1. **查看失败日志**：在 GitHub Actions 运行日志中搜索 `[ERR_PNPM_IGNORED_BUILDS]` 或 `Ignored build scripts`。
2. **确认环境变量**：检查日志中是否存在 `NPM_CONFIG_USERCONFIG=/home/runner/work/_temp/.npmrc` 之类的环境变量。
3. **验证项目 .npmrc**：确认项目根目录的 `.npmrc` 中确实包含 `onlyBuiltDependencies[]=esbuild` 等关键配置。

## 修复方案

### 方案一：防御性取消环境变量（最小改动）

在 `Install dependencies` 步骤中，先取消 `NPM_CONFIG_USERCONFIG`，再执行 `pnpm install`：

```yaml
- name: Install dependencies
  run: |
    unset NPM_CONFIG_USERCONFIG
    pnpm install
```

### 方案二：移除 pnpm/action-setup（更彻底）

`actions/setup-node@v4` 已经内置了 corepack/pnpm 缓存支持，可以直接替代 `pnpm/action-setup`：

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: 22
    registry-url: 'https://registry.npmjs.org'
    cache: 'pnpm'
```

然后删除 `pnpm/action-setup@v4` 步骤，并在 install 前保留 `unset NPM_CONFIG_USERCONFIG` 作为防御性措施。

## 关键经验：当 pnpm 在 CI 中持续不可用时，直接切换到 npm

经过多次尝试后，如果以下方案均告失败，应果断切换到 npm：

1. `pnpm/action-setup@v4` 安装了 pnpm，但后续步骤仍报 `Unable to locate executable file: pnpm`
2. `corepack enable && corepack prepare pnpm@11.5.2 --activate` 已执行，但 pnpm shim 不可见
3. 设置 `COREPACK_ENABLE_STRICT=0` 后仍失败
4. `npm install -g pnpm` 并 `echo "$(npm root -g)/.bin" >> "$GITHUB_PATH"` 后仍失败

**此时应直接切换为 npm 流程**，避免在单一工具链上反复消耗时间。

### npm 切换 checklist

1. **Workflow 改用 npm 命令**：
   ```yaml
   - name: Setup Node.js
     uses: actions/setup-node@v4
     with:
       node-version: 22
       registry-url: 'https://registry.npmjs.org'
   
   - name: Verify tools
     run: |
       node --version
       npm --version
   
   - name: Install dependencies
     run: npm install
   ```

2. **移除 pnpm 相关步骤**：删除 `Setup pnpm`、`Enable pnpm via corepack` 等步骤

3. **检查 package.json 生命周期脚本**：确保 `prepublishOnly`、`prepack` 等脚本不硬编码 `pnpm`：
   ```json
   {
     "scripts": {
       "prepublishOnly": "npm run type-check && npm test",
       "prepack": "npm run build"
     }
   }
   ```
   **关键**：`npm publish` 会触发 `prepublishOnly`，如果里面写死 `pnpm run ...`，在 npm CI 环境中会失败。

4. **生成 package-lock.json**：为了让 `actions/setup-node` 的 `cache: 'npm'` 生效，需要存在 `package-lock.json`：
   ```bash
   npm install
   git add package-lock.json
   ```
   注意：此时项目中会同时存在 `pnpm-lock.yaml` 和 `package-lock.json`，本地开发仍用 pnpm，CI 用 npm。

5. **更新 publish 步骤**：
   ```yaml
   - name: Publish to npm
     run: |
       if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
         if [ "${{ inputs.dry_run }}" = "true" ]; then
           echo "🧪 Dry-run 模式..."
           npm publish --dry-run --tag=${{ inputs.tag }}
         else
           echo "🚀 手动触发正式发布..."
           npm publish --tag=${{ inputs.tag }}
         fi
       else
         echo "🚀 Tag 触发自动发布: ${{ github.ref_name }}"
         npm publish --tag=latest
       fi
   ```

## 验证清单

修复后，在本地和 CI 中依次验证：

```bash
# 本地仍可用 pnpm
pnpm install
pnpm type-check
pnpm test
pnpm build

# CI 中用 npm
npm install
npm run type-check
npm test
npm run build
```

## 注意事项

- 不要依赖 `--config.` 命令行参数来传递 `onlyBuiltDependencies`，pnpm 不支持通过此参数覆盖该配置。
- `pnpm approve-builds` 可以临时允许特定依赖的脚本，但会改变锁文件的语义，不适合 CI 自动化。
- 如果项目中使用了 `COREPACK_ENABLE_STRICT=0`，检查是否仍然必要；在较新版本的 pnpm/corepack 中可能已不再需要。
- **当 pnpm 在 CI 中反复出现不可用问题时，优先考虑切换到 npm 而非继续调试 pnpm**——发布流程的稳定性优先于包管理器偏好。

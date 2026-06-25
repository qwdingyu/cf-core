# CI 踩坑记录：GitHub Actions 中 pnpm 安装与 npm 切换

> 日期：2026-06-25
> 仓库：`cf-core`
> 影响：Publish Workflow 连续失败 7 次，最终通过切换为 npm 解决

---

## 一、问题现象

GitHub Actions `Publish` workflow 在 `Install dependencies` 步骤持续失败，报错：

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.21.5
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
##[error]Process completed with exit code 1.
```

后续尝试修复 pnpm 可用性时，又出现：

```
##[error]Unable to locate executable file: pnpm. Please verify either the file path exists or the file can be found within a directory specified by the PATH environment variable.
```

以及切换到 npm 后：

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "link:": link:../drizzle-orm/dist
```

---

## 二、排查与修复过程（按时间顺序）

### 2.1 初步根因定位：`.npmrc` 被覆盖

**现象**：`pnpm/action-setup@v4` 在 CI 中设置 `NPM_CONFIG_USERCONFIG` 环境变量，指向临时 `.npmrc`。

**根因**：项目根目录 `.npmrc` 中的 `onlyBuiltDependencies[]=esbuild` 配置无法被读取，导致 `esbuild` 的 `postinstall` 脚本被 pnpm 阻止。

**修复尝试 1**：在 `Install dependencies` 步骤前 `unset NPM_CONFIG_USERCONFIG`。

```yaml
- name: Install dependencies
  run: |
    unset NPM_CONFIG_USERCONFIG
    pnpm install
```

**结果**：`pnpm install` 通过，但进入 `Verify tools` 步骤后失败，提示 `pnpm` 命令不存在。

---

### 2.2 修复尝试 2：移除 `pnpm/action-setup`，改用 `corepack`

**思路**：`pnpm/action-setup@v4` 可能是 PATH 污染源，改用 Node 自带的 `corepack` 提供 pnpm。

**修改**：

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: 22
    registry-url: 'https://registry.npmjs.org'
    cache: 'pnpm'

- name: Enable pnpm via corepack
  run: corepack enable && corepack prepare pnpm@11.5.2 --activate
```

**结果**：失败，`pnpm` 命令仍不可见。

---

### 2.3 修复尝试 3：添加 `COREPACK_ENABLE_STRICT=0`

**思路**：corepack 默认 strict 模式可能阻止 pnpm shim 生成。

**修改**：

```yaml
- name: Enable pnpm via corepack
  run: |
    corepack enable
    COREPACK_ENABLE_STRICT=0 corepack prepare pnpm@11.5.2 --activate
```

**结果**：失败，`pnpm` 命令仍不可见。

---

### 2.4 修复尝试 4：全局安装 pnpm 并加入 PATH

**思路**：corepack shim 不可靠，直接用 npm 全局安装 pnpm。

**修改**：

```yaml
- name: Enable pnpm via corepack
  run: |
    corepack enable
    COREPACK_ENABLE_STRICT=0 corepack prepare pnpm@11.5.2 --activate
    echo "$(npm root -g)/.bin" >> "$GITHUB_PATH"
    npm install -g pnpm@11.5.2
```

**结果**：失败，`pnpm` 命令仍不可见。

---

### 2.5 修复尝试 5：回退到 `pnpm/action-setup@v4`

**思路**：corepack/npm install -g 方式在 Node 22 缓存环境下均失效，回退到官方 action。

**修改**：

```yaml
- name: Setup pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 11.5.2
```

**结果**：失败，`pnpm` 命令仍不可见。

---

### 2.6 关键转折：切换到 npm

**思路**：经过 5 次尝试，pnpm 在 CI 中始终无法稳定可用。项目 scripts 已兼容 npm（`npm run build` 等），直接切换为 npm。

**修改**：

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

**结果**：`npm install` 失败，提示缺少锁文件：

```
Error: Dependencies lock file is not found in /home/runner/work/cf-core/cf-core.
Supported file patterns: package-lock.json,npm-shrinkwrap.json,yarn.lock
```

---

### 2.7 生成 `package-lock.json`

**思路**：`actions/setup-node` 的 `cache: 'npm'` 需要 `package-lock.json` 才能生效。

**本地操作**：

```bash
npm install --legacy-peer-deps
```

**结果**：生成 `package-lock.json`（1940 行），提交到仓库。

---

### 2.8 修复 `prepublishOnly` 钩子

**现象**：切换到 npm 后，`npm publish` 触发 `prepublishOnly` 失败：

```
> @iusethink/cf-core@0.3.0 prepublishOnly
> pnpm run type-check && pnpm test
sh: 1: pnpm: not found
```

**根因**：`package.json` 中的 `prepublishOnly` 和 `prepack` 硬编码了 `pnpm` 命令。

**修复**：

```json
{
  "scripts": {
    "prepublishOnly": "npm run type-check && npm test",
    "prepack": "npm run build"
  }
}
```

---

### 2.9 最终验证

触发 dry-run workflow：

```
✓ Build & Publish in 30s
  ✓ Checkout
  ✓ Setup Node.js
  ✓ Verify tools
  ✓ Install dependencies
  ✓ Type check
  ✓ Run tests
  ✓ Build
  ✓ Publish to npm
  ✓ Display publish result
```

Workflow run: `28153563824`（success）

---

## 三、根因总结

| 问题 | 根因 | 影响 |
|------|------|------|
| `esbuild` postinstall 被阻止 | `pnpm/action-setup@v4` 设置 `NPM_CONFIG_USERCONFIG` 覆盖项目 `.npmrc` | `pnpm install` 失败 |
| `pnpm` 命令不可见 | Node 22 缓存环境下，`corepack prepare` / `npm install -g` 均未能生成可用 pnpm shim | 所有 pnpm 步骤失败 |
| npm 缺少锁文件 | 项目只有 `pnpm-lock.yaml`，没有 `package-lock.json` | `npm install` 在 CI 中失败 |
| `prepublishOnly` 硬编码 pnpm | 脚本写死 `pnpm run ...`，切换 npm 后失效 | `npm publish` 触发失败 |

---

## 四、最终修复方案

### 4.1 `.github/workflows/publish.yml`

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

- name: Type check
  run: npm run type-check

- name: Run tests
  run: npm test

- name: Build
  run: npm run build

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

### 4.2 `package.json` scripts 兼容

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run type-check && npm test",
    "prepack": "npm run build"
  }
}
```

### 4.3 新增 `package-lock.json`

与 `pnpm-lock.yaml` 并存，CI 使用 npm 缓存，本地开发仍推荐 pnpm。

---

## 五、经验教训

1. **不要迷信单一包管理器**：pnpm 在本地表现优秀，但在 CI 环境中可能因缓存、shim、环境变量等问题失效。当某个工具在 CI 中反复失败时，应考虑降级到更基础的方案（npm）。

2. **`.npmrc` 是 CI 的隐形杀手**：`pnpm/action-setup`、`actions/setup-node` 等 action 可能设置 `NPM_CONFIG_USERCONFIG`，覆盖项目 `.npmrc`。如果项目依赖 `.npmrc` 中的特殊配置（如 `onlyBuiltDependencies`），必须显式 `unset`。

3. **锁文件是 CI 缓存的前提**：`actions/setup-node` 的 `cache: 'pnpm'` / `cache: 'npm'` 都需要对应锁文件。切换包管理器时，必须同步生成/更新锁文件。

4. **lifecycle 脚本要考虑执行环境**：`prepublishOnly`、`prepack` 等 npm lifecycle 脚本在 CI 中执行时，环境可能与本地不同。避免在脚本中硬编码特定包管理器命令。

5. **快速失败，快速切换**：如果某个方案连续 3 次尝试均失败，应立即评估替代方案，而不是继续叠加 workaround。这次在 pnpm 上浪费了 7 次 workflow 运行。

---

## 六、后续优化建议

- [ ] 考虑完全移除 `.npmrc` 中的 `onlyBuiltDependencies`，改用 `pnpm.onlyBuiltDependencies` 或 `overrides` 解决 esbuild 脚本问题
- [ ] 如果未来要恢复 pnpm，建议在 `pnpm/action-setup` 后添加 `pnpm config set onlyBuiltDependencies esbuild` 显式配置
- [ ] 在 README 中注明：CI 使用 npm，本地开发使用 pnpm

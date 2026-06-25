# @usethink/publish-toolkit

统一 npm 包发布工具链 — 混淆构建、包准备、一键发布。

## 安装

```bash
npm install -D @usethink/publish-toolkit
```

## 快速使用

### 发布包

```bash
NPM_TOKEN=npm_xxx npx publish-toolkit publish --dry-run
```

### 混淆构建产物

```bash
npx publish-toolkit obfuscate --input ./dist --output ./dist-obf --level light
```

## GitHub Actions 集成

```yaml
- run: npx publish-toolkit publish
  env:
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## 命令

### publish

构建并发布 npm 包。

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--package <path>` | 包目录 | 当前目录 |
| `--registry <url>` | 目标 registry | https://registry.npmjs.org/ |
| `--dry-run` | 预览模式，不实际发布 | false |
| `--tag <name>` | dist-tag | latest |
| `--otp <code>` | OTP 二次验证码 | - |
| `--access <level>` | 发布访问级别 | public |
| `--no-git-check` | 跳过 git 检查 | false |
| `--no-version-check` | 跳过版本号检查 | false |
| `--verbose, -v` | 详细日志 | false |

### obfuscate

对构建产物进行混淆（占位实现，后续接入真实混淆器）。

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--input <dir>` | 输入目录 | - |
| `--output <dir>` | 输出目录 | - |
| `--level <name>` | 混淆级别 | light |
| `--source-map` | 保留 source map | false |

## License

MIT

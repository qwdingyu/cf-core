#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# cf-core GitHub Actions 一键配置脚本
#
# 用途：
#   通过 gh CLI 自动设置仓库 Secrets，使 publish.yml 能自动运行。
#   后续 token 过期 / 轮换时，重新跑一次即可更新。
#
# 前置条件：
#   - gh CLI 已安装且已登录 (gh auth status)
#   - 有仓库 qwdingyu/cf-core 的写入权限
#
# 环境变量：
#   - NPM_TOKEN    — npm 自动化 access token（必填）
#                    https://npmjs.com/settings/tokens
#   - REPO         — GitHub 仓库（默认: qwdingyu/cf-core）
#
# 使用：
#   # 首次配置
#   NPM_TOKEN="npm_xxx" bash scripts/setup-github-secrets.sh
#
#   # Token 过期后更新
#   NPM_TOKEN="npm_new_token" bash scripts/setup-github-secrets.sh
#
#   # 自定义仓库（如 fork）
#   NPM_TOKEN="npm_xxx" REPO="你的用户名/cf-core" bash scripts/setup-github-secrets.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO="${REPO:-qwdingyu/cf-core}"

# ═══════════════════════════════════════════════════════════════════════════════
# 检查依赖
# ═══════════════════════════════════════════════════════════════════════════════
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║      cf-core GitHub Actions 配置                             ║"
echo "║      仓库: $REPO"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

if ! command -v gh &>/dev/null; then
  echo "❌ 未找到 gh 命令，请先安装 GitHub CLI"
  echo "   https://cli.github.com/"
  exit 1
fi

if ! gh auth status &>/dev/null 2>&1; then
  echo "❌ gh 未登录，请运行 gh auth login"
  exit 1
fi
echo "✅ gh CLI 已就绪 ($(gh auth status 2>&1 | head -1))"

# ═══════════════════════════════════════════════════════════════════════════════
# 检查必填参数
# ═══════════════════════════════════════════════════════════════════════════════
if [ -z "${NPM_TOKEN:-}" ]; then
  echo "❌ 缺少 NPM_TOKEN"
  echo ""
  echo "用法:"
  echo "  NPM_TOKEN=\"npm_xxx\" bash scripts/setup-github-secrets.sh"
  echo ""
  echo "获取 token: https://npmjs.com/settings/tokens"
  echo "（推荐创建"Automation"类型 token，无需 2FA）"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 设置 Secrets
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 配置 Secrets ──"
echo ""

# NPM_TOKEN — 给 publish.yml 用
echo "  → NPM_TOKEN ..."
echo "$NPM_TOKEN" | gh secret set NPM_TOKEN --repo "$REPO"
echo "  ✅ NPM_TOKEN"

# ═══════════════════════════════════════════════════════════════════════════════
# 验证
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "── 当前 Secrets ──"
gh secret list --repo "$REPO" 2>/dev/null || echo "  (无法列出 secrets)"

echo ""
echo "── 验证 publish.yml 是否存在 ──"
if gh api "/repos/$REPO/contents/.github/workflows/publish.yml" --jq '.name' &>/dev/null 2>&1; then
  echo "  ✅ publish.yml 已就绪"
else
  echo "  ⚠️  publish.yml 未找到（请先 push 代码）"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 总结
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ✅ 配置完成！                                             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "发布流程："
echo ""
echo "  1. 修改代码 + bump 版本号"
echo "     → 编辑 package.json 中的 version 字段"
echo ""
echo "  2. 提交并打 tag"
echo "     git add -A"
echo "     git commit -m 'feat: xxx'"
echo "     git tag v0.4.0"
echo "     git push && git push origin v0.4.0"
echo ""
echo "  3. GitHub Actions 自动执行："
echo "     test → build → publish ✅"
echo ""
echo "  或手动触发:"
echo "     gh workflow run publish.yml --repo $REPO"
echo ""
echo "Token 管理："
echo "  - NPM_TOKEN 已存入仓库 Secrets"
echo "  - 如需更新 token，重新跑此脚本即可"
echo "  - 建议在 npm 创建永不过期的 Automation token"

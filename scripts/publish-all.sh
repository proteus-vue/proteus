#!/bin/bash
# scripts/publish-all.sh —— 全 workspace 包发布（★需 npm 已登录：npm login 或 NPM_TOKEN）
# 逻辑：逐包 publish --access public；registry 已有同版本 → 跳过（不视为失败）。
# 预检：npm publish --dry-run 已全量验证通过（files/prepare/打包零错误）。
# 用法：bash scripts/publish-all.sh [--beta]   （--beta → 全部挂 beta dist-tag）
set -u
TAG="${1:-}"
TAG_FLAG=""
if [ "$TAG" = "--beta" ]; then TAG_FLAG="--tag beta"; fi

FAIL=0
SKIP=0
PUB=0
for dir in packages/*/; do
  name=$(node -e "console.log(require('./$dir/package.json').name ?? '')" 2>/dev/null)
  [ -z "$name" ] && continue
  version=$(node -e "console.log(require('./$dir/package.json').version ?? '')")
  # registry 已有该版本 → 跳过
  existing=$(npm view "$name@$version" version 2>/dev/null)
  if [ -n "$existing" ]; then
    echo "↷ skip $name@$version（registry 已存在）"
    SKIP=$((SKIP + 1))
    continue
  fi
  echo "▶ publish $name@$version"
  if npm publish --access public $TAG_FLAG -w "$name"; then
    PUB=$((PUB + 1))
  else
    echo "✗ FAIL $name@$version"
    FAIL=$((FAIL + 1))
  fi
done
echo ""
echo "结果：published $PUB · skipped $SKIP · failed $FAIL"
exit $FAIL

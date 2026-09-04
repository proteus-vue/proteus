#!/bin/bash
# scripts/publish-all.sh —— 全 workspace 包发布（★需 npm 凭据：全局 ~/.npmrc 或 NPM_TOKEN）
# 逻辑：逐包 cd 进目录 publish --access public；registry 已有同版本 → 跳过（不视为失败）。
# 预检：npm publish --dry-run 已全量验证通过（files/prepare/打包零错误）。
# 用法：bash scripts/publish-all.sh [--beta]   （--beta → 全部挂 beta dist-tag）
set -u
TAG="${1:-}"
TAG_FLAG=""
if [ "$TAG" = "--beta" ]; then TAG_FLAG="--tag beta"; fi

ROOT="$PWD"
FAIL=0
SKIP=0
PUB=0
for dir in packages/*/; do
  name=$(node -e "console.log(require('./$dir/package.json').name ?? '')" 2>/dev/null)
  [ -z "$name" ] && continue
  version=$(node -e "console.log(require('./$dir/package.json').version ?? '')" 2>/dev/null)
  [ -z "$version" ] && continue
  # registry 已有该版本 → 跳过
  existing=$(npm view "$name@$version" version 2>/dev/null | tail -1)
  if [ -n "$existing" ]; then
    echo "skip $name@$version (registry already has it)"
    SKIP=$((SKIP + 1))
    continue
  fi
  echo "publish $name@$version"
  if (cd "$ROOT/$dir" && npm publish --access public $TAG_FLAG); then
    PUB=$((PUB + 1))
  else
    echo "FAIL $name@$version"
    FAIL=$((FAIL + 1))
  fi
done
echo ""
echo "RESULT: published $PUB - skipped $SKIP - failed $FAIL"
exit $FAIL

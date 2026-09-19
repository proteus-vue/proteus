#!/bin/bash
# scripts/publish-all.sh —— 全 workspace 包发布（★需 npm 凭据：全局 ~/.npmrc 或 NPM_TOKEN）
#
# 用法：bash scripts/publish-all.sh [--beta] [--allow-drift]
#   --beta         全部挂 beta dist-tag
#   --allow-drift  允许「同版本号但内容不同」的包被跳过（默认**报错并要求 bump**——见下）
#
# ★2026-09-19 事故修复（README「npm 发布」节记有完整复盘）：
#   旧逻辑「registry 已有该版本 → 跳过」本身是幂等发布的合理设计，但它**无法区分**：
#     ① 内容确实一样（幂等重跑 → 跳过正确）
#     ② 本地源码改了但**忘了 bump 版本号**（跳过 = 新内容永远发不出去；而依赖方 bump 后
#        声明旧版本号 → 拿到的仍是旧内容 → **运行时报「does not provide an export named X」**）
#   ② 曾实际发生：`@proteus-vue/cli@0.3.0-beta.2` 顶层 import `createFlamegraphCollector`，
#   而 npm 上 `devtools-runtime@0.1.0` 是旧构建（只有 8 个导出）→ **CLI 启动即崩**。
#   现改为：已存在的版本**比对本地 pack integrity 与 registry integrity**——
#     相同 → 跳过（幂等，正常）；不同 → **FAIL 并提示 bump**（默认；`--allow-drift` 可放行）。
set -u
TAG=""
ALLOW_DRIFT=0
for arg in "$@"; do
  case "$arg" in
    --beta) TAG_FLAG="--tag beta"; TAG="--beta" ;;
    --allow-drift) ALLOW_DRIFT=1 ;;
  esac
done
: "${TAG_FLAG:=}"

ROOT="$PWD"
FAIL=0
SKIP=0
PUB=0
DRIFT=0

echo "=== 发布前漂移预检（同版本号 ⇒ 内容须一致）==="
if ! node "$ROOT/scripts/check-publish-drift.mjs" --check; then
  echo ""
  if [ "$ALLOW_DRIFT" = "1" ]; then
    echo "⚠ 存在漂移，但已指定 --allow-drift：漂移包将被**跳过**（新内容不会发布）"
  else
    echo "✗ 存在「同版本号但内容不同」的包——这些包的新内容发不出去，依赖方会拿到旧包。"
    echo "  修复：给它们 bump 版本号（同版本无法覆盖发布），并同步 bump 依赖它们的包（内部依赖为 exact pin）。"
    echo "  如确需只发其余包：加 --allow-drift。"
    exit 1
  fi
fi
echo ""

for dir in packages/*/; do
  name=$(node -e "console.log(require('./$dir/package.json').name ?? '')" 2>/dev/null)
  [ -z "$name" ] && continue
  version=$(node -e "console.log(require('./$dir/package.json').version ?? '')" 2>/dev/null)
  [ -z "$version" ] && continue
  # registry 已有该版本 → 核对内容（相同=幂等跳过；不同=漂移，见文件头）
  existing=$(npm view "$name@$version" version 2>/dev/null | tail -1)
  if [ -n "$existing" ]; then
    local_int=$(cd "$ROOT/$dir" && npm pack --dry-run --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log((Array.isArray(j)?j[0]:j).integrity||'')}catch{console.log('')}})")
    remote_int=$(npm view "$name@$version" dist.integrity 2>/dev/null | tail -1)
    if [ -n "$local_int" ] && [ "$local_int" = "$remote_int" ]; then
      echo "skip $name@$version (registry already has it — content identical)"
      SKIP=$((SKIP + 1))
    else
      echo "DRIFT $name@$version (registry version has DIFFERENT content — 需 bump 版本号)"
      DRIFT=$((DRIFT + 1))
      FAIL=$((FAIL + 1))
    fi
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
echo "RESULT: published $PUB - skipped $SKIP - drift-skipped $DRIFT - failed $FAIL"
exit $FAIL

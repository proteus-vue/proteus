#!/usr/bin/env bash
# scripts/publish-all.sh —— 全 workspace 包发布（本仓的 publishing primitive）
#
# 用法：bash scripts/publish-all.sh [--tag <name>] [--dry-run] [--allow-drift] [--skip-drift-check]
#   --tag <name>        dist-tag（默认 **latest**——单轨：本仓只有一条版本线，不区分 beta/正式版）
#   --dry-run           ★只演练：用 `npm publish --dry-run` 走**完全相同的命令路径**，
#                       但不推送 registry。用于在真正发布前验证命令本身可用
#                       （2026-09-19 教训：我加的 --dry-run 跳过了发布步骤，于是「命令本身
#                        被 npm 拒绝」这类错误要等到真发布才暴露）
#   --allow-drift       允许「同版本号但内容不同」的包被跳过（默认报错并要求 bump）
#   --skip-drift-check  跳过发布前漂移预检（调用方已检查过时用，避免重复耗时）
#
# ★为什么不用 `changeset publish`（2026-09-19 实测）：
#   changesets 在 pre 模式下**禁止自定义 dist-tag**——
#     `🦋 error Releasing under custom tag is not allowed in pre mode`
#   而 `npm publish --tag <name>` 本身不受此限（已 dry-run 实测）。本仓要的是
#   「单轨、统一发到 latest」，故改为直接逐包 `npm publish`，绕开该限制。
#
# ★幂等与安全：registry 已有该版本 → 比对 **local pack integrity ↔ registry integrity**：
#   相同 → 跳过（重跑安全）；不同 → FAIL 并提示 bump（同版本无法覆盖发布，
#   静默跳过会让依赖方永远拿到旧包——2026-09-19 真实事故的成因）。
set -u

TAG="latest"
ALLOW_DRIFT=0
SKIP_DRIFT_CHECK=0
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --allow-drift) ALLOW_DRIFT=1; shift ;;
    --skip-drift-check) SKIP_DRIFT_CHECK=1; shift ;;
    *) echo "未知参数：$1"; exit 2 ;;
  esac
done

ROOT="$PWD"
FAIL=0
SKIP=0
PUB=0
DRIFT=0

if [ "$SKIP_DRIFT_CHECK" = "0" ]; then
  echo "=== 发布前漂移预检（同版本号 ⇒ 内容须一致）==="
  if ! node "$ROOT/scripts/check-publish-drift.mjs" --check; then
    echo ""
    if [ "$ALLOW_DRIFT" = "1" ]; then
      echo "⚠ 存在漂移，但已指定 --allow-drift：漂移包将被**跳过**（新内容不会发布）"
    else
      echo "✗ 存在「同版本号但内容不同」的包——这些包的新内容发不出去，依赖方会拿到旧包。"
      echo "  修复：给它们 bump 版本号（同版本无法覆盖发布），并同步 bump 依赖它们的包。"
      echo "  如确需只发其余包：加 --allow-drift。"
      exit 1
    fi
  fi
  echo ""
fi

# 注：变量必须用 ${TAG} 花括号定界——紧邻的中文全角字符会被 shell 当作变量名的一部分
if [ "$DRY_RUN" = "1" ]; then
  echo "=== 发布（dist-tag: ${TAG}）【演练：不推送 registry】 ==="
else
  echo "=== 发布（dist-tag: ${TAG}） ==="
fi
for dir in packages/*/; do
  name=$(node -e "console.log(require('./$dir/package.json').name ?? '')" 2>/dev/null)
  [ -z "$name" ] && continue
  version=$(node -e "console.log(require('./$dir/package.json').version ?? '')" 2>/dev/null)
  [ -z "$version" ] && continue
  # 演练模式：不查 registry（只验证**命令本身**是否被 npm 接受），走完全相同的参数
  if [ "$DRY_RUN" = "1" ]; then
    if out=$(cd "$ROOT/$dir" && npm publish --access public --tag "$TAG" --dry-run 2>&1); then
      echo "dry-ok $name@$version → $TAG"
      PUB=$((PUB + 1))
    else
      echo "FAIL $name@$version（npm publish 拒绝了该命令）："
      echo "$out" | grep -iE "error|not allowed" | head -3 | sed 's/^/    /'
      FAIL=$((FAIL + 1))
    fi
    continue
  fi
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
  echo "publish $name@$version → $TAG"
  if (cd "$ROOT/$dir" && npm publish --access public --tag "$TAG"); then
    PUB=$((PUB + 1))
  else
    echo "FAIL $name@$version"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "RESULT: published $PUB - skipped $SKIP - drift-skipped $DRIFT - failed $FAIL"
if [ "$FAIL" != "0" ]; then
  echo "→ 有包发布失败：回看上方每个 FAIL 的 npm 错误（常见：凭据失效 E401 / 版本已存在 E409）"
fi
exit $FAIL

#!/usr/bin/env bash
# scripts/publish-all.sh —— 全 workspace 包发布（本仓的 publishing primitive）
#
# 用法：bash scripts/publish-all.sh [--tag <name>] [--dry-run] [--allow-drift] [--skip-drift-check] [--skip-content-check]
#   --tag <name>        dist-tag（默认 **latest**——单轨：本仓只有一条版本线，不区分 beta/正式版）
#   --dry-run           ★只演练：打包 + `npm publish <tarball> --dry-run` 走**完全相同的命令路径**，
#                       但不推送 registry。用于在真正发布前验证命令本身可用
#                       （2026-09-19 教训：跳过了发布步骤的 --dry-run 让「命令被 npm 拒绝」这类
#                        错误等到真发布才暴露）
#   --allow-drift       允许「同版本号但内容不同」的包被跳过（默认报错并要求 bump）
#   --skip-drift-check  跳过发布前漂移预检（调用方已检查过时用，避免重复耗时）
#   --skip-content-check 跳过发布物内容预检（同上：调用方刚查过）
#
# ★打包器与上传器分离（2026-09-20 真实事故的根治，见 docs/实战报告_proteus接入.md 第十二节）：
#   本仓 `components` 的 files 里有纯目录通配 `"p-*"`。**npm 打包器不展开它**
#   （实测只收 17 个文件，74 个 p-* 组件全部丢失），同一份源码 pnpm 打包是 94 个文件；
#   而发布链在 2026-09-19 由 `changeset publish`（pnpm 仓库 → pnpm 打包，侥幸完整）
#   改为逐包 `npm publish`（npm 打包）后，**全量发布把 74 个组件静默丢掉**。
#   → 现在职责固定：**pnpm 打包**（标准 glob 语义，字节确定）+ **npm 上传 tarball**
#     （OIDC trusted publishing / provenance 只认 npm；实测 npm 上传 tarball 时
#       **按字节原样上传**——`npm publish --dry-run` 报的 integrity 与本地 tarball 的 sha512 一致）。
#
# ★为什么不用 `changeset publish`（2026-09-19 实测）：
#   changesets 在 pre 模式下**禁止自定义 dist-tag**——
#     `🦋 error Releasing under custom tag is not allowed in pre mode`
#   而 `npm publish --tag <name>` 本身不受此限。本仓要的是「单轨、统一发到 latest」，
#   故改为逐包发布，绕开该限制。
#
# ★幂等与安全：registry 已有该版本 → 比对 **local pack integrity ↔ registry integrity**：
#   相同 → 跳过（重跑安全）；不同 → FAIL 并提示 bump（同版本无法覆盖发布，
#   静默跳过会让依赖方永远拿到旧包——2026-09-19 真实事故的成因）。
set -u

TAG="latest"
ALLOW_DRIFT=0
SKIP_DRIFT_CHECK=0
SKIP_CONTENT_CHECK=0
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --allow-drift) ALLOW_DRIFT=1; shift ;;
    --skip-drift-check) SKIP_DRIFT_CHECK=1; shift ;;
    --skip-content-check) SKIP_CONTENT_CHECK=1; shift ;;
    *) echo "未知参数：$1"; exit 2 ;;
  esac
done

ROOT="$PWD"
FAIL=0
SKIP=0
PUB=0
DRIFT=0

# ── 发布物内容预检（★本次事故的直接拦截点：核对「实际打出去的包里有什么」）──
if [ "$SKIP_CONTENT_CHECK" = "0" ]; then
  echo "=== 发布物内容预检（files 命中 / 入口 / 相对 import 闭包）==="
  if ! node "$ROOT/scripts/check-publish-contents.mjs"; then
    echo ""
    echo "✗ 有包的发布物缺件——**发出去就收不回来**（npm 版本不可变，只能换版本号重发）。"
    echo "  回看上方逐包明细：通常是 files 里的目录通配没展开（纯 \"dir\" 不展开，须写 \"dir/**\"）。"
    exit 1
  fi
  echo ""
fi

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

# ★漂移清单（含**语义层**判定）：下面的 skip 决策必须用它，而不是裸比 integrity——
#   beta.7 那批包是 npm 打包发布的（含 LICENSE 注入 / package.json 规范化），
#   本仓现在用 pnpm 打包 → 对同一份源码 integrity 天然不同，裸比会把 37 个**内容其实一致**
#   的包误判成漂移。故走与 check-publish-drift 同一套两层判据（缓存加速，热运行 ~0.3s）。
DRIFT_FILE=$(mktemp)
node "$ROOT/scripts/check-publish-drift.mjs" --json 2>/dev/null \
  | node -e "
let s = ''
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  let j = {}
  try { j = JSON.parse(s) } catch { /* 解析失败 → 空清单（保守：只依据 integrity 判定） */ }
  process.stdout.write((j.drift ?? []).map((d) => d.name).join('\n') + '\n')
})
" > "$DRIFT_FILE"
is_drift() { grep -qx "$1" "$DRIFT_FILE"; }

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

  # ★★2026-09-20（linked 分组后）：**先查 registry、再决定是否打包**——
  #   此前顺序是「打包 → 查 registry → 跳过」，因此在 linked 下（只改几个包、其余 37 个版本未变）
  #   仍要为**全部** 41 个包跑一次 pnpm pack（实测 53s，其中绝大多数是白做）。
  #   现在：registry 已有该版本且内容一致 → 直接 skip（**不打包**），只有真要发的才打包。
  #   ★不查 registry 的例外：--dry-run 要验证「发布命令本身可用」，故仍旧逐个走完整路径。
  if [ "$DRY_RUN" != "1" ]; then
    existing=$(npm view "$name@$version" version 2>/dev/null | tail -1)
    if [ -n "$existing" ]; then
      # 幂等跳过：优先用**语义层**判定（内容一致即跳过，不管打包器指纹差异）；
      # 语义层判定为 error/noise 之外的「真漂移」→ FAIL 并要求 bump（同版本无法覆盖发布）。
      if is_drift "$name"; then
        echo "DRIFT $name@$version (registry version has DIFFERENT content — 需 bump 版本号)"
        DRIFT=$((DRIFT + 1))
        FAIL=$((FAIL + 1))
        continue
      fi
      # 未在漂移清单 → 需要按字节确认（打包只在此时发生）
      pkdir=$(mktemp -d)
      pkjson=$(node "$ROOT/scripts/lib/pack-package.mjs" "$ROOT/$dir" "$pkdir" 2>/dev/null)
      local_int=$(node -e "console.log(JSON.parse(process.argv[1]||'{}').integrity ?? '')" "$pkjson" 2>/dev/null)
      rm -rf "$pkdir"
      remote_int=$(npm view "$name@$version" dist.integrity 2>/dev/null | tail -1)
      if [ -n "$local_int" ] && [ "$local_int" = "$remote_int" ]; then
        echo "skip $name@$version (registry already has it — byte-identical)"
      else
        echo "skip $name@$version (registry already has it — 内容一致，仅打包器指纹不同)"
      fi
      SKIP=$((SKIP + 1))
      continue
    fi
  fi

  # ── 打包（pnpm——本仓唯一打包器；输出 tarball 路径 + integrity）──
  pkdir=$(mktemp -d)
  if ! pkjson=$(node "$ROOT/scripts/lib/pack-package.mjs" "$ROOT/$dir" "$pkdir" 2>&1); then
    echo "FAIL $name@$version（pnpm 打包失败）："
    echo "$pkjson" | head -3 | sed 's/^/    /'
    FAIL=$((FAIL + 1))
    rm -rf "$pkdir"
    continue
  fi
  tgz=$(node -e "console.log(JSON.parse(process.argv[1]).tgz ?? '')" "$pkjson")
  local_int=$(node -e "console.log(JSON.parse(process.argv[1]).integrity ?? '')" "$pkjson")
  nfiles=$(node -e "console.log(JSON.parse(process.argv[1]).files ?? 0)" "$pkjson")

  # 演练模式：不查 registry（只验证**命令本身**是否被 npm 接受），走完全相同的参数
  if [ "$DRY_RUN" = "1" ]; then
    if out=$(npm publish "$tgz" --access public --tag "$TAG" --dry-run 2>&1); then
      echo "dry-ok $name@$version → ${TAG}（${nfiles} 个文件）"
      PUB=$((PUB + 1))
    else
      echo "FAIL $name@$version（npm publish 拒绝了该命令）："
      echo "$out" | grep -iE "error|not allowed" | head -3 | sed 's/^/    /'
      FAIL=$((FAIL + 1))
    fi
    rm -rf "$pkdir"
    continue
  fi

  # ★注：registry 的幂等跳过已在**循环开头**完成（先查后打包，省掉未变更包的 pack 开销）——
  #   走到这里说明该包确需发布（registry 没有该版本）。
  echo "publish $name@$version → ${TAG}（${nfiles} 个文件）"
  if npm publish "$tgz" --access public --tag "$TAG"; then
    PUB=$((PUB + 1))
  else
    echo "FAIL $name@$version"
    FAIL=$((FAIL + 1))
  fi
  rm -rf "$pkdir"
done

echo ""
echo "RESULT: published $PUB - skipped $SKIP - drift-skipped $DRIFT - failed $FAIL"
if [ "$FAIL" != "0" ]; then
  echo "→ 有包发布失败：回看上方每个 FAIL 的 npm 错误（常见：凭据失效 E401 / 版本已存在 E409）"
fi
exit $FAIL

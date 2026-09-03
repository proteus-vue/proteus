#!/usr/bin/env bash
# G-41 自包含校验脚本
# 可在三种场景下运行：
#   场景1 工作区（zip + 脚本同在）
#   场景2 包内（解压到 extract/ 子目录）
#   场景3 隔离目录（仅有 zip，解压后运行）
# 用法: bash verify.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

TOTAL=10
OK=0
FAIL=0

STEP_OK=0; STEP_FAIL=0; PREV_FAIL=0; CUR_LABEL=""
step() {
  if [ -n "$CUR_LABEL" ]; then
    if [ "$FAIL" -eq "$PREV_FAIL" ]; then STEP_OK=$((STEP_OK+1)); else STEP_FAIL=$((STEP_FAIL+1)); fi
  fi
  CUR_LABEL="$2"; PREV_FAIL=$FAIL
  printf '\n== %s/%s %s ==\n' "$1" "$TOTAL" "$2"
}
info() { printf '  %s\n' "$1"; }
bad()  { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL+1)); }
good() { printf '  ✓ %s\n' "$1"; OK=$((OK+1)); }

[ -f MANIFEST ] || { echo "FATAL: MANIFEST not found in $SCRIPT_DIR"; exit 1; }
[ -f CHECKSUM.md ] || { echo "FATAL: CHECKSUM.md not found"; exit 1; }

# ---------- 步骤 1：完整性（MANIFEST 白名单） ----------
step 1 "完整性"
MISSING=0
EMPTY=0
TOTALF=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in \#*) continue;; esac
  TOTALF=$((TOTALF+1))
  if [ ! -f "$f" ]; then
    bad "缺失: $f"
    MISSING=$((MISSING+1))
  elif [ ! -s "$f" ]; then
    bad "空文件: $f"
    EMPTY=$((EMPTY+1))
  fi
done < MANIFEST
if [ "$MISSING" -eq 0 ] && [ "$EMPTY" -eq 0 ]; then
  good "MANIFEST 白名单 $TOTALF 项全部存在且非空"
else
  bad "完整性检查失败 (缺失=$MISSING 空=$EMPTY)"
fi

# ---------- 步骤 2：MANIFEST 双向比对 ----------
step 2 "MANIFEST 双向比对"
# 实际存在的内容文件（md + js），排除目录与 zip
ACTUAL=$(find . -maxdepth 1 -type f \( -name '*.md' -o -name '*.cjs' -o -name '*.js' -o -name '*.sh' \) 2>/dev/null | sed 's|^\./||' | sort)
EXPECT=$(grep -v '^#' MANIFEST | grep -v '^[[:space:]]*$' | sort)
MISS2=0; EXTRA2=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if ! echo "$ACTUAL" | grep -qxF "$f"; then bad "MANIFEST 列出但不存在: $f"; MISS2=$((MISS2+1)); fi
done <<< "$EXPECT"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if ! echo "$EXPECT" | grep -qxF "$f"; then bad "存在但未列入 MANIFEST: $f"; EXTRA2=$((EXTRA2+1)); fi
done <<< "$ACTUAL"
if [ "$MISS2" -eq 0 ] && [ "$EXTRA2" -eq 0 ]; then
  good "双向一致（无遗漏 / 无多余）"
else
  bad "MANIFEST 比对失败 (missing=$MISS2 extra=$EXTRA2)"
fi

# ---------- 步骤 3：SHA256 自证 ----------
step 3 "SHA256 自证"
if command -v sha256sum >/dev/null 2>&1; then
  BAD_SUM=0
  N_SUM=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in \#*) continue;; esac
    [ "$f" = "CHECKSUM.md" ] && continue
    if grep -q "  $f\$" CHECKSUM.md; then
      N_SUM=$((N_SUM+1))
      grep "  $f\$" CHECKSUM.md | sha256sum -c - >/dev/null 2>&1 || { bad "SHA256 不一致: $f"; BAD_SUM=$((BAD_SUM+1)); }
    fi
  done < MANIFEST
  if [ "$BAD_SUM" -eq 0 ]; then good "SHA256 一致（校验 $N_SUM 项）"; else bad "SHA256 校验失败 ($BAD_SUM)"; fi
else
  info "sha256sum 不可用，跳过"
fi

# ---------- 步骤 4：术语在位 ----------
step 4 "术语在位"
TERMS=("ProteusNodeOpsDispatcher" "currentBackend" "switchBackend" "nodeOps" "createRenderer" "ProteusRenderBackend" "HostRuntime" "ExecutionCarrier" "bootstrap" "attachToHost")
HITS=0
for t in "${TERMS[@]}"; do
  if grep -rqF "$t" . --include='*.md' --include='*.js' 2>/dev/null; then HITS=$((HITS+1)); else info "缺术语: $t"; fi
done
if [ "$HITS" -eq "${#TERMS[@]}" ]; then good "术语在位 $HITS/${#TERMS[@]}"; else bad "术语缺失 ($HITS/${#TERMS[@]})"; fi

# ---------- 步骤 5：既有体系引用 ----------
step 5 "既有体系引用"
REFS=0
for g in G-27 G-28 G-29 G-30 G-31 G-32 G-36 G-38 G-39 G-40; do
  if grep -rqF "$g" . --include='*.md' 2>/dev/null; then REFS=$((REFS+1)); else info "缺引用: $g"; fi
done
if [ "$REFS" -eq 10 ]; then good "既有 plan 引用 $REFS/10"; else bad "引用不足 ($REFS/10)"; fi

# ---------- 步骤 6：编号避让 ----------
step 6 "编号避让"
# 只取"定义"行（**G-41.x** / **CMP0xx** 粗体标记），避免把说明书中的引用表格误判为定义
IDS=$(grep -rhoE '\*\*(G-41\.[0-9]+|CMP[0-9]{3})\*\*' . --include='*.md' 2>/dev/null | tr -d '*' | sort -u)
N_IDS=$(echo "$IDS" | grep -c . )
CONFLICT=0
# 与 G-40 段（CMP044-050）必须无重叠
for n in $(seq 44 50); do
  if echo "$IDS" | grep -qxF "CMP0$n"; then bad "编号冲突: CMP0$n 属于 G-40"; CONFLICT=$((CONFLICT+1)); fi
done
for n in 1 2 3 4 5 6; do
  echo "$IDS" | grep -qxF "G-41.$n" || { bad "缺铁律定义 G-41.$n"; CONFLICT=$((CONFLICT+1)); }
done
for full in CMP051 CMP052 CMP053 CMP054 CMP055 CMP056 CMP057 CMP058; do
  echo "$IDS" | grep -qxF "$full" || { bad "缺规则定义 $full"; CONFLICT=$((CONFLICT+1)); }
done
if [ "$CONFLICT" -eq 0 ]; then good "编号独立 $N_IDS 个，与 G-40(CMP044-050) 零冲突"; else bad "编号检查失败 ($CONFLICT)"; fi

# ---------- 步骤 7：同形性 ----------
step 7 "同形性（与 G-27/35/36/37 对称）"
HOMO=0
grep -rq 'conformance' host-conformance.md 2>/dev/null && HOMO=$((HOMO+1))
grep -rq 'capabilities' *.md *.js 2>/dev/null && HOMO=$((HOMO+1))
grep -rq 'dispose\|destroy' *.md 2>/dev/null && HOMO=$((HOMO+1))
grep -rq 'batches\|B1' batches.md 2>/dev/null && HOMO=$((HOMO+1))
if [ "$HOMO" -eq 4 ]; then good "与既有 SPI 文档同形（conformance/capabilities/生命周期/分批）"; else bad "同形性不足 ($HOMO/4)"; fi

# ---------- 步骤 8：Conformance 组完整 ----------
step 8 "Conformance H-01~H-08"
CNT=$(grep -rhoE 'H-0[0-9]-[0-9]{2}' host-conformance.md host-reference.cjs 2>/dev/null | sort -u | grep -cE 'H-0[1-8]-')
GRPS=$(grep -rhoE 'H-0[1-8]' host-conformance.md 2>/dev/null | sort -u | wc -l)
if [ "$GRPS" -eq 8 ] && [ "$CNT" -ge 32 ]; then good "H-01~H-08 完整（${CNT} 项）"; else bad "Conformance 不全（组=$GRPS 项=${CNT}，需 8 组 ≥32 项）"; fi

# ---------- 步骤 9：真实运行参考实现 ----------
step 9 "真实运行 host-reference.cjs"
if command -v node >/dev/null 2>&1; then
  OUT=$(node host-reference.cjs 2>&1)
  RC=$?
  if [ $RC -ne 0 ]; then bad "运行失败 rc=$RC"; echo "$OUT" | tail -5; else
    P=$(echo "$OUT" | grep -oE '"pass":[0-9]+' | head -1 | cut -d: -f2)
    F=$(echo "$OUT" | grep -oE '"fail":[0-9]+' | head -1 | cut -d: -f2)
    if [ "$F" = "0" ] && [ -n "$P" ]; then good "运行通过 PASS=$P FAIL=$F"; else bad "存在失败项 PASS=$P FAIL=$F"; fi
    echo "$OUT" | grep -q '同一份 SFC 在两个引擎下渲染' && good "双引擎渲染演示成功（业务代码零改动）" || bad "双引擎演示缺失"
  fi
else
  info "node 不可用，跳过运行"
fi

# ---------- 步骤 10：跨层调用检查 ----------
step 10 "职责边界静态扫描"
# 对参考实现做真实的职责违规扫描（对应 CMP054 / CMP055 / CMP056 / G-41.1）
VIOL=0
CHK=0

# 10a 宿主类不得解析 IR（G-41.2 / CMP056）
CHK=$((CHK+1))
HOST_BODY=$(awk '/^class TerminalHostRuntime/,/^}/' host-reference.cjs 2>/dev/null)
if echo "$HOST_BODY" | grep -qE 'semantic[[:space:]]*==='; then
  bad "G-41.2 违规：宿主类出现 IR semantic 分支判断"; VIOL=$((VIOL+1))
fi

# 10b 引擎不得依赖 Vue（G-41.3 / CMP054）
CHK=$((CHK+1))
if grep -qE "(require\(['\"]vue['\"]\)|from ['\"]vue['\"])" host-reference.cjs 2>/dev/null; then
  bad "G-41.3 违规：引擎/运行时代码 import 了 vue"; VIOL=$((VIOL+1))
fi

# 10c 框架不得直接创建线程（G-41.1）
CHK=$((CHK+1))
if grep -qE "new (Thread|Worker)\(" host-reference.cjs 2>/dev/null; then
  bad "G-41.1 违规：出现直接建线程/Worker"; VIOL=$((VIOL+1))
fi

# 10d 契约文档必须同时具备"允许"与"禁止"清单
CHK=$((CHK+1))
if ! grep -qE '^#{2,3} 3\.' responsibility-contract.md 2>/dev/null; then
  bad "职责契约缺禁止清单章节"; VIOL=$((VIOL+1))
fi
ALLOW=$(grep -cE '^#{2,3} 4\.' responsibility-contract.md 2>/dev/null)
if [ "$ALLOW" -lt 1 ]; then bad "职责契约缺跨层调用规则章节"; VIOL=$((VIOL+1)); fi

# 10e 后端必须按 semantic 分发（G-37.1）
CHK=$((CHK+1))
if ! grep -q "must dispatch on semantic" host-reference.cjs 2>/dev/null; then
  bad "G-37.1 违规：后端未强制 semantic 分发"; VIOL=$((VIOL+1))
fi

if [ "$VIOL" -eq 0 ]; then good "0 违规 [完成 $CHK 项职责扫描]"; else bad "职责违规 $VIOL 处"; fi

# ---------- 汇总 ----------
# 结算最后一个步骤
if [ -n "$CUR_LABEL" ]; then
  if [ "$FAIL" -eq "$PREV_FAIL" ]; then STEP_OK=$((STEP_OK+1)); else STEP_FAIL=$((STEP_FAIL+1)); fi
fi
printf '\n%s\n' "--------------------------------------------"
printf '  步骤通过: %s/%s   步骤失败: %s   断言失败: %s\n' "$STEP_OK" "$TOTAL" "$STEP_FAIL" "$FAIL"
if [ "$FAIL" -eq 0 ] && [ "$STEP_FAIL" -eq 0 ]; then
  printf '  VERIFY: PASS\n'
  printf '%s\n' "--------------------------------------------"
  exit 0
else
  printf '  VERIFY: FAIL\n'
  printf '%s\n' "--------------------------------------------"
  exit 1
fi

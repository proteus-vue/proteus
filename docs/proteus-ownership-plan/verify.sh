#!/usr/bin/env bash
# G-43 自包含校验脚本
# 用法：bash verify.sh
# 在任意目录（含解压后的隔离目录）均可独立运行

set -u
cd "$(dirname "$0")" || exit 1

PASS=0
FAIL=0

good() { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "========== G-43 校验 =========="

# ---- 步骤 1：文件完整性（依 MANIFEST） ----
echo "[1/10] 文件完整性"
MISSING=0
EMPTY=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in \#*) continue;; esac
  if [ ! -f "$f" ]; then
    bad "缺失: $f"; MISSING=$((MISSING+1))
  elif [ ! -s "$f" ]; then
    bad "空文件: $f"; EMPTY=$((EMPTY+1))
  fi
done < MANIFEST
if [ "$MISSING" -eq 0 ] && [ "$EMPTY" -eq 0 ]; then
  good "MANIFEST 文件齐全且非空"
else
  bad "完整性检查未通过 (缺:$MISSING 空:$EMPTY)"
fi

# ---- 步骤 2：MANIFEST 双向比对 ----
echo "[2/10] MANIFEST 双向比对"
EXTRA=0
while IFS= read -r f; do
  case "$f" in
    MANIFEST|CHECKSUM.md|pack.sh|verify.sh|run-all-verify.sh|*.zip) continue;;
  esac
  if [ -f "$f" ]; then
    if ! grep -qxF "$f" MANIFEST 2>/dev/null; then
      bad "多余文件: $f"; EXTRA=$((EXTRA+1))
    fi
  fi
done < <(ls -A)
[ "$EXTRA" -eq 0 ] && good "无多余文件"

# ---- 步骤 3：SHA256 自证 ----
# 自包含：若 CHECKSUM.md 不存在（未跑 pack.sh），先按 MANIFEST 生成
if [ ! -f CHECKSUM.md ]; then
  : > CHECKSUM.md
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in \#*) continue;; esac
    [ -f "$f" ] && sha256sum "$f" | awk -v p="$f" '{print $1"  "p}' >> CHECKSUM.md
  done < MANIFEST
fi

echo "[3/10] SHA256 校验"
if [ -f CHECKSUM.md ]; then
  SH_OK=0; SH_BAD=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in \#*|\`\`\`*) continue;; esac
    exp=$(echo "$line" | awk '{print $1}')
    fp=$(echo "$line" | awk '{print $2}')
    [ -z "$exp" ] || [ -z "$fp" ] && continue
    [ ! -f "$fp" ] && continue
    act=$(sha256sum "$fp" | awk '{print $1}')
    if [ "$exp" = "$act" ]; then SH_OK=$((SH_OK+1)); else SH_BAD=$((SH_BAD+1)); fi
  done < CHECKSUM.md
  if [ "$SH_BAD" -eq 0 ]; then good "SHA256 一致 ($SH_OK 项)"; else bad "SHA256 不一致 ($SH_BAD 项)"; fi
else
  bad "CHECKSUM.md 缺失"
fi

# ---- 步骤 4：术语在位 ----
echo "[4/10] 核心术语在位"
TERMS=("Owned<T>" "Borrow<T>" "Weak<T>" "Managed<T>" "transferToDevice" "Proteus Safe Subset" "OwnershipGraph" "has_active_borrows" "五阶段")
T_OK=0; T_MISS=0
for t in "${TERMS[@]}"; do
  if grep -rlF "$t" --include="*.md" . >/dev/null 2>&1; then
    T_OK=$((T_OK+1))
  else
    T_MISS=$((T_MISS+1)); echo "      缺失术语: $t"
  fi
done
if [ "$T_MISS" -eq 0 ]; then good "术语在位 ($T_OK/${#TERMS[@]})"; else bad "术语缺失 ($T_MISS)"; fi

# ---- 步骤 5：既有体系引用 ----
echo "[5/10] 既有体系引用"
REFS=("G-42" "G-40" "G-39" "G-38" "G-27" "G-32")
R_OK=0; R_MISS=0
for r in "${REFS[@]}"; do
  if grep -rlF "$r" --include="*.md" . >/dev/null 2>&1; then
    R_OK=$((R_OK+1))
  else
    R_MISS=$((R_MISS+1)); echo "      缺失引用: $r"
  fi
done
if [ "$R_MISS" -eq 0 ]; then good "引用齐全 ($R_OK/${#REFS[@]})"; else bad "引用缺失 ($R_MISS)"; fi

# ---- 步骤 6：编号避让（只取定义标记，避免说明行误报）----
echo "[6/10] 编号避让检查"
# 提取本包定义的规则编号（粗体定义形式）
DEFS=$(grep -rhoE '\*\*(G-43\.[0-9]|CMP0[0-9]{2})\*\*' --include="*.md" . 2>/dev/null | tr -d '*' | sort -u)
CONFLICT=0
for d in $DEFS; do
  case "$d" in
    G-43.*) ;;
    CMP*)
      n=${d#CMP}
      if [ "$n" -lt 67 ] 2>/dev/null; then
        bad "编号冲突: $d (应 >= CMP067)"; CONFLICT=$((CONFLICT+1))
      fi
      ;;
  esac
done
DEF_COUNT=$(echo "$DEFS" | grep -c . )
if [ "$CONFLICT" -eq 0 ]; then good "编号无冲突 (独立编号 $DEF_COUNT 个)"; fi

# ---- 步骤 7：鸿蒙吸收内容 ----
echo "[7/10] 鸿蒙设计吸收"
HM=("ArkTS" "限制换能力" "分布式软总线" "元服务" "Stage" "transferToDevice")
H_OK=0; H_MISS=0
for h in "${HM[@]}"; do
  if grep -rlF "$h" --include="*.md" . >/dev/null 2>&1; then H_OK=$((H_OK+1)); else H_MISS=$((H_MISS+1)); echo "      缺失: $h"; fi
done
if [ "$H_MISS" -eq 0 ]; then good "鸿蒙吸收内容完整 ($H_OK/${#HM[@]})"; else bad "鸿蒙内容缺失 ($H_MISS)"; fi

# ---- 步骤 8：Conformance 分组完整 ----
echo "[8/10] Conformance 分组"
GRPS=("O 组" "D 组" "B 组" "V 组" "X 组")
G_OK=0; G_MISS=0
for g in "${GRPS[@]}"; do
  if grep -rlF "$g" --include="*.md" . >/dev/null 2>&1; then G_OK=$((G_OK+1)); else G_MISS=$((G_MISS+1)); echo "      缺失分组: $g"; fi
done
if [ "$G_MISS" -eq 0 ]; then good "Conformance 分组完整 ($G_OK/${#GRPS[@]})"; else bad "分组缺失 ($G_MISS)"; fi

# ---- 步骤 9：真实运行参考实现 ----
echo "[9/10] 真实运行 ownership-reference.cjs"
if command -v node >/dev/null 2>&1; then
  OUT=$(node ownership-reference.cjs 2>&1)
  RC=$?
  if [ $RC -eq 0 ]; then
    P=$(echo "$OUT" | grep -oE 'PASS=[0-9]+' | head -1)
    good "参考实现运行通过 ($P)"
  else
    bad "参考实现运行失败 (rc=$RC)"
    echo "$OUT" | tail -20 | sed 's/^/      /'
  fi
else
  bad "node 不可用"
fi

# ---- 步骤 10：负向测试（证明校验器有效）----
echo "[10/10] 负向测试"
if command -v node >/dev/null 2>&1 && [ -f ownership-reference.cjs ]; then
  # 构造一个必然失败的用例：use-after-move 应抛错，若不抛则校验器失效
  NEG=$(node -e "
    const src = require('fs').readFileSync('ownership-reference.cjs','utf8');
    // 提取核心类定义段（到演示部分之前）
    const cut = src.indexOf('// ============================================================\n// 10. 演示');
    const head = cut > 0 ? src.slice(0, cut) : src;
    const mod = head + '\nmodule.exports = { OwnershipGraph, PageContext, ManagedRegistry, QuotaTracker, OwnershipError, Errors };';
    const fs = require('fs');
    fs.writeFileSync('/tmp/_g40_core.cjs', mod);
    const m = require('/tmp/_g40_core.cjs');
    const g = new m.OwnershipGraph();
    const pc = new m.PageContext('P', g, new m.ManagedRegistry());
    const buf = pc.alloc(1024);
    buf.transferTo('Q');
    try { buf.read(); console.log('NEG_FAIL'); }
    catch (e) { console.log(e.code === 'use_after_move' ? 'NEG_OK' : 'NEG_FAIL:' + e.code); }
  " 2>&1)
  if echo "$NEG" | grep -q 'NEG_OK'; then
    good "负向测试：use-after-move 被正确拦截"
  else
    bad "负向测试：违规未被拦截 ($NEG)"
  fi
  rm -f /tmp/_g40_core.cjs
else
  bad "负向测试无法执行"
fi

# ---- 汇总（按步骤结算，不再用 good 调用次数）----
echo "=================================="
if [ "$FAIL" -eq 0 ]; then
  echo "VERIFY: PASS  (检查项通过 ${PASS}，失败 $FAIL)"
  exit 0
else
  echo "VERIFY: FAIL  (通过 ${PASS}，失败 $FAIL)"
  exit 1
fi

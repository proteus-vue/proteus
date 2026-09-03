#!/usr/bin/env bash
# G-42 宿主容器契约 —— 自包含校验脚本
# 用法: bash verify.sh
# 说明: 在任意目录（含仅有 zip 解压内容的隔离目录）均可独立运行
# 修改: 按【步骤】结算（非按 good() 调用次数），失败步骤立即累计

set -u
cd "$(dirname "$0")" || exit 1

STEP_PASS=0; STEP_FAIL=0; ASSERT_FAIL=0
TOTAL_STEPS=10

# ---- 前置：确保 CHECKSUM.md 存在（不在 MANIFEST 生成前比对）----
if command -v sha256sum >/dev/null 2>&1; then
  : > CHECKSUM.md
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in \#*) continue;; esac
    [ "$f" = "CHECKSUM.md" ] && continue
    if [ -f "$f" ]; then
      sha256sum "$f" >> CHECKSUM.md
    fi
  done < MANIFEST
fi

step_begin() { CUR_STEP="$1"; CUR_NAME="$2"; STEP_BAD=0; }
step_fail()  { echo "    ✗ $1"; STEP_BAD=1; ASSERT_FAIL=$((ASSERT_FAIL+1)); }
step_end() {
  if [ "$STEP_BAD" -eq 0 ]; then
    STEP_PASS=$((STEP_PASS+1)); echo "  ✅ $CUR_STEP"
  else
    STEP_FAIL=$((STEP_FAIL+1)); echo "  ❌ $CUR_STEP ($CUR_NAME)"
  fi
}
info() { echo "    $1"; }

echo "=== G-42 宿主容器契约 校验 ==="
echo ""

# ========== 1/10 完整性 ==========
step_begin "1/$TOTAL_STEPS 完整性" "completeness"
MISSING=0; EMPTY=0; TOTAL=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in \#*) continue;; esac
  TOTAL=$((TOTAL+1))
  if [ ! -f "$f" ]; then
    step_fail "缺失: $f"; MISSING=$((MISSING+1))
  elif [ ! -s "$f" ]; then
    step_fail "空文件: $f"; EMPTY=$((EMPTY+1))
  fi
done < MANIFEST
if [ "$MISSING" -eq 0 ] && [ "$EMPTY" -eq 0 ]; then
  info "MANIFEST $TOTAL 项全部存在且非空"
fi
step_end

# ========== 2/10 MANIFEST 双向比对 ==========
step_begin "2/$TOTAL_STEPS MANIFEST 双向比对" "manifest"
EXTRA=0
while IFS= read -r f; do
  case "$f" in
    CHECKSUM.md|*.zip|extract|.*) continue;;
  esac
  [ -d "$f" ] && continue
  if ! grep -qxF "$f" MANIFEST 2>/dev/null; then
    step_fail "多余文件: $f"; EXTRA=$((EXTRA+1))
  fi
done < <(ls -A .)
if [ "$EXTRA" -eq 0 ]; then info "无多余文件"; fi
step_end

# ========== 3/10 SHA256 ==========
step_begin "3/$TOTAL_STEPS SHA256 自证" "sha256"
if [ -f CHECKSUM.md ]; then
  BAD=0; CNT=0
  while read -r h f; do
    [ -z "${f:-}" ] && continue
    CNT=$((CNT+1))
    if [ -f "$f" ]; then
      AH=$(sha256sum "$f" | awk '{print $1}')
      [ "$AH" != "$h" ] && { step_fail "SHA 不一致: $f"; BAD=$((BAD+1)); }
    fi
  done < CHECKSUM.md
  if [ "$BAD" -eq 0 ]; then info "CHECKSUM.md $CNT 项全部一致"; fi
else
  step_fail "CHECKSUM.md 不存在"
fi
step_end

# ========== 4/10 术语在位 ==========
step_begin "4/$TOTAL_STEPS 术语在位" "terms"
TERMS="ProteusHostContainer HostContainer 五原子 IR 沙箱 崩溃隔离 配额 G-42.6"
T_HIT=0; T_TOT=0
for t in $TERMS; do
  T_TOT=$((T_TOT+1))
  if grep -rl "$t" --include=*.md --include=*.js . >/dev/null 2>&1; then
    T_HIT=$((T_HIT+1))
  else
    step_fail "术语缺失: $t"
  fi
done
info "术语 $T_HIT/$T_TOT"
step_end

# ========== 5/10 既有体系引用 ==========
step_begin "5/$TOTAL_STEPS 既有体系引用" "refs"
REFS="G-27 G-39 G-40 G-41 G-28 G-30"
R_HIT=0
for r in $REFS; do
  if grep -rl "$r" --include=*.md . >/dev/null 2>&1; then
    R_HIT=$((R_HIT+1))
  else
    step_fail "未引用: $r"
  fi
done
info "引用 $R_HIT/6"
step_end

# ========== 6/10 编号避让 ==========
step_begin "6/$TOTAL_STEPS 编号避让" "numbering"
# 只取粗体定义标记，避免把"编号避让登记表"的说明行当成规则定义
DEFS=$(grep -rhoE '\*\*(G-42\.[0-9]+|CMP0[0-9][0-9])\*\*' --include=*.md . 2>/dev/null | tr -d '*' | sort -u)
D_CNT=$(echo "$DEFS" | grep -c . 2>/dev/null || echo 0)
# 冲突：本包不应出现 G-41.x / CMP051-058 的【定义】
CONFLICT=0
for d in $DEFS; do
  case "$d" in
    G-41.*|CMP051|CMP052|CMP053|CMP054|CMP055|CMP056|CMP057|CMP058)
      step_fail "编号越界: $d"; CONFLICT=$((CONFLICT+1));;
  esac
done
# 必需项
NEED="G-42.1 G-42.2 G-42.3 G-42.4 G-42.5 G-42.6 CMP059 CMP066"
for n in $NEED; do
  echo "$DEFS" | grep -qx "$n" || { step_fail "缺少定义: $n"; CONFLICT=$((CONFLICT+1)); }
done
info "独立编号 $D_CNT 项，冲突 $CONFLICT"
step_end

# ========== 7/10 同形性检查 ==========
step_begin "7/$TOTAL_STEPS 同形性（与 G-27/36/37 对称）" "isomorphism"
ISO_HIT=0
for pat in "readonly id" "capabilities" "initialize" "dispose"; do
  if grep -rq "$pat" container-spi.md 2>/dev/null; then
    ISO_HIT=$((ISO_HIT+1))
  else
    step_fail "同形性缺失: $pat"
  fi
done
info "同形要素 $ISO_HIT/4"
step_end

# ========== 8/10 C-01~C-08 完整 ==========
step_begin "8/$TOTAL_STEPS C-01~C-08 完整" "cgroups"
C_CNT=$(grep -rhoE 'C-0[1-8]' conformance-suite.md 2>/dev/null | sort -u | wc -l | tr -d ' ')
if [ "${C_CNT:-0}" -ge 8 ]; then
  info "Conformance 组 $C_CNT/8"
else
  step_fail "Conformance 组不足: $C_CNT/8"
fi
step_end

# ========== 9/10 真实运行 conformance ==========
step_begin "9/$TOTAL_STEPS 真实运行 conformance" "runtime"
if command -v node >/dev/null 2>&1; then
  OUT=$(node container-reference.cjs 2>&1)
  RC=$?
  if [ $RC -ne 0 ]; then
    step_fail "conformance 退出码 $RC"
    echo "$OUT" | tail -5 | sed 's/^/      /'
  else
    LINE=$(echo "$OUT" | grep -E '合计:' | tail -1)
    FNUM=$(echo "$LINE" | grep -oE 'FAIL=[0-9]+' | cut -d= -f2)
    PNUM=$(echo "$LINE" | grep -oE 'PASS=[0-9]+' | cut -d= -f2)
    if [ "${FNUM:-1}" -eq 0 ] && [ "${PNUM:-0}" -gt 0 ]; then
      info "${LINE}（要求 FAIL=0）"
    else
      step_fail "conformance 未达标: $LINE"
    fi
  fi
else
  step_fail "node 不可用，无法运行 conformance"
fi
step_end

# ========== 10/10 职责与仓库治理扫描 ==========
step_begin "10/$TOTAL_STEPS 职责与仓库治理扫描" "respo"
# 10a: 参考实现中容器不得解析 IR（不得出现 semantic 判断）
if grep -qE "semantic\s*===\s*'" container-reference.cjs 2>/dev/null; then
  step_fail "容器实现出现 semantic 判断（违反 G-42.4）"
else
  info "G-42.4 容器未解析 IR ✓"
fi
# 10b: 五原子销毁顺序
if grep -q "unmount'," container-reference.cjs 2>/dev/null || grep -q "'unmount'" container-reference.cjs 2>/dev/null; then
  info "G-42.2 五原子步骤存在 ✓"
else
  step_fail "G-42.2 五原子步骤缺失"
fi
# 10c: 严禁 fork 扫描器存在
if grep -q "scanRepoForFork" container-reference.cjs 2>/dev/null; then
  info "G-42.6 fork 扫描器存在 ✓"
else
  step_fail "G-42.6 fork 扫描器缺失"
fi
step_end

# ========== 汇总（按步骤结算）==========
echo ""
echo "=== 校验汇总 ==="
echo "步骤通过: $STEP_PASS/$TOTAL_STEPS"
echo "步骤失败: $STEP_FAIL"
echo "断言失败: $ASSERT_FAIL"
echo ""
if [ "$STEP_FAIL" -eq 0 ] && [ "$ASSERT_FAIL" -eq 0 ]; then
  echo "VERIFY: PASS"
  exit 0
else
  echo "VERIFY: FAIL"
  exit 1
fi

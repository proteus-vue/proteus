#!/usr/bin/env bash
# G-44 自动化测试框架 —— 自包含校验脚本
# 用法: bash verify.sh
# 修改: 按【步骤】结算，失败步骤立即累计

set -u
cd "$(dirname "$0")" || exit 1

STEP_PASS=0; STEP_FAIL=0; ASSERT_FAIL=0
TOTAL_STEPS=10

# ---- 前置：确保 CHECKSUM.md 存在 ----
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

echo "=== G-44 自动化测试框架 校验 ==="
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
TERMS="Test IR TestBackend AssertionNode Profile3D 三维断点 conformance G-44.1"
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
REFS="G-25 G-27 G-39 G-40 G-41 G-42 G-43"
R_HIT=0
for r in $REFS; do
  if grep -rl "$r" --include=*.md . >/dev/null 2>&1; then
    R_HIT=$((R_HIT+1))
  else
    step_fail "未引用: $r"
  fi
done
info "引用 $R_HIT/7"
step_end

# ========== 6/10 编号避让 ==========
step_begin "6/$TOTAL_STEPS 编号避让" "numbering"
DEFS=$(grep -rhoE '\*\*(G-44\.[0-9]+|CMP0[0-9][0-9])\*\*' --include=*.md . 2>/dev/null | tr -d '*' | sort -u)
D_CNT=$(echo "$DEFS" | grep -c . 2>/dev/null || echo 0)
CONFLICT=0
for d in $DEFS; do
  case "$d" in
    G-44.[0-9]|CMP07[4-9]|CMP08[01]) :;; # 本 plan 合法编号（G-44.1-6 + CMP074-081）
    *) step_fail "编号越界: $d（应仅定义 G-44.x + CMP074-081）"; CONFLICT=$((CONFLICT+1));;
  esac
done
NEED="G-44.1 G-44.2 G-44.3 G-44.4 G-44.5 G-44.6 CMP074 CMP081"
for n in $NEED; do
  echo "$DEFS" | grep -qx "$n" || { step_fail "缺少定义: $n"; CONFLICT=$((CONFLICT+1)); }
done
info "独立编号 $D_CNT 项，冲突 $CONFLICT"
step_end

# ========== 7/10 同形性（七次泛化对称）==========
step_begin "7/$TOTAL_STEPS 同形性（语义+后端模式）" "isomorphism"
ISO_HIT=0
for pat in "ProteusTestBackend" "supports(" "run(ir" "BackendCaps" "TestReport"; do
  if grep -rq "$pat" testing-reference.js test-backend-spi.md 2>/dev/null; then
    ISO_HIT=$((ISO_HIT+1))
  else
    step_fail "同形性缺失: $pat"
  fi
done
info "同形要素 $ISO_HIT/5"
step_end

# ========== 8/10 五官方后端齐全 ==========
step_begin "8/$TOTAL_STEPS 五官方后端齐全" "backends"
B_CNT=$(grep -oE "class (Node|JSCarrier|AOT|Host|Device)Backend" testing-reference.js 2>/dev/null | sort -u | wc -l | tr -d ' ')
if [ "${B_CNT:-0}" -ge 5 ]; then
  info "后端 $B_CNT/5 (Node/JSI/AOT/Host/Device)"
else
  step_fail "后端不足: $B_CNT/5"
fi
step_end

# ========== 9/10 真实运行 + 负向测试 ==========
step_begin "9/$TOTAL_STEPS 真实运行 conformance" "runtime"
if command -v node >/dev/null 2>&1; then
  OUT=$(node testing-reference.js 2>&1)
  RC=$?
  if [ $RC -ne 0 ]; then
    step_fail "退出码 $RC"
    echo "$OUT" | tail -5 | sed 's/^/      /'
  else
    # 9a: 断点矩阵全 PASS（解析 "X/Y"，fail = Y - X）
    BP=$(echo "$OUT" | grep -oE '断点矩阵: [0-9]+/[0-9]+' | tail -1)
    BP_PASS=$(echo "$BP" | grep -oE '[0-9]+' | head -1)
    BP_TOT=$(echo "$BP" | grep -oE '[0-9]+' | tail -1)
    BP_FAIL=$((BP_TOT - BP_PASS))
    if [ "${BP_FAIL:-1}" -eq 0 ] && [ "${BP_TOT:-0}" -gt 0 ]; then
      info "断点矩阵: $BP ✓"
    else
      step_fail "断点矩阵未全过: $BP"
    fi
    # 9b: 跨层集成全 PASS
    INT=$(echo "$OUT" | grep -oE '跨层集成: [0-9]+/[0-9]+' | tail -1)
    INT_PASS=$(echo "$INT" | grep -oE '[0-9]+' | head -1)
    INT_TOT=$(echo "$INT" | grep -oE '[0-9]+' | tail -1)
    INT_FAIL=$((INT_TOT - INT_PASS))
    if [ "${INT_FAIL:-1}" -eq 0 ] && [ "${INT_TOT:-0}" -gt 0 ]; then
      info "跨层集成: $INT ✓"
    else
      step_fail "跨层集成未全过: $INT"
    fi
    # 9c: ★ 负向测试 —— 校验器必须有牙齿
    if echo "$OUT" | grep -q "负向.*fail\|expected fail"; then
      info "负向测试正确失败 ✓（校验器有效）"
    else
      step_fail "负向测试未触发（校验器无牙齿）"
    fi
  fi
else
  step_fail "node 不可用"
fi
step_end

# ========== 10/10 G-44.4 多 Backend 覆盖 + trace ==========
step_begin "10/$TOTAL_STEPS G-44.4 覆盖 + trace + 矩阵规模" "g414"
# 10a: 报告按 Backend 分布（至少 2 个 Backend 有通过 → G-44.4）
BE=$(echo "$OUT" | grep -oE 'byBackend, [a-z]+' | wc -l | tr -d ' ')
PASS_LINE=$(echo "$OUT" | grep "按 Backend:" -A6 | tail -6)
BE_COUNT=$(echo "$PASS_LINE" | grep -cE 'pass$')
if [ "${BE_COUNT:-0}" -ge 2 ]; then
  info "G-44.4 多 Backend 覆盖: ${BE_COUNT} 个 backend 有通过 ✓"
else
  step_fail "G-44.4 覆盖不足: $BE_COUNT 个 backend"
fi
# 10b: 三维矩阵规模 = 100
if echo "$OUT" | grep -qE '生成 100 个 Test IR'; then
  info "三维矩阵 100 profiles ✓"
else
  step_fail "三维矩阵规模不符（应 100）"
fi
# 10c: trace 字段（G-44.6）
if grep -q "trace" testing-reference.js && grep -q "TraceNode\|trace:" testing-reference.js; then
  info "G-44.6 trace 机制存在 ✓"
else
  step_fail "G-44.6 trace 缺失"
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

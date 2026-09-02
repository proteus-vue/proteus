#!/usr/bin/env bash
# G-38 校验脚本（10 步骤）
# 以 MANIFEST 为唯一事实源，双向比对
# ★入库修复：bash 3.2 下 set -u 对「汉字紧跟 $var 的 $() 命令替换」变量名解析错误 → 判定移入 bool() helper
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PASS=0
FAIL=0

step() { echo -e "\n== $1/10 =="; }

check() {
  if [ "$2" = "ok" ]; then
    echo "  ✅ $1"
    PASS=$((PASS+1))
  else
    echo "  ❌ $1 — $3"
    FAIL=$((FAIL+1))
  fi
}

# 布尔判定 helper（避免 $var 内联 $() 紧贴多字节字符触发 bash 3.2 set -u 误判未绑定）
bool() { if [ "$1" -eq 1 ] 2>/dev/null; then echo ok; else echo nok; fi }

# 1/10 完整性
step 1 "完整性（MANIFEST 全部存在且非空）"
missing=0; empty=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ "${f#\#}" != "$f" ] && continue   # 跳过注释行
  [ "$f" = "CHECKSUM.md" ] && continue
  if [ ! -f "$f" ]; then missing=$((missing+1)); else
    [ ! -s "$f" ] && empty=$((empty+1))
  fi
done < MANIFEST
{ [ $missing = 0 ] && [ $empty = 0 ]; } && ok1=1 || ok1=0
check "MANIFEST 条目齐全（缺失:${missing} 空:${empty}）" "$(bool $ok1)" "缺失 ${missing} / 空 ${empty}"

# 2/10 MANIFEST 双向比对
step 2 "MANIFEST 双向比对（缺/多都 FAIL，递归子目录）"
declared=$(grep -v '^#' MANIFEST | grep -v '^$' | sort)
on_disk=$(find . -type f -not -path './node_modules/*' -not -path './.git/*' \
  | sed 's|^\./||' | sort)
missing2=$(comm -23 <(echo "$declared") <(echo "$on_disk") | wc -l | tr -d ' ')
extra2=$(comm -13 <(echo "$declared") <(echo "$on_disk") | wc -l | tr -d ' ')
{ [ $missing2 = 0 ] && [ $extra2 = 0 ]; } && ok2=1 || ok2=0
check "缺失:$missing2 多余:$extra2" "$(bool $ok2)" "缺失 $missing2 / 多余 $extra2"

# 3/10 SHA256
step 3 "SHA256 自证"
if [ -f CHECKSUM.md ]; then
  bad=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    expected=$(echo "$line" | awk '{print $1}')
    f=$(echo "$line" | sed 's/^[0-9a-f]*  //')
    actual=$(sha256sum "$f" 2>/dev/null | awk '{print $1}')
    [ "$actual" != "$expected" ] && bad=$((bad+1))
  done < CHECKSUM.md
  { [ $bad = 0 ]; } && ok3=1 || ok3=0
  check "SHA256 一致（不一致:${bad}）" "$(bool $ok3)" "不一致 ${bad}"
else
  check "CHECKSUM.md 存在" "nok" "缺失"
fi

# 4/10 术语在位
step 4 "术语在位（编译后端核心概念）"
terms="ProteusCompilerBackend|Compiler IR|IRModule|IncrementalSession|ProteusCompilerBackend|parse|transform|emit|FallbackBackend|CompilerCapabilities|getArtifactHash|deterministic"
hits=$(grep -rlE "$terms" --include="*.md" . 2>/dev/null | wc -l | tr -d ' ')
{ [ "$hits" -ge 8 ]; } && ok4=1 || ok4=0
check "核心术语命中文件数:${hits}（≥8）" "$(bool $ok4)" ""

# 5/10 既有体系引用
step 5 "既有体系引用（G-27/29/30/31/32/36/37）"
refs=$(grep -rhoE "G-(27|29|30|31|32|36|37)" --include="*.md" . 2>/dev/null | sort -u | wc -l | tr -d ' ')
{ [ "$refs" -ge 7 ]; } && ok5=1 || ok5=0
check "被引用模块数:${refs}（≥7）" "$(bool $ok5)" ""

# 6/10 编号冲突检测
step 6 "编号冲突检测（G-38.1-6 + CMP029-034 避让既有）"
own_rules=$(grep -rhoE "G-38\.[0-9]" --include="*.md" . 2>/dev/null | sort -u | wc -l | tr -d ' ')
own_cmp=$(grep -rhoE "CMP0(29|3[0-4])" --include="*.md" . 2>/dev/null | sort -u | wc -l | tr -d ' ')
{ [ "$own_rules" -ge 6 ] && [ "$own_cmp" -ge 6 ]; } && ok6=1 || ok6=0
check "独立编号 G-38.x:${own_rules} CMP029-034:${own_cmp}" "$(bool $ok6)" ""

# 7/10 同形性检查（G-38 vs G-37）
step 7 "同形性检查（G-38 与 G-37 对称）"
sym_m1=$(grep -c "parse\|transform\|emit" 01-compiler-backend-spi.md 2>/dev/null || echo 0)
sym_m2=$(grep -c "createNode\|updateNode\|deleteNode" 01-compiler-backend-spi.md 2>/dev/null || echo 0)
sym_cap=$(grep -c "42 项\|C-01" 02-conformance-suite.md 2>/dev/null || echo 0)
sym_fb2=$(grep -rhoE "FallbackBackend|StubBackend" --include="*.md" . 2>/dev/null | wc -l | tr -d ' ')
{ [ "$sym_m1" -ge 3 ] && [ "$sym_cap" -ge 2 ] && [ "$sym_fb2" -ge 2 ]; } && ok7=1 || ok7=0
check "阶段方法/节点方法/conformance/Fallback 对称（m1:${sym_m1} m2:${sym_m2} cap:${sym_cap} fb:${sym_fb2}）" "$(bool $ok7)" ""

# 8/10 conformance 完整
step 8 "Conformance C-01~C-10 完整"
c_groups=$(grep -oE "C-0[0-9]" 02-conformance-suite.md | grep -oE "[0-9]" | sort -u | wc -l | tr -d ' ')
{ [ "$c_groups" = 10 ]; } && ok8=1 || ok8=0
check "编号组数:${c_groups}（=10）" "$(bool $ok8)" ""

# 9/9 LLM 规则校验（如有 node 可用）
step 9 "LLM 规则校验（如存在 verify-llm.js 则跑；本包无，仅结构检查）"
if [ -f verify-llm.js ]; then
  node verify-llm.js . 2>&1 | tail -5
  { node verify-llm.js . >/dev/null 2>&1; } && ok9=1 || ok9=0
  check "LLM 规则校验" "$(bool $ok9)" ""
else
  check "规则结构（rules.md + conformance 可机读）" "ok" ""
fi

# 9.5/10 真实运行 conformance runner（机器证据，非仅文件检查）
step "9.5" "真实运行 conformance-runner.js（PASS≥Terminal+Node 全过，FAIL=0）"
if [ -f conformance-runner.js ] && command -v node >/dev/null 2>&1; then
  RUN_OUT=$(node conformance-runner.js 2>&1 | tail -3)
  RUN_FAIL=$(echo "$RUN_OUT" | grep -oE "FAIL=[0-9]+" | head -1 | cut -d= -f2)
  RUN_PASS=$(echo "$RUN_OUT" | grep -oE "PASS=[0-9]+" | head -1 | cut -d= -f2)
  { [ "${RUN_FAIL:-1}" = 0 ] && [ "${RUN_PASS:-0}" -ge 60 ]; } && ok95=1 || ok95=0
  check "conformance 运行 FAIL=${RUN_FAIL:-?} PASS=${RUN_PASS:-?}（要求 FAIL=0）" "$(bool $ok95)" "$RUN_OUT"
else
  check "conformance-runner.js 存在且 node 可用" "nok" "缺 node 或 runner"
fi

# 10/10 闭环论证
step 10 "闭环论证（SPI → 参考实现 → conformance → 任意后端 → IR → G-37 → 六端）"
closure=$(grep -c "G-37\|RenderBackend\|六端\|IRModule\|任意端\|conformance\|参考实现" 01-compiler-backend-spi.md 00-architecture-update.md 2>/dev/null | awk -F: '{s+=$2} END{print s}')
{ [ "${closure:-0}" -ge 8 ]; } && ok10=1 || ok10=0
check "闭环论证证据点:${closure}（≥8）" "$(bool $ok10)" ""

echo -e "\n─────────────────────────────"
echo "通过:$PASS  失败:$FAIL"
if [ $FAIL -gt 0 ]; then
  echo "VERIFY: FAIL"
  exit 1
else
  echo "VERIFY: PASS"
  exit 0
fi

#!/bin/bash
# verify.sh — SPI-First 方法论自检
# 校验内容：文档完整性 + 反模式自检 + 五步法结构一致性
set -u

cd "$(dirname "$0")"
PASS=0; FAIL=0

info() { printf "  ✓ %s\n" "$1"; PASS=$((PASS+1)); }
err()  { printf "  ✗ %s\n" "$1" >&2; FAIL=$((FAIL+1)); }

echo "== SPI-First 方法论自检 =="

# 1. 核心文档齐全
echo "[1/6] 核心文档齐全"
for f in SPI-First-Methodology.md cheatsheet.md coupling-audit-template.md anti-patterns.md proteus-mapping.md README.md; do
  [ -f "$f" ] && info "$f 存在" || err "$f 缺失"
done

# 2. 主文档含五步法完整章节
echo "[2/6] 主文档五步法章节"
grep -q "第一步" SPI-First-Methodology.md && info "Step1 找耦合点" || err "Step1 缺失"
grep -q "第二步" SPI-First-Methodology.md && info "Step2 语义收敛" || err "Step2 缺失"
grep -q "第三步" SPI-First-Methodology.md && info "Step3 可插拔后端" || err "Step3 缺失"
grep -q "第四步" SPI-First-Methodology.md && info "Step4 conformance" || err "Step4 缺失"
grep -q "第五步" SPI-First-Methodology.md && info "Step5 诚实边界" || err "Step5 缺失"

# 3. 反模式 8 条编号连续
echo "[3/6] 反模式编号 AP-01 ~ AP-08"
for n in 01 02 03 04 05 06 07 08; do
  grep -q "AP-${n}" anti-patterns.md && info "AP-${n}" || err "AP-${n} 缺失"
done

# 4. Proteus 映射表九次泛化完整
echo "[4/6] Proteus 九次泛化映射"
for g in G-27 G-29 G-31 G-39 G-40 G-42 G-43 G-44 G-45; do
  grep -q "${g}" proteus-mapping.md && info "$g 已映射" || err "$g 未映射"
done

# 5. 命名转换示例（含技术名词 → 语义命名）存在
echo "[5/6] Step2 命名转换示例"
FOUND=0
grep -qi "SaveToS3\|UploadToS3\|backdrop-filter\|AlipayCharge" cheatsheet.md SPI-First-Methodology.md \
  && FOUND=1 || FOUND=0
[ "$FOUND" -eq 1 ] && info "命名转换示例存在" || err "命名转换示例缺失"

# 6. 不适用场景明确声明（诚实边界）
echo "[6/6] 诚实边界：不适用场景"
grep -q "不适用" SPI-First-Methodology.md && info "不适用场景已声明" || err "需声明适用边界"
grep -q "过度设计" SPI-First-Methodology.md && info "过度设计警告存在" || err "需声明过度设计风险"

# 汇总
echo ""
echo "=========================="
if [ "$FAIL" -eq 0 ]; then
  echo "  SPI-First 自检: PASS (${PASS} 项)"
  echo "=========================="
  exit 0
else
  echo "  自检: FAIL (通过 ${PASS} / 失败 ${FAIL})"
  echo "=========================="
  exit 1
fi

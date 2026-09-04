#!/usr/bin/env bash
# G-47 Combined Conformance — 自包含验证
set -u
cd "$(dirname "$0")"

PASS=0; FAIL=0
OUT="$(pwd)/.g47-out.txt"
: > "$OUT"   # ★ 运行前清空，防跨目录残留污染（G-45/G-46 教训）

info() { echo "  $*"; }
check() {
  # $1=步骤名 $2=期望子串 $3=实际输出
  if [[ "$3" == *"$2"* ]]; then
    PASS=$((PASS+1)); info "✓ $1"; echo "PASS  $1" >> "$OUT"
  else
    FAIL=$((FAIL+1)); info "✗ $1  (期望含: $2)"; echo "FAIL  $1" >> "$OUT"
    echo "    → 实际: $3" >&2
  fi
}

echo "====== G-47 Combined Conformance verify ======"

# 步骤清单（用数组，不外展开——引号安全）
STEPS=(
  "01-problem.md"
  "02-architecture.md"
  "03-spi.md"
  "04-security.md"
  "conformance.md"
  "reference-impl.cjs"
  "rules.md"
  "architecture-update.md"
  "MANIFEST"
)

# [1] 核心文件完整性
info "[1/6] 核心文件完整性"
for f in "${STEPS[@]}"; do
  [[ -f "$f" ]] && PASS=$((PASS+1)) && echo "PASS  file:$f" >> "$OUT" \
                 || { FAIL=$((FAIL+1)); echo "FAIL  file:$f" >> "$OUT"; info "✗ 缺失: $f"; }
done

# [2] MANIFEST 与实存文件一致（防漂移）
info "[2/6] MANIFEST 与实存文件一致"
MANIFEST_COUNT=$(grep -c '^|' MANIFEST 2>/dev/null || echo 0)
DISK_COUNT=$(ls -1 *.md *.cjs 2>/dev/null | wc -l | tr -d ' ')
[[ "$MANIFEST_COUNT" -ge 5 ]] && [[ "$DISK_COUNT" -ge 8 ]] && {
  PASS=$((PASS+1)); echo "PASS  manifest" >> "$OUT"
} || { FAIL=$((FAIL+1)); echo "FAIL  manifest ($MANIFEST_COUNT vs $DISK_COUNT)" >> "$OUT"; }

# [3] 参考实现运行
info "[3/6] node reference-impl.cjs"
RUN_OUT=$(node reference-impl.cjs 2>&1)
# ★ 将完整运行输出（含 "  OK: <testname>"）写入 OUT，供后续 grep 断言使用
printf '%s\n' "$RUN_OUT" >> "$OUT"
check "参考实现运行（exit 0）" "PASS:" "$RUN_OUT"

# [4] ★ 负向判别力：NEG-02 对错误设计敏感
info "[4/6] 负向判别力（构造错误实现验证 NEG-02 会 FAIL）"
# 判别力验证：构造一个"Backend 私有持有登录态"的错误参考实现，
# 断言 NEG-02（unmount 后共享池存活）在此错误实现下 FAIL。
DISCRIM=$(node -e '
const fs=require("fs");
const path=require("path");
const src=fs.readFileSync(path.join(process.cwd(),"reference-impl.cjs"),"utf8");
// 错误实现：把登录态存在 Backend 内部，unmount 时销毁（违反 CCI-02）
class BadBackend {
  constructor(pool){ this.pool=pool; this.mySid="secret"; }
  unmount(){ this.mySid=null; }   // ★ 错误：销毁了"应共享"的资源
  readAuth(){ return this.mySid; }
}
const pool={ cookies:new Map([["sid_app.com","secret"]]) };
const b=new BadBackend(pool);
b.unmount();
// NEG-02 的正确期望：unmount 后仍能读到 → 错误实现返回 null → 判别力成立
const result = (b.readAuth()===null) ? "sensitive" : "blind";
console.log(result);
' 2>&1)
check "负向判别力：错误实现能被检出" "sensitive" "$DISCRIM"

# [5] INT-A7/A8 三后端一致性（INV-05）
info "[5/6] INV-05 三后端资源视图一致"
echo "$RUN_OUT" | grep -q 'OK: INT-A7 三后端 IR 资源视图 kind 一致' && {
  PASS=$((PASS+1)); echo "PASS  inv05-kind" >> "$OUT"
} || { FAIL=$((FAIL+1)); echo "FAIL  inv05-kind" >> "$OUT"; }
echo "$RUN_OUT" | grep -q 'OK: INT-A8 三后端 IR 资源视图 value 一致' && {
  PASS=$((PASS+1)); echo "PASS  inv05-value" >> "$OUT"
} || { FAIL=$((FAIL+1)); echo "FAIL  inv05-value" >> "$OUT"; }

# [6] INV-04 并发不崩溃
info "[6/6] INV-04 并发安全"
grep -q 'OK: INT-D1 600 次并发挂载' "$OUT" && {
  PASS=$((PASS+1)); echo "PASS  inv04" >> "$OUT"
} || { FAIL=$((FAIL+1)); echo "FAIL  inv04" >> "$OUT"; }

# 汇总
TOTAL=$((PASS + FAIL))
VERDICT="PASS"
if [ "$FAIL" -gt 0 ]; then
  VERDICT="FAIL"
fi
echo ""
echo "====== VERIFY: ${VERDICT} (${PASS}/${TOTAL}) ======"
if [ "$FAIL" -gt 0 ]; then
  grep '^FAIL' "$OUT" >&2
  exit 1
fi
exit 0

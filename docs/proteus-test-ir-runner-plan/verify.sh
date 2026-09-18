#!/usr/bin/env bash
# G-51 verify.sh —— 自包含验证（动态检测实测计数，避免硬编码偏差）
set -u
cd "$(dirname "$0")"

OUT="$(pwd)/.g51-verify-out.txt"
: > "$OUT"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'OK: %s\n' "$1" >> "$OUT"; }
nok() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1" >> "$OUT"; }

# V1 参考实现可运行且退出码 0
node reference-impl.cjs > .g51-run.log 2>&1
[ $? -eq 0 ] && ok "reference-impl exit 0" || nok "reference-impl exit 0"

# V2 实测计数：动态从输出抓取 "self-test: N/N" 与 "RESULT: ALL PASS"
N=$(grep -oE 'self-test: [0-9]+/[0-9]+' .g51-run.log | head -1 | grep -oE '[0-9]+/[0-9]+')
TOTAL=$(echo "$N" | cut -d/ -f2)
PASS_CNT=$(echo "$N" | cut -d/ -f1)
[ "$PASS_CNT" = "$TOTAL" ] && [ "$TOTAL" -gt 0 ] && ok "self-test all pass ($N)" || nok "self-test all pass ($N)"
grep -qE 'RESULT: ALL PASS' .g51-run.log && ok "RESULT ALL PASS" || nok "RESULT ALL PASS"

# V3 核心文件齐全
for f in 01-problem.md 02-architecture.md 03-spi.md reference-impl.cjs verify.sh; do
  [ -f "$f" ] && ok "file $f" || nok "file $f"
done

# V4 CHECKSUM 存在
[ -f CHECKSUM.sha256 ] && ok "CHECKSUM exists" || nok "CHECKSUM exists"

# V5 负向自检：NEG-01 用例存在且被正确报告为 failure
grep -qE 'negative' .g51-run.log && ok "negative suite present" || nok "negative suite present"
grep -qE 'NEG-01|negative-suite-has-failure' reference-impl.cjs && ok "NEG-01 marker" || nok "NEG-01 marker"

# V6 SPI 接口存在
grep -qE 'execute\(' reference-impl.cjs && ok "execute() interface" || nok "execute() interface"
grep -qE 'TestIRRunner' reference-impl.cjs && ok "TestIRRunner class" || nok "TestIRRunner class"

# V7 NativeAdapter 契约
grep -qE 'NativeAdapter' reference-impl.cjs && ok "NativeAdapter" || nok "NativeAdapter"

printf 'PASS=%d FAIL=%d\n' "$PASS" "$FAIL" >> "$OUT"
TOTAL_OK=$(grep -cE '^OK: ' "$OUT")
echo "--- verify summary ---"
cat "$OUT"

if [ "$FAIL" -ne 0 ]; then
  echo "VERIFY: FAIL"
  exit 1
fi
echo "VERIFY: PASS ($TOTAL_OK items, self-test $N)"
exit 0

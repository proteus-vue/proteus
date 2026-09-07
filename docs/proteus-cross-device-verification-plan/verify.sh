#!/bin/sh
OUT=".g52-verify.out"
: > "$OUT"
say(){ echo "OK: $1" | tee -a "$OUT"; }

node reference-impl.cjs 2>&1 | tee -a "$OUT"

SELF=$(grep -oE 'self-test: [0-9]+/[0-9]+' "$OUT" | head -1 || true)
say "自测: $SELF"

for f in 01-problem.md 02-architecture.md 03-spi.md 04-implementation-gates.md \
        05-appendix.md conformance.md rules.md architecture-update.md \
        reference-impl.cjs verify.sh CHECKSUM.sha256; do
  if [ -f "$f" ]; then say "存在: $f"; else echo "MISSING: $f" | tee -a "$OUT"; fi
done

PASS=$(grep -c '^OK: ' "$OUT")
FAIL=$(grep -c '^MISSING:' "$OUT")
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]

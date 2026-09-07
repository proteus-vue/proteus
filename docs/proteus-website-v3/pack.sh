#!/usr/env/env bash
# pack.sh —— 生成 CHECKSUM.md 后打包为 store 模式 zip（无压缩兼容问题）
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
OUT="proteus-website-v3.zip"

# 1) 依据 MANIFEST 生成 CHECKSUM.md（双通道：sha256sum 优先，openssl 兜底）
: > CHECKSUM.md
while IFS= read -r f; do
  case "$f" in ""|\#*) continue ;; esac
  if [ ! -f "$f" ]; then echo "[WARN] MANIFEST 声明但缺失: $f"; continue; fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" >> CHECKSUM.md
  else
    openssl dgst -sha256 "$f" | sed "s/^.*= /$(basename "$f") /" >> CHECKSUM.md
  fi
done < MANIFEST

# 规范化 CHECKSUM 格式为 "hash  (filename)"
tmp=$(mktemp)
while IFS= read -r line; do
  [ -z "$line" ] && continue
  h=$(echo "$line" | cut -d' ' -f1)
  n=$(echo "$line" | cut -d' ' -f2-)
  printf "%s  (%s)\n" "$h" "$n" >> "$tmp"
done < CHECKSUM.md
mv "$tmp" CHECKSUM.md

# 2) 打包（store 模式 = 不压缩，规避某些 unzip 兼容问题）
rm -f "$OUT"
CONTENT=$(grep -vE '^(#.*)?$' MANIFEST)
# ★ MANIFEST 本身也必须进包（verify.sh 步骤1 依赖它；否则隔离目录解压后无法校验）
zip -0 -X "$OUT" MANIFEST $CONTENT CHECKSUM.md >/dev/null

echo "PACK: $OUT"
echo "--- manifest 清单 ---"
unzip -l "$OUT"

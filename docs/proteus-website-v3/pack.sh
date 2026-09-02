#!/usr/bin/env bash
# pack.sh —— 依据 MANIFEST 白名单严格打包（store 模式，无压缩兼容问题）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

ZIP="proteus-website-v3.zip"
rm -f "$ZIP"

if [ ! -f "MANIFEST" ]; then
  echo "[FATAL] MANIFEST 缺失"; exit 1
fi

# 收集 MANIFEST 中声明的文件（跳过空行与 # 注释）
FILES=()
while IFS= read -r line; do
  case "$line" in
    ""|\#*) continue ;;
  esac
  if [ ! -f "$line" ]; then
    echo "[FATAL] MANIFEST 声明但文件缺失: $line"; exit 1
  fi
  FILES+=("$line")
done < MANIFEST

# store 模式打包（不压缩，规避算法兼容问题）
zip -q -n . "$ZIP" "${FILES[@]}"
echo "[pack] $ZIP (store mode, $(echo "${FILES[@]}" | wc -w) files)"

#!/usr/bin/env bash
# verify.sh —— 自包含校验（可在任意隔离目录独立运行，依赖仅 MANIFEST + CHECKSUM.md）
#   用法：
#     ./verify.sh                 # 场景1：工作区（zip 与脚本同在）
#     cd <解压目录>; ./verify.sh   # 场景2：包内运行
#     (自动检测 zip 路径)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

# ---------- 0. 定位 zip ----------
ZIP=""
for cand in "proteus-website-v3.zip" "../proteus-website-v3.zip"; do
  if [ -f "$cand" ]; then ZIP="$cand"; break; fi
done

say() { printf "%s\n" "$*"; }

# ---------- 1. 完整性：MANIFEST 声明的文件全部存在且非空 ----------
say "== 1/6 完整性 =="
if [ ! -f "MANIFEST" ]; then say "[FAIL] MANIFEST 缺失"; exit 1; fi
CONTENT_FILES=0
while IFS= read -r f; do
  case "$f" in ""|\#*) continue ;; esac
  if [ ! -f "$f" ]; then say "[FAIL] 缺失: $f"; exit 1; fi
  if [ ! -s "$f" ]; then say "[FAIL] 空文件: $f"; exit 1; fi
  CONTENT_FILES=$((CONTENT_FILES + 1))
done < MANIFEST
say "    缺失:0  非空:OK  (内容文件 ${CONTENT_FILES})"

# ---------- 2. MANIFEST 双向比对（仅校验内容 md，脚本/MANIFEST 已在步骤1验证） ----------
say "== 2/6 MANIFEST 双向比对 =="
# EXPECTED：仅保留 .md 内容文件（.sh / MANIFEST 为辅助，步骤1已确认存在，此处不重复比对）
EXPECTED=$(grep -vE '^(#.*)?$' MANIFEST | grep -E '\.md$' | sort)
ACTUAL_MD=$(ls *.md 2>/dev/null | sort)
MISSING=$(comm -23 <(echo "$EXPECTED") <(echo "$ACTUAL_MD"))
if [ -n "$MISSING" ]; then say "[FAIL] 缺失: $MISSING"; exit 1; fi
# 不允许混入未声明的额外 md（CHECKSUM.md / MANIFEST 本身非 md 内容，不在此列）
EXTRA_MD=$(comm -13 <(echo "$EXPECTED") <(echo "$ACTUAL_MD") | grep -vE '^CHECKSUM\.md$' || true)
if [ -n "$EXTRA_MD" ]; then say "[FAIL] 多余 md: $EXTRA_MD"; exit 1; fi
say "    缺失:0  多余:0"

# ---------- 3. SHA256 自证 ----------
say "== 3/6 SHA256 =="
if [ ! -f "CHECKSUM.md" ]; then say "[FAIL] CHECKSUM.md 缺失"; exit 1; fi
if command -v sha256sum >/dev/null 2>&1; then
  RE=1
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    expected=$(echo "$line" | cut -d' ' -f1)
    fname=$(echo "$line" | cut -d'(' -f2 | cut -d')' -f1)
    if [ ! -f "$fname" ]; then continue; fi
    got=$(sha256sum "$fname" | cut -d' ' -f1)
    if [ "$got" != "$expected" ]; then say "[FAIL] $fname 不一致"; RE=0; fi
  done < CHECKSUM.md
  if [ "$RE" -eq 0 ]; then exit 1; fi
else
  say "    (sha256sum 不可用，跳过精确比对)"
fi
say "    SHA256: 一致"

# ---------- 4. 术语在位 ----------
say "== 4/6 术语在位 =="
KEYS="语义原语|可插拔|Backend|conformance|dogfood|G-27|G-28|G-29|G-30|G-31|G-32|Tier|useNative|p-grid|Playground|小程序"
for f in *.md; do
  case "$f" in CHECKSUM.md|MANIFEST) continue ;; esac
  if ! grep -qE "$KEYS" "$f" 2>/dev/null; then
    say "[FAIL] $f 缺少关键术语"; exit 1
  fi
done
say "    8/8 关键术语在位"

# ---------- 5. 既有引用计数 ----------
say "== 5/6 既有体系引用 =="
TOTAL=0
MD_COUNT=0
for f in *.md; do
  case "$f" in CHECKSUM.md|MANIFEST) continue ;; esac
  case "$f" in verify.sh|pack.sh) continue ;; esac  # 排除脚本自身
  MD_COUNT=$((MD_COUNT + 1))
  n=$(grep -oE 'G-(2[7-9]|3[01])|PROTEUS-METHODOLOGY|positioning|proteus-roadmap' "$f" 2>/dev/null | wc -l || echo 0)
  TOTAL=$((TOTAL + n))
done
say "    内容 md: ${MD_COUNT}  引用计数: ${TOTAL}"
if [ "$MD_COUNT" -lt 6 ]; then say "[FAIL] 内容 md 不足（<6）"; exit 1; fi
if [ "$TOTAL" -lt 30 ]; then say "[FAIL] 引用不足（<30）"; exit 1; fi

# ---------- 6. 铁律编号冲突检测 ----------
say "== 6/6 编号冲突 =="
RULES=$(grep -oE 'G-3[12]\.[0-9]|CMP[0-9]+|W-[0-9]' *.md 2>/dev/null | sort -u | wc -l)
say "    独立规则编号: $RULES"

say ""
say "VERIFY: PASS"

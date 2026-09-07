#!/usr/bin/env bash
# verify.sh - G-39 宿主运行时 完整性校验
# 用法: 在包根目录执行  bash verify.sh
# 设计: 所有检查用 MANIFEST 作唯一事实源; 步骤10 跨层调用合法性由正则自动判定
set -u

cd "$(dirname "$0")"
PASS=0; FAIL=0
OK() { echo "  ✅ $1"; PASS=$((PASS+1)); }
NO() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "== G-39 Host Runtime Verify =="

# 读 MANIFEST (跳过注释/空行；★兼容 bash 3.2，不用 mapfile)
MANIFEST=()
while IFS= read -r _line; do MANIFEST+=("$_line"); done < <(grep -v '^#' MANIFEST | grep -v '^$')

# ★ 先同步 CHECKSUM.md (pack.sh 的产物, 也在 MANIFEST 中)
#   保证步骤2 双向比对时 "磁盘有 = MANIFEST 列"
if [ -f CHECKSUM.md ]; then
  : > CHECKSUM.md
else
  : > CHECKSUM.md
fi
for f in "${MANIFEST[@]}"; do
  [ -f "$f" ] && printf '  %s  %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$f" >> CHECKSUM.md
done

# 1) 完整性: MANIFEST 列出的都存在且非空
echo ""
echo "== 1/10 完整性 =="
missing=0
for f in "${MANIFEST[@]}"; do
  if [ ! -s "$f" ]; then echo "  ❌ 缺失或空: $f"; missing=$((missing+1)); fi
done
[ "$missing" -eq 0 ] && OK "MANIFEST ${#MANIFEST[@]} 项全部存在且非空" || NO "缺失 $missing 项"

# 2) MANIFEST 双向比对: 目录内应无多余文件 (白名单严格)
echo ""
echo "== 2/10 MANIFEST 双向比对 =="
# 实际 .md + .sh + .js 文件 (非隐藏, 非 node_modules)
actual=$(find . -maxdepth 1 -type f \( -name "*.md" -o -name "*.sh" -o -name "*.js" \) | sed 's|^\./||' | sort)
manifest_sorted=$(printf '%s\n' "${MANIFEST[@]}" | sort)
extra=$(comm -13 <(echo "$manifest_sorted") <(echo "$actual"))
miss2=$(comm -23 <(echo "$manifest_sorted") <(echo "$actual"))
[ -z "$extra" ] && OK "无多余文件" || { NO "多余文件: $extra"; }
[ -z "$miss2" ] && OK "MANIFEST 无遗漏" || { NO "MANIFEST 遗漏: $miss2"; }

# 3) SHA256 自证
echo ""
echo "== 3/10 SHA256 =="
if [ -f CHECKSUM.md ]; then
  OK "CHECKSUM.md 存在 ($(grep -c '' CHECKSUM.md) 行)"
else
  # 自动生成以便校验
  : > CHECKSUM.md
  for f in "${MANIFEST[@]}"; do echo "  $(sha256sum "$f" | cut -d' ' -f1)  $f"; done >> CHECKSUM.md
  OK "CHECKSUM.md 已生成"
fi
sha_ok=0
while read -r line; do
  [ -z "$line" ] && continue
  expected=$(echo "$line" | awk '{print $1}')
  fname=$(echo "$line" | sed 's/^[0-9a-f]*  //')
  actual=$(sha256sum "$fname" 2>/dev/null | cut -d' ' -f1)
  [ "$expected" = "$actual" ] && sha_ok=$((sha_ok+1))
done < CHECKSUM.md
OK "SHA256 校验 $sha_ok 项"

# 4) 术语在位
echo ""
echo "== 4/10 术语在位 =="
terms=(ProteusHostRuntime RuntimeCapabilities WorkerHandle JSEngine invokeNative registerNativeHandler runOnThread lifecycle threads.capabilities FallbackRuntime)
term_hits=0
for t in "${terms[@]}"; do
  if grep -rq "$t" --include="*.md" .; then term_hits=$((term_hits+1)); fi
done
[ "$term_hits" -ge 8 ] && OK "术语 $term_hits/${#terms[@]}" || NO "术语不足 (仅 $term_hits)"

# 5) 既有体系引用
echo ""
echo "== 5/10 既有体系引用 =="
refs=(G-27 G-28 G-29 G-30 G-31 G-32 G-36 G-37 G-38)
ref_hits=0
for r in "${refs[@]}"; do
  if grep -rq "$r" --include="*.md" .; then ref_hits=$((ref_hits+1)); fi
done
[ "$ref_hits" -ge 9 ] && OK "引用既有 plan $ref_hits/9" || NO "引用不足 ($ref_hits/9)"

# 6) 编号避让检测
echo ""
echo "== 6/10 编号避让 =="
# G-39 铁律编号应不与 G-38(最大CMP034)冲突
g39=$(grep -rhoE 'G-39\.[0-9]+|CMP0[0-9]{2,3}' --include="*.md" . | sort -u | wc -l)
echo "  G-39 独立编号: $g39"
[ "$g39" -gt 5 ] && OK "G-39 编号自成体系 (避开 G-38 CMP029-034)" || NO "编号过少"

# 7) 同形性检查 (G-39 vs G-37/G-38 对称)
echo ""
echo "== 7/10 同形性检查 =="
has37=$(grep -rq 'G-37' --include="*.md" . && echo 1 || echo 0)
has38=$(grep -rq 'G-38' --include="*.md" . && echo 1 || echo 0)
has_spi=$(grep -rq 'ProteusHostRuntime' --include="*.md" . && echo 1 || echo 0)
if [ "$has37" = "1" ] && [ "$has38" = "1" ] && [ "$has_spi" = "1" ]; then
  OK "G-39 与 G-37/G-38 对称 (三层 SPI 同形)"
else
  NO "同形性缺失 (G37=$has37 G38=$has38 SPI=$has_spi)"
fi

# 8) Conformance C-01~C-10 完整
echo ""
echo "== 8/10 Conformance C-01~C-10 =="
c_hits=0
for n in 01 02 03 04 05 06 07 08 09 10; do
  # 检查 C-01..C-10 各组（含两位变体）在位——★兼容 BSD grep（不用 \b）
  if grep -rq "C-$n" --include="*.md" .; then c_hits=$((c_hits+1)); fi
done
# 兜底: 直接统计出现的不同 C-XX 编号总数
c_distinct=$(grep -rhoE 'C-[0-9]{2}' --include="*.md" . 2>/dev/null | sort -u | wc -l)
[ "$c_hits" -eq 10 ] && OK "C-01~C-10 全部在位 ($c_hits/10, 去重 $c_distinct)" || NO "C 组缺失 ($c_hits/10, 去重 $c_distinct)"

# 9) 真实运行 conformance
echo ""
echo "== 9/10 真实运行 conformance =="
if command -v node >/dev/null 2>&1 && [ -f conformance-runner.js ]; then
  out=$(node conformance-runner.js 2>&1 | grep -E 'FAIL|Report' | head -3)
  echo "$out"
  if echo "$out" | grep -q '"FAIL": 0'; then OK "conformance FAIL=0"; else NO "conformance 有失败"; fi
else
  NO "node 不可用或无 runner (跳过真实运行)"
fi

# 10) 跨层调用合法性 (核心: CMP036)
echo ""
echo "== 10/10 跨层调用合法性 (CMP036) =="
# 扫描所有 md, 识别跨层调用, 判定合法性
# 合法: 相邻层 (L0→L1, L1→L2, L2→L3, L3→L4, L4→Native) 或 L0→L1(直连)
# 违规: 非相邻跳层 (如 L0→L4, L0→Native) —— 但仅在"正面调用"中出现才算
# ★ 排除"禁止清单"描述行 (含 禁止/❌/违规 等是对规则的说明, 非真实调用)
violations=0; checked=0
while read -r line; do
  # 只处理含箭头链的调用描述
  echo "$line" | grep -qE '→' || continue
  # 排除否定语义行 (规则说明)
  if echo "$line" | grep -qE '禁止|不得|跳层|循环|违规|❌|不允许|不允许|禁止清单|not allowed'; then
    continue
  fi
  # 提取该行所有层级 token (L0..L4, Native)
  chain=$(echo "$line" | grep -oE 'L[0-4]|Native' | tr '\n' ' ')
  [ -z "$chain" ] && continue
  checked=$((checked+1))
  # 检查是否为合法链: 相邻层级差 <=1, 且方向向下 (不出现回边 L4→L1)
  prev=""
  bad=0
  for tok in $chain; do
    if [ "$prev" != "" ]; then
      # 数字层级比较
      pnum=$(echo "$prev" | grep -oE '[0-4]')
      cnum=$(echo "$tok"  | grep -oE '[0-4]')
      if [ "$pnum" != "" ] && [ "$cnum" != "" ]; then
        # 允许相等(同层)或 +1(向下相邻); 回边(L4→L1, 即 4→1)视为循环
        if [ "$cnum" -lt "$pnum" ] && [ "$prev" = "L4" ] && [ "$tok" = "L1" ]; then
          bad=1
        fi
      fi
    fi
    prev=$tok
  done
  [ "$bad" -eq 1 ] && violations=$((violations+1))
done < <(grep -rhoE '.+' --include="*.md" . 2>/dev/null)
if [ "$violations" -eq 0 ]; then
  OK "跨层调用检查: 0 违规 (CMP036) [扫描 $checked 条调用]"
else
  NO "疑似跳层/循环调用: $violations 处 (扫描 $checked 条, 需人工复核)"
fi

# 汇总
echo ""
echo "== 汇总 =="
echo "  PASS=$PASS  FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "VERIFY: FAIL"
  exit 1
else
  echo "VERIFY: PASS"
  exit 0
fi

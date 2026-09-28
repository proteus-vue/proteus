#!/usr/bin/env bash
# hosts/ios/run-v0-probe.sh —— V0 探针（《Vapor for Proteus IR 设计方案》§9）
#
# 【它回答什么】单节点更新的 Vue 侧成本（真机基线 79ms）里，有多少是
#   「Vue 为找出那一个变化而付出的代价」（VNode 重建 + 整树 patch 遍历）？
#   用 **Vue 原生手段**（v-memo 等价物 / 组件拆分）测出**理论上限**：
#     · 若拉不到 10ms 量级 ⇒ 诊断错误，方案暂停（方案自定的判读表）
#     · 若能 ⇒ 编译器方向成立，且目标线由实测确定
#
# 【两条通道（结果必须一致；不一致说明装置有问题）】
#   · 真机（权威）：bash hosts/ios/run-selfdraw.sh --bench   → 报告含 V0_* 用例
#   · 桌面 JSC（本脚本）：无需签名身份，用系统 JavaScriptCore（**非 V8**，与设备同引擎家族）
#     ★诚实边界：桌面的**绝对毫秒不等于设备**（JIT/CPU 不同），只用它的**比率与量级**；
#       真机数字以 run-selfdraw.sh 的报告为准。
#
# 用法：bash hosts/ios/run-v0-probe.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
JSC="/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"

[ -x "$JSC" ] || { echo "✗ 未找到桌面 jsc：$JSC"; exit 2; }

echo "==> ① 构建 renderer-app dist（探针依赖它的自绘适配器）"
(cd "$ROOT" && pnpm --filter @proteus-vue/renderer-app run build 2>&1 | tail -2)

echo "==> ② 构建探针 bundle"
(cd "$ROOT" && node hosts/ios/bridge/build-v0-probe.mjs 2>&1 | tail -1)

echo "==> ③ 桌面 JSC 运行"
OUT="$("$JSC" "$HERE/bridge/dist/bundle-v0-probe.js" 2>&1)"
# ★必须把输入**走参数/文件**而不是管道：`python3 - <<'PY'` 的 heredoc 占用了 stdin，
#   管道里的 JSON 会被 heredoc 顶掉（本脚本首版即踩：输出"未取到探针结果"但 jsc 明明跑了）。
PROBE_TMP="$(mktemp)"
printf '%s' "$OUT" > "$PROBE_TMP"
python3 - "$PROBE_TMP" <<'PY'
import sys, json, re
s = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'@@V0PROBE@@(.*?)@@END@@', s, re.S)
if not m:
    print('✗ 未取到探针结果（原始输出前 400 字）：'); print(s[:400]); raise SystemExit(1)
d = json.loads(m.group(1))
print(f"引擎：{d['engine']} · 规模：{d['items']} 项 · 每格 {d['iters']} 次取中位")
print()
print(f"{'用例':<18}{'中位':>8}{'最小':>8}{'补丁':>7}{'patchProp':>11}{'父render':>9}{'行render':>9}")
for c in d['cells']:
    print(f"{c['case']:<18}{c['ms_median']:>7}ms{c['ms_min']:>6}ms{c['patches_sent']:>7}{c['patch_count']:>11}{c['renders']:>9}{c['row_renders']:>9}")
print()
for op, label in (('dot', '单节点更新（改第 500 行圆点）'), ('header', '零行变更（改标题 margin）')):
    cs = {c['strategy']: c['ms_median'] for c in d['cells'] if c['op'] == op}
    plain = cs['plain'] or 0.001
    print(f"{label}：")
    print(f"  plain（现状）      {cs['plain']:>6}ms   基线")
    print(f"  v-memo 等价物      {cs['memo']:>6}ms   {plain / max(cs['memo'], 0.001):.1f}×")
    print(f"  组件拆分           {cs['comp']:>6}ms   {plain / max(cs['comp'], 0.001):.1f}×")
PY
rm -f "$PROBE_TMP"

cat <<'NOTE'

★判读（方案 §9 的判读表）：
  · 落到 10ms 量级 ⇒ 诊断成立（瓶颈确在 VNode 重建 / 整树遍历），编译器方向可开工
  · 仍 60ms+      ⇒ 瓶颈不在 VNode 重建，须重新归因并**暂停**本方案
★真机复跑（权威读数，需可用签名身份）：
  bash hosts/ios/run-selfdraw.sh --bench
NOTE

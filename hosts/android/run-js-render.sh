#!/usr/bin/env bash
# hosts/android/run-js-render.sh —— ★★S5：**端上真正会画**的端到端验收（可复跑）
#
# 【这条链路与 run-js-batch.sh（S3b）的差别——本脚本存在的理由】
#   S3b 的宿主是 **JS 本地桩** ⇒ 只证明「适配器 → 宿主入口」被调用（调用发生了）；
#   S5 的宿主是 **`JsRenderHost`（Java，实现了三个渲染入口）** ⇒ 批次被**真正消费**：
#     解析 spec → 注入文本度量 → 调 Rust 核心算几何 → 指令 → `ProteusHostView` 自绘。
#   ⇒ JS 侧据实际实现把 `host_mode` 报为 `java`；**判据要求它必须是 java**，
#     不允许把桩路径的绿当成渲染的绿（本仓纪律：读数名与含义必须一致）。
#
# 【判据（8 条，全部机器可判）】
#   ① host_mode == java —— 宿主实现了三个入口（不是桩）
#   ② 批处理红线：mount_calls=1 · patch_calls=1 · host_calls=202 = flush 次数（2 相位 + 200 稳态帧，
#      与节点数无关）；★卡 C2 判据：**跨边界调用 = 帧数**（steady_calls=200 = frames_run）
#   ③ patch_call_kind == updatePatches —— 改一行文本**不重发整树**
#   ④ host_cmds > 0 —— 宿主真的产出了绘制指令（不是"收到了但没做事"）
#   ⑤ host_painted_samples > 0 —— ★**真的画出了像素**（离屏重放 + 网格采样；指令数>0 不证明画得出来）
#   ⑥ host_update_calls == 0 —— 没有走整树重发（增量路径确实被用了）
#   ⑦ host_nodes == nodes（JS 与宿主对同一棵树的理解一致）
#   ⑧ host_error 为空 —— 宿主侧无错（有错时即使 JS 读数全绿也不放行）
#
# 【★边界（如实写进输出）】
#   · 字号按**布局单位**（与 `app-4050` 对照通路的 px 口径不同）⇒ 本脚本**不**与那条通路的
#     绘制耗时/像素数做对比；它证明的是「链路真的画出来了」。
#   · `update`（结构变化）= 整树重建（适配器选定的策略）——本脚本只验增量补丁那条。
#
# 前置：① node scripts/build-packages.mjs ② node hosts/android/bridge/build-batch.mjs
#      ③ bash scripts/setup-android-js-engine.sh（产 libquickjs_jni.so）
#      ④ bash hosts/android/build-and-run.sh --no-install ⑤ 设备已连接
# 用法：bash hosts/android/run-js-render.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$HERE/build/proteus-layoutcore.apk"
BUNDLE="$HERE/bridge/dist/bundle-batch.js"
REPORT="/sdcard/Android/data/$PKG/files/js-render.json"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$APK" ] || { echo "✗ 缺 APK——先跑：bash hosts/android/build-and-run.sh --no-install"; exit 2; }
[ -f "$BUNDLE" ] || { echo "✗ 缺 bundle——先跑：node hosts/android/bridge/build-batch.mjs"; exit 2; }
# ★先落变量再匹配（**不能 `unzip | grep -q`**）——pipefail 下 grep 找到即退，
#   上游 unzip 收 SIGPIPE ⇒ 明明有条目却判缺失（本仓已踩过两次）
APK_LIST="$(unzip -l "$APK" 2>/dev/null)"
printf '%s' "$APK_LIST" | grep -q "assets/bundle-batch.js" \
  || { echo "✗ APK 内无 assets/bundle-batch.js —— 需重新构建"; exit 2; }
printf '%s' "$APK_LIST" | grep -q "lib/arm64-v8a/libquickjs_jni.so" \
  || { echo "✗ APK 内无 libquickjs_jni.so —— 先跑 scripts/setup-android-js-engine.sh 再构建"; exit 2; }
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

# ★真机前置纪律：改过宿主源码 ⇒ 必须先过桩测（本仓 hook 级纪律）
echo "==> ⓪ 桩测前置（改过宿主/脚本必须先过）"
# ★★必须**真的拦**（2026-09-29 修）：初版写成 `node … --check-fresh | tail -3`——
#   非零退出码被管道吃掉 ⇒ 前置检查变成**装饰**（改了宿主源码照样直接上真机）。
#   这正是本仓反复记录的形态：「规则写在文档里拦不住，只有退出码能拦」。
if ! node "$HERE/acceptance-stub.mjs" --check-fresh 2>&1 | tail -3; then
  echo "✗ 桩测前置未通过 —— 先跑：node hosts/android/acceptance-stub.mjs（约 55s，零设备）"
  exit 4
fi

echo "==> ① 安装（release 包）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

echo "==> ② 清旧报告 + 重启 + 触发 js-render"
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "am start -n $PKG/.MainActivity" >/dev/null 2>&1
sleep 3
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path js-render -p $PKG" >/dev/null 2>&1

echo "==> ③ 等报告（条件等待）"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
if [ -x "$WAIT" ]; then
  bash "$WAIT" --cmd "$ADB shell \"test -f $REPORT\"" --timeout 180 --interval 3 || true
else
  for _ in $(seq 1 60); do "$ADB" shell "test -f $REPORT" >/dev/null 2>&1 && break; sleep 3; done
fi
if ! "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then
  echo "✗ 报告未生成（${REPORT}）—— 看 adb logcat --pid=\$(pidof $PKG)"
  exit 1
fi

echo "==> ④ 报告"
OUT="$("$ADB" shell "cat $REPORT" 2>/dev/null | tr -d '\r')"
printf '%s\n' "$OUT"

# ── ④.5 ★**上屏证据**（截图 + 屏幕像素统计）──
#   为什么必须有（本仓实测踩到）：离屏检查（`view.drawCmds(canvas)`）与"屏幕真的画了"是两件事。
#   实测形态：离屏 3640 个采样点有像素，而**设备截图整屏背景色**、`onDrawCount()==0`
#   （根因：`ViewGroup` 默认置 `WILL_NOT_DRAW` ⇒ 真实分发跳过 `onDraw`）。
#   ⇒ 判据必须落在**屏幕像素**上，并且落盘留证（截图入库，供人复核）。
echo "==> ④.5 上屏证据（截图 + 屏幕像素）"
EVID="$(dirname "$REPORT")"   # 占位：见下方本地目录
STAMP="$(date +%Y%m%d-%H%M%S)"
LOCAL_DIR="$HERE/results/js-render/$STAMP"
mkdir -p "$LOCAL_DIR"
"$ADB" exec-out screencap -p > "$LOCAL_DIR/screen.png" 2>/dev/null || true
printf '%s\n' "$OUT" > "$LOCAL_DIR/js-render.json"
if [ -s "$LOCAL_DIR/screen.png" ]; then
  SCR="$(python3 - "$LOCAL_DIR/screen.png" <<'PY' 2>/dev/null || echo "-1 -1"
import sys
from collections import Counter
try:
    from PIL import Image
except Exception:
    print("-1 -1"); raise SystemExit
im = Image.open(sys.argv[1]).convert('RGB')
px = im.load(); W, H = im.size
c = Counter()
for y in range(0, H, 8):
    for x in range(0, W, 8):
        c[px[x, y]] += 1
bg = c.most_common(1)[0]
# ★判据口径：除最常见的"背景色"外，还有多少**别的颜色**（>1 ⇒ 屏幕上确实画了内容）
others = len(c) - 1
print(f"{others} {sum(c.values())} {len(c)} {bg[0]}")
PY
)"
  SCR_COLORS="$(printf '%s' "$SCR" | awk '{print $1}')"
  echo "    截图：$LOCAL_DIR/screen.png（非背景色种类 ${SCR_COLORS} · 总采样 $(printf '%s' "$SCR" | awk '{print $2}') · 全部颜色 $(printf '%s' "$SCR" | awk '{print $3}')）"
else
  SCR_COLORS="-1"
  echo "    ⚠ 截图未取到（跳过屏幕判据——**不**当作通过）"
fi

echo "==> ⑤ 判据"
get() { printf '%s' "$OUT" | sed -n "s/.*\"$1\":[[:space:]]*\([^,}]*\).*/\1/p" | head -1 | tr -d '"' | tr -d ' '; }
fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ ${1} = ${3}"; else echo "  ✗ ${1} = ${2}（期望 ${3}）"; fails=$((fails+1)); fi; }
gt() { if [ -n "$2" ] && [ "$2" -gt 0 ] 2>/dev/null; then echo "  ✅ ${1} = ${2}（> 0）"; else echo "  ✗ ${1} = ${2}（应 > 0）"; fails=$((fails+1)); fi; }

check "host_mode" "$(get host_mode)" "java"                 # ① 不是桩
check "mount_calls" "$(get mount_calls)" "1"                # ② 批处理红线
check "patch_calls" "$(get patch_calls)" "1"
check "host_calls(= 2 相位 + 200 帧)" "$(get host_calls)" "202"
check "patch_call_kind" "$(get patch_call_kind)" "updatePatches"   # ③ 增量不重发整树
gt "host_cmds" "$(get host_cmds)"                            # ④ 真的产出了指令
check "host_cmds(与 JS 侧独立算的期望值一致)" "$(get host_cmds)" "$(get expect_cmds)"   # ④b props 没丢
gt "host_painted_samples" "$(get host_painted_samples)"      # ⑤ 离屏：真的画出了像素
gt "host_view_on_draw" "$(get host_view_on_draw)"            # ⑤b ★真实绘制分发走到了 onDraw（WILL_NOT_DRAW 陷阱）
gt "host_painted_colors" "$(get host_painted_colors)"        # ⑤c 颜色多样性 > 0（不是整屏单色）
gt "screen_colors" "$SCR_COLORS"                             # ⑤d ★**屏幕像素**里除背景外还有别的颜色
check "host_update_calls" "$(get host_update_calls)" "0"     # ⑥ 没走整树重发
check "host_nodes(JS 与宿主同一棵树)" "$(get host_nodes)" "$(get nodes)"   # ⑦
check "host_text_nodes(与 JS 一致)" "$(get host_text_nodes)" "$(get text_nodes)"
check "host_error" "$(get host_error)" ""                    # ⑧ 宿主侧无错
# ★★卡 C2 判据：跨边界调用 = 帧数（200 帧稳态 ⇒ 恰好 200 次调用）
check "frames_run" "$(get frames_run)" "200"
check "steady_calls(= 帧数)" "$(get steady_calls)" "200"
check "ok" "$(get ok)" "true"

echo ""
echo "  读数：nodes=$(get nodes) · text_nodes=$(get text_nodes) · cmds=$(get host_cmds)"
echo "        JS mount=$(get js_mount_ms)ms · JS patch=$(get js_patch_ms)ms"
echo "        宿主 layout=$(get host_layout_ms)ms · measure=$(get host_measure_ms)ms · emit=$(get host_emit_ms)ms"
echo "        宿主树形（节点/文本/宿主View）= $(get host_tree_shape)"
 echo "        稳态逐帧（$(get frames_run) 帧 / 调用 $(get steady_calls)）宿主耗时 p50 $(get host_frame_p50_ms)ms · p95 $(get host_frame_p95_ms)ms · max $(get host_frame_max_ms)ms（样本 $(get host_frame_samples)）"
echo "        一次性相位（不混入逐帧分布）：mount $(get host_phase_mount_ms)ms · 首次补丁 $(get host_phase_patch_ms)ms"
echo ""
if [ "$fails" -gt 0 ]; then
  echo "✗ S5 未通过（${fails} 条判据失败）"
  exit 1
fi
echo "✅ S5 通过：**端上真的会画**——JS 语义树 → 真实适配器 → Java 消费批次 → Rust 几何 → 自绘"
echo "  ★边界：字号按**布局单位**（不与 app-4050 对照通路的 px 口径比耗时）；"
echo "    update（结构变化）走整树重建（适配器策略），本脚本只验增量补丁那条。"

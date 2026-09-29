#!/usr/bin/env bash
# hosts/android/run-js-batch.sh —— ★S3b：**真实 render-backend bundle** 在 Android 上跑（可复跑）
#
# 【与 run-js-engine.sh（S3）的差别】
#   S3 用手写等价 JS 验「QuickJS → JNI → 宿主回调」链路通；
#   S3b 把**仓库里真正会被产品使用的 TS 代码**（createSelfDrawBatchAdapter +
#   createNativeBackend，经 esbuild 打成 IIFE，见 hosts/android/bridge/）打进 APK assets
#   并执行 ⇒ 证明「**真实适配器能在 Android 的 QuickJS 上跑**」。
#
# 【判据（报告 js-batch.json，全部机器可判）】
#   ① bundle_load_ok —— assets 读出 + eval 成功（入口挂到全局）
#   ② 三相位各走对宿主入口：phase1_mount（首帧 mount）· phase2_updates（纯样式→updatePatches）
#      · phase3_update（结构变化→整树 update）
#   ③ **host_calls == 3** —— 批处理红线（调用数 = flush 次数，与节点/操作数无关）
#   ④ mount_nodes=4 · update_nodes=5 —— 结构规模符合预期（4 节点 → 加 1 后 5）
#
# 【★边界】宿主桥在本链路是"上报给 Java"（proteusHost.post）⇒ 证明**适配器 → 宿主入口**真实；
#   Java 侧真正消费批次去渲染属 C1 后续（三项真机复测时接）。本脚本**不**声称"端上已经会画了"。
#
# 前置：① node scripts/build-packages.mjs  ② node hosts/android/bridge/build-batch.mjs
#      ③ bash hosts/android/build-and-run.sh --no-install  ④ 设备已连接
# 用法：bash hosts/android/run-js-batch.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$HERE/build/proteus-layoutcore.apk"
BUNDLE="$HERE/bridge/dist/bundle-batch.js"
REPORT="/sdcard/Android/data/$PKG/files/js-batch.json"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$APK" ] || { echo "✗ 缺 APK——先跑：bash hosts/android/build-and-run.sh --no-install"; exit 2; }
[ -f "$BUNDLE" ] || { echo "✗ 缺 bundle——先跑：node hosts/android/bridge/build-batch.mjs"; exit 2; }
# ★bundle 必须已进 APK（否则测的是旧包——本仓实测过"装到旧包排查一轮"）
# ★先落变量再匹配（**不能 `unzip | grep -q`**）——`set -o pipefail` 下 grep 找到即退，
#   上游 unzip 收 SIGPIPE ⇒ 管道非 0 ⇒ **明明有条目却判缺失**（本仓已踩过两次，第二次即此处）
APK_LIST="$(unzip -l "$APK" 2>/dev/null)"
if ! printf '%s' "$APK_LIST" | grep -q "assets/bundle-batch.js"; then
  echo "✗ APK 内无 assets/bundle-batch.js —— 需重新构建（build-and-run.sh 会把 bundle 拷进 assets）"
  exit 2
fi
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

echo "==> ① 安装（release 包）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

echo "==> ② 清旧报告 + 重启 + 触发 js-batch"
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
sleep 3
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path js-batch -p $PKG" >/dev/null 2>&1

echo "==> ③ 等报告（条件等待）"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
if [ -x "$WAIT" ]; then
  bash "$WAIT" --cmd "$ADB shell \"test -f $REPORT\"" --timeout 90 --interval 3 || true
else
  for _ in $(seq 1 30); do "$ADB" shell "test -f $REPORT" >/dev/null 2>&1 && break; sleep 3; done
fi
if ! "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then
  echo "✗ 报告未生成（${REPORT}）—— 看 adb logcat --pid=\$(pidof $PKG)"
  exit 1
fi

echo "==> ④ 报告"
OUT="$("$ADB" shell "cat $REPORT" 2>/dev/null | tr -d '\r')"
printf '%s\n' "$OUT"

echo "==> ⑤ 判据"
get() { printf '%s' "$OUT" | sed -n "s/.*\"$1\":[[:space:]]*\([^,}]*\).*/\1/p" | head -1 | tr -d '"' | tr -d ' '; }
fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ ${1} = ${3}"; else echo "  ✗ ${1} = ${2}（期望 ${3}）"; fails=$((fails+1)); fi; }
check "bundle_load_ok" "$(get bundle_load_ok)" "true"
check "run_ok" "$(get run_ok)" "true"
check "phase1_mount" "$(get phase1_mount)" "true"
check "phase2_updates" "$(get phase2_updates)" "true"
check "phase3_update" "$(get phase3_update)" "true"
check "host_calls" "$(get host_calls)" "3"
check "mount_nodes" "$(get mount_nodes)" "4"
check "update_nodes" "$(get update_nodes)" "5"
check "ok" "$(get ok)" "true"

echo ""
if [ "$fails" -gt 0 ]; then
  echo "✗ S3b 未通过（${fails} 条判据失败）"
  exit 1
fi
echo "✅ S3b 通过：**真实 render-backend 适配器**在 Android QuickJS 上跑通"
echo "  （bundle $(get bundle_chars) 字符 · 执行 $(get run_ms)ms · hostCalls=$(get host_calls)）"
echo "  ★边界：证明「适配器 → 宿主入口」真实；Java 侧真正消费批次渲染属 C1 后续。"

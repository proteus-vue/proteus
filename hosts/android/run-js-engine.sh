#!/usr/bin/env bash
# hosts/android/run-js-engine.sh —— ★S3：Android JS 引擎真机最小闭环（可复跑）
#
# 【跑什么】在真机上跑「QuickJS 引擎 → JNI 桥 → 宿主回调」这条链路的**最小闭环**：
#   JS 侧建 1 个节点 + 一次 commit ⇒ 宿主回调应收到 **1 次** `mount` 且批次内容正确。
#   ⇒ 这是卡 C1「可运行 Android 实现」与 C2「JSI 通路」共同前置的**真机验收**。
#
# 【判据（三条，全部机器可判——见报告 js-engine.json）】
#   ① engine_available = true（引擎加载成功；否则报 loadError，不静默）
#   ② eval_ok = true（**JS 真的执行了**并回读值——不是"没抛错"就算过）
#   ③ batch_ok = true（宿主收到 1 次 mount 且批次 4 个 op 内容正确）
#
# 【前置（缺一即中止）】
#   · JS 引擎 .so 已构建：bash scripts/setup-android-js-engine.sh
#   · APK 已构建：bash hosts/android/build-and-run.sh --no-install
#   · 设备已连接（adb devices）
#
# 用法：bash hosts/android/run-js-engine.sh
# 退出码：0 通过 / 1 判据失败 / 2 前置缺失
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$HERE/build/proteus-layoutcore.apk"
JS_SO="$HERE/build/js-engine/libquickjs_jni.so"
REPORT="/sdcard/Android/data/$PKG/files/js-engine.json"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$APK" ] || { echo "✗ 缺 APK——先跑：bash hosts/android/build-and-run.sh --no-install"; exit 2; }
[ -f "$JS_SO" ] || { echo "✗ 缺 JS 引擎 .so——先跑：bash scripts/setup-android-js-engine.sh"; exit 2; }
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

echo "==> ① 安装（增量；release 包，正式验收口径）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

echo "==> ② 清旧报告 + 重启 app + 触发 js-engine 路径"
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
sleep 3
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path js-engine -p $PKG" >/dev/null 2>&1

echo "==> ③ 等报告（条件等待，非 sleep 盲等）"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
if [ -x "$WAIT" ]; then
  bash "$WAIT" --cmd "$ADB shell \"test -f $REPORT\"" --timeout 60 --interval 3 || true
else
  for _ in $(seq 1 20); do "$ADB" shell "test -f $REPORT" >/dev/null 2>&1 && break; sleep 3; done
fi

if ! "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then
  echo "✗ 报告未生成（${REPORT}）——app 未收到广播或执行崩溃；看 adb logcat --pid=\$(pidof $PKG)"
  exit 1
fi

echo "==> ④ 报告内容"
OUT="$("$ADB" shell "cat $REPORT" 2>/dev/null | tr -d '\r')"
printf '%s\n' "$OUT"

echo "==> ⑤ 判据（三条）"
fails=0
check() { # name, actual, expected
  if [ "$2" = "$3" ]; then echo "  ✅ $1 = $3"; else echo "  ✗ $1 = $2（期望 $3）"; fails=$((fails+1)); fi
}
# ★解析用 sed（首版 grep 的多层转义在嵌套引号下失配 ⇒ 6 条判据全**假红**——
#   本仓纪律：判据红了要先怀疑**装置**，别先怀疑被测对象）
get() { printf '%s' "$OUT" | sed -n "s/.*\"$1\":[[:space:]]*\([^,}]*\).*/\1/p" | head -1 | tr -d '"' | tr -d ' '; }
check "engine_available" "$(get engine_available)" "true"
check "eval_ok" "$(get eval_ok)" "true"
check "batch_ok" "$(get batch_ok)" "true"
check "host_post_count" "$(get host_post_count)" "1"
check "batch_call_kind" "$(get batch_call_kind)" "mount"
check "batch_op_count" "$(get batch_op_count)" "4"

echo ""
if [ "$fails" -gt 0 ]; then
  echo "✗ S3 最小闭环未通过（$fails 条判据失败）"
  exit 1
fi
echo "✅ S3 最小闭环通过：QuickJS 引擎 → JNI 桥 → 宿主回调（1 次 mount · 4 个 op 内容正确）"
echo "  ★边界：本闭环证明**链路通**；把真实 esbuild bundle（render-backend IIFE）接进来是同一接口的下一次调用（S3b）。"

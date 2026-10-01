#!/usr/bin/env bash
# hosts/android/check-host-compile.sh —— ★Android 宿主的**编译检查**（零设备、零 Gradle）
#
# 【为什么需要（与 iOS `check-selfdraw-compile.sh` 同源的覆盖盲区）】
#   `build-and-run.sh` 是**唯一**编译 `app/src/main/java/dev/proteus/layoutcore/*.java` 的入口，
#   而它需要真机/模拟器（装 APK 才算"验过"）。⇒ 后果：**改宿主 Java 代码后，
#   本地没有任何判据证明它能编译**——只能靠"装了才知道"。
#   实测触发场景：卡 I2 给宿主去舍入（`ProteusHostView.Math.round` → 无损转换）时。
#
# 【本脚本做什么】只用 SDK 的 `android.jar` 做 `javac` 编译（**不产 APK、不装设备、不跑 d8**）：
#   类型错误（含 `Math.round` 拼错、`RectF` 用错）本地即暴露。
#
# 【诚实边界】只做**编译**，不做链接/打包/R8/资源——那些是 `build-and-run.sh` 的事。
#   若哪天宿主动用了需要额外 jar 的 API，本脚本会红，届时按需补 classpath。
#
# 用法：bash hosts/android/check-host-compile.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SRC_DIR="$HERE/app/src/main/java/dev/proteus/layoutcore"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

[ -d "$SRC_DIR" ] || { echo "✗ 找不到宿主源码目录：$SRC_DIR"; exit 2; }

# ── 工具链探测（★顺序：先本仓 .tools，再环境变量，再常见位置——与 build-and-run.sh 同口径）──
JDK="${JAVA_HOME:-}"
if [ -z "$JDK" ] || [ ! -x "$JDK/bin/javac" ]; then
  for cand in "$ROOT/.tools/jdk17" "$ROOT/.tools/jdk-17.0.20.1+1/Contents/Home"; do
    if [ -x "$cand/bin/javac" ]; then JDK="$cand"; break; fi
  done
fi
[ -n "$JDK" ] && [ -x "$JDK/bin/javac" ] || { echo "✗ 找不到 javac（设 JAVA_HOME 或确认 .tools/jdk17）"; exit 2; }

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
PLATFORMS="$SDK/platforms"
ANDROID_JAR=""
# 取已安装平台里版本号最大的（与 build-and-run.sh 的探测意图一致）
if [ -d "$PLATFORMS" ]; then
  ANDROID_JAR="$(ls -d "$PLATFORMS"/android-* 2>/dev/null | sort -V | tail -1)/android.jar"
fi
[ -f "$ANDROID_JAR" ] || { echo "✗ 找不到 android.jar（SDK platforms 未装？looked: ${PLATFORMS}）"; exit 2; }

echo "==> 编译检查 Android 宿主（javac · 零设备）"
echo "    JDK: $JDK"
echo "    android.jar: $ANDROID_JAR"

# ★★判据必须是 **javac 自己的退出码**（2026-10-01 实测的假绿 bug）：
#   旧写法 `javac ... | grep -v ... || true` 把 javac 退出码**吞掉**，随后只查
#   `ProteusHostView.class` 是否存在——javac 在个别文件报错时**仍会为无错文件写 class**
#   ⇒ 有编译错照样 ✅。实测影响：MainActivity 变量名冲突（`se` 重复定义）未被拦，
#   打出的 APK 不含新测试组，真机跑完判据全缺——"假绿门禁"比没有门禁更贵（排查一轮）。
JAVAC_LOG="$OUT/javac.log"
if ! "$JDK/bin/javac" -nowarn -encoding UTF-8 -d "$OUT" -cp "$ANDROID_JAR" \
    $(find "$SRC_DIR" -name '*.java') > "$JAVAC_LOG" 2>&1; then
  grep -vE '^注:|^Note:|使用或覆盖了已过时的 API|uses or overrides a deprecated API|unchecked|deprecat' "$JAVAC_LOG" || true
  echo "✗ javac 编译失败（退出码非 0，见上方输出）"
  exit 1
fi
grep -vE '^注:|^Note:|使用或覆盖了已过时的 API|uses or overrides a deprecated API|unchecked|deprecat' "$JAVAC_LOG" || true

# 纵深防御（javac 退出码已是主判据，这条只防"退出码 0 但产物缺失"的异常）
if [ ! -f "$OUT/dev/proteus/layoutcore/ProteusHostView.class" ]; then
  echo "✗ javac 退出码为 0 但未产出 ProteusHostView.class —— 工具链异常（见上方输出）"
  exit 1
fi

echo "✅ Android 宿主编译通过（改动 layoutcore/*.java 后先跑本脚本，再上真机）"

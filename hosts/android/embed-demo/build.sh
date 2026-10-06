#!/usr/bin/env bash
# hosts/android/embed-demo/build.sh —— ★★HA5：**客户 App 嵌入 demo** 的构建与真机运行
#
# 【这个 demo 的角色（模拟第三方 App）】
#   · 包名 `dev.proteus.demo`（**独立于** Proteus 自己的宿主 `dev.proteus.layoutcore`）
#   · 只消费 `platform/android/build/proteus-sdk.aar`（**二进制集成**，方案 §8.2 的 v1 形态）：
#     `classes.jar` + `jni/arm64-v8a/libproteus_jni.so` 就是它对 Proteus 的**全部依赖**
#   ⇒ "客户不用推翻现有 App 就能试用"由此**可执行地**证明，而不是靠文档声称。
#
# 【为什么手工打包（不用 Gradle）】同本仓既有哲学：目标是"链路能否跑通"，Gradle 会引入
#   AGP/版本矩阵等与验证无关的变量。AAR 消费其实很简单：解包 → 编译 → dex → 打包。
#   ★真实客户会用 Gradle（`implementation files('libs/proteus-sdk.aar')`）——那一步由客户做，
#     本脚本证明的是"**AAR 的内容完备**"（解包后的四样东西足以构建出可运行 App）。
#
# 用法：
#   bash hosts/android/embed-demo/build.sh              # 构建 + 安装 + 触发 + 取报告
#   bash hosts/android/embed-demo/build.sh --no-install  # 只构建 APK
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
BUILD="$HERE/build"
AAR="$ROOT/platform/android/build/proteus-sdk.aar"
APK="$BUILD/proteus-embed-demo.apk"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)"
PLATFORM="$(ls -d "$SDK"/platforms/android-* 2>/dev/null | sort -V | tail -1)/android.jar"
ADB="$SDK/platform-tools/adb"
NO_INSTALL="${1:-}"

[ -f "$PLATFORM" ] || { echo "✗ 缺 android.jar：$PLATFORM"; exit 2; }

echo "==> ① 准备 AAR（**源更新则重建**——陈旧产物会让"改 SDK 没生效"静默发生）"
# ★为什么不是"不存在才建"（本轮实测的缺陷）：改了 SDK 门面（加 `animStart`）后直接跑本脚本，
#   它复用了**旧 AAR** ⇒ demo 编译失败在"找不到符号"上，而根因是产物陈旧。
#   ⇒ 判据：AAR 存在 **且** 比全部 SDK/JNI 源都新，才复用；否则重建。
AAR_STALE=0
if [ ! -f "$AAR" ]; then
  AAR_STALE=1
else
  NEWER="$(find "$ROOT/platform/android/proteus-sdk/src" "$ROOT/platform/android/proteus-jni/src" \
      -name '*.java' -o -name '*.rs' -newer "$AAR" 2>/dev/null | head -1)"
  [ -n "$NEWER" ] && AAR_STALE=1
fi
if [ "$AAR_STALE" = "1" ]; then
  echo "    重建 AAR（源比产物新）..."
  bash "$ROOT/platform/android/build-aar.sh" | tail -2
fi
[ -f "$AAR" ] || { echo "✗ 无 AAR：$AAR"; exit 2; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
(cd "$WORK" && unzip -qo "$AAR") || { echo "✗ AAR 解包失败"; exit 3; }
[ -f "$WORK/classes.jar" ] || { echo "✗ AAR 里没有 classes.jar（内容不完备）"; exit 3; }
[ -f "$WORK/jni/arm64-v8a/libproteus_jni.so" ] || { echo "✗ AAR 里没有 .so（内容不完备）"; exit 3; }
echo "    AAR 解包 ✓（classes.jar + jni/arm64-v8a/*.so）"

echo "==> ② 编译 demo Java（classpath = android.jar + AAR 的 classes.jar）"
mkdir -p "$BUILD/classes"
JDK="${JAVA_HOME:-}"
for cand in "$ROOT/.tools/jdk17" "$ROOT/.tools/jdk-17.0.20.1+1/Contents/Home"; do
  [ -x "$cand/bin/javac" ] && JDK="$cand" && break
done
[ -n "$JDK" ] && [ -x "$JDK/bin/javac" ] || { echo "✗ 找不到 javac"; exit 2; }
# ★★必须 export JAVA_HOME：d8 / aapt2 / apksigner 都是**脚本**，内部 spawn java 并按 JAVA_HOME（或系统 java）
#   查找运行时——本机无系统 java ⇒ 不 export 会报 "Unable to locate a Java Runtime"（d8 未产出 classes.dex）。
export JAVA_HOME="$JDK"
rm -rf "$BUILD/classes"; mkdir -p "$BUILD/classes"
"$JDK/bin/javac" -nowarn -encoding UTF-8 \
  -cp "$PLATFORM:$WORK/classes.jar" -d "$BUILD/classes" \
  $(find "$HERE/src" -name '*.java') 2>&1 | head -10
[ -f "$BUILD/classes/dev/proteus/demo/MainActivity.class" ] || { echo "✗ demo 编译失败"; exit 3; }
echo "    ✓ demo 编译通过（它只看到 AAR 的 API）"

echo "==> ③ dex（demo classes + AAR classes.jar 一起）"
mkdir -p "$BUILD/dex"; rm -f "$BUILD/dex"/*.dex
"$BT/d8" --release --min-api 24 --lib "$PLATFORM" --output "$BUILD/dex" \
  "$WORK/classes.jar" $(find "$BUILD/classes" -name '*.class') 2>&1 | head -10
[ -f "$BUILD/dex/classes.dex" ] || { echo "✗ d8 未产出 classes.dex"; exit 3; }

echo "==> ④ 打包 APK（aapt2 link → 追加 dex 与 .so → zipalign → 签名）"
mkdir -p "$BUILD"
rm -f "$APK"
"$BT/aapt2" link -o "$APK" -I "$PLATFORM" --manifest "$HERE/AndroidManifest.xml" \
  --min-sdk-version 24 --target-sdk-version 34 2>&1 | head -5
(cd "$BUILD" && zip -q -j "$APK" dex/classes.dex)
mkdir -p "$BUILD/lib/arm64-v8a"
cp "$WORK/jni/arm64-v8a/libproteus_jni.so" "$BUILD/lib/arm64-v8a/libproteus_jni.so"
(cd "$BUILD" && zip -q -0 "$APK" lib/arm64-v8a/libproteus_jni.so)
# 16 KB 存储对齐（Android 15+；顺序必须是 对齐 → 签名）
ZIPALIGN=""
for d in "$SDK"/build-tools/*/; do [ -x "${d}zipalign" ] && ZIPALIGN="${d}zipalign" && break; done
[ -n "$ZIPALIGN" ] || { echo "✗ 找不到 zipalign"; exit 3; }
"$ZIPALIGN" -f 16384 "$APK" "$APK.aligned" && mv "$APK.aligned" "$APK" \
  || { echo "✗ zipalign 失败"; exit 3; }
KS="$ROOT/hosts/android/build/debug.keystore"
[ -f "$KS" ] || "$JDK/bin/keytool" -genkeypair -keystore "$KS" -storepass android -keypass android \
  -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -keysize 2048 -validity 10000 >/dev/null 2>&1
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --v1-signing-enabled true --v2-signing-enabled true "$APK" 2>&1 | head -5

# ★APK 产物断言（"装到设备才发现空包"是最贵的一类返工）
LIST="$(unzip -l "$APK" 2>/dev/null)"
for entry in "classes.dex" "lib/arm64-v8a/libproteus_jni.so"; do
  printf '%s' "$LIST" | grep -q "$entry" || { echo "✗ APK 缺 $entry"; exit 3; }
done
echo "    ✓ APK 产物齐备（$(( $(stat -f%z "$APK") / 1024 ))KB）"

if [ "$NO_INSTALL" = "--no-install" ]; then
  echo "✅ 构建完成（--no-install）：$APK"; exit 0
fi

echo "==> ⑤ 安装 + 触发 + 取报告（事件驱动：广播触发，不等固定时长）"
"$ADB" wait-for-device
# ★不加 `-g`：该 flag 需要 INSTALL_GRANT_RUNTIME_PERMISSIONS 权限，本机实测被拒
#   （`java.lang.SecurityException: You need the android.permission.INSTALL_GRANT_RUNTIME_PERMISSIONS`）
#   本 demo 不申请运行时权限 ⇒ 不需要它。
"$ADB" install -r -t "$APK" 2>&1 | tail -2
PKG="dev.proteus.demo"
"$ADB" shell "rm -f /sdcard/Android/data/$PKG/files/embed-demo.json"
"$ADB" shell am force-stop "$PKG"
"$ADB" shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
# ★条件等待（本仓红线：禁止 sleep 盲等）——等"App 起来"用 am 的返回、等报告用文件判据
bash "$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh" \
  --cmd "\"$ADB\" shell pm list packages | grep -q $PKG" --timeout 30 --interval 2 >/dev/null 2>&1
"$ADB" shell am broadcast -a dev.proteus.embed.RUN >/dev/null 2>&1
if ! bash "$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh" \
    --cmd "\"$ADB\" shell test -f /sdcard/Android/data/$PKG/files/embed-demo.json" \
    --timeout 60 --interval 2 >/dev/null 2>&1; then
  echo "✗ 报告未出现（60s）——看 logcat：$ADB logcat -d | grep -i proteus | tail -20"
  exit 4
fi
mkdir -p "$ROOT/hosts/android/results"
"$ADB" pull "/sdcard/Android/data/$PKG/files/embed-demo.json" "$ROOT/hosts/android/results/" 2>&1 | tail -1
echo
python3 "$HERE/check-embed-demo.py" "$ROOT/hosts/android/results/embed-demo.json"

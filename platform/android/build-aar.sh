#!/usr/bin/env bash
# platform/android/build-aar.sh —— ★★HA5：把 Proteus 打成 **AAR**（客户 App 二进制嵌入）
#
# 【为什么要有它（方案 §8.1/§8.2 的核心收益）】有了 AAR，Proteus 不再是"必须重建整个 App"，
#   而是**可以作为 SDK 嵌进客户已有的原生 App**——某个页面用 Proteus，其余保持原生。
#   这是推广路径上最关键的一步：让客户不用推翻现有 App 就能试用。
#   （对标 Flutter Add-to-App 的**二进制集成**：客户无需装 Proteus 工具链。）
#
# 【AAR 里装什么（四样，缺一不可）】
#   AndroidManifest.xml   —— 清单（minSdk 等）
#   classes.jar           —— Java 门面（ProteusEngine / ProteusHost）
#   jni/<abi>/*.so        —— native 库（**必须 16 KB 对齐**：Android 15+ 的硬要求）
#   R.txt                 —— 资源符号表（本 SDK 无资源，仍按 AAR 规范给空表）
#
# 【★为什么不用 Gradle】与本仓既有宿主脚本同款哲学（见 hosts/android/README.md）：
#   目标是"链路能否跑通 + 数字是否可信"，Gradle 会引入 AGP/版本矩阵/仓库配置等**与验证无关的变量**。
#   AAR 的格式很简单（就是个 zip），手工打反而**可控且可断言**。
#
# 【判据（跑完自动断言，任一不满足即失败）】
#   ① zip 里有 AndroidManifest.xml / classes.jar / jni/arm64-v8a/libproteus_jni.so
#   ② classes.jar 里含 ProteusEngine.class 与 ProteusHost.class
#   ③ .so 的 LOAD 段全 16 KB 对齐（`-z max-page-size=16384`，见 platform/.../.cargo/config.toml）
#   ④ .so 里**两类符号都在**：内核 ABI（Java_dev_proteus_layoutcore_*）与 Host ABI
#      （Java_dev_proteus_sdk_ProteusEngine_*）—— 只看文件在不在会被"空 .so"骗过
#
# 用法：bash platform/android/build-aar.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT_DIR="$HERE/build"
AAR="$OUT_DIR/proteus-sdk.aar"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)"
JNI_CRATE="$HERE/proteus-jni"
SDK_SRC="$HERE/proteus-sdk/src"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/spike/target}"

echo "==> ① 交叉编译 native 库（aarch64-linux-android；内核 + Host ABI 同一个 .so）"
TOOLS="$ROOT/.tools"
NDK="$TOOLS/ndk"
[ -d "$NDK" ] || { echo "✗ 缺 NDK：$NDK"; exit 2; }
HOST_TAG="$(ls "$NDK/toolchains/llvm/prebuilt" | head -1)"
LINKER="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin/aarch64-linux-android24-clang"
[ -x "$LINKER" ] || { echo "✗ 找不到 NDK clang：$LINKER"; exit 2; }
export PATH="$HOME/.cargo/bin:$PATH"
export CC_aarch64_linux_android="$LINKER"
export CXX_aarch64_linux_android="${LINKER%clang}clang++"
export AR_aarch64_linux_android="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin/llvm-ar"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$LINKER"
(cd "$JNI_CRATE" && cargo build --release --target aarch64-linux-android 2>&1 | grep -E "^error" -A 5 || true)
SO="$CARGO_TARGET_DIR/aarch64-linux-android/release/libproteus_jni.so"
[ -f "$SO" ] || { echo "✗ 未生成 .so：$SO"; exit 3; }
echo "    .so $(du -h "$SO" | awk '{print $1}')"

echo "==> ② 编译 Java 门面 → classes.jar"
mkdir -p "$WORK/classes"
JDK="${JAVA_HOME:-}"
for cand in "$ROOT/.tools/jdk17" "$ROOT/.tools/jdk-17.0.20.1+1/Contents/Home"; do
  [ -x "$cand/bin/javac" ] && JDK="$cand" && break
done
[ -n "$JDK" ] && [ -x "$JDK/bin/javac" ] || { echo "✗ 找不到 javac（设 JAVA_HOME 或确认 .tools/jdk17）"; exit 2; }
# ★Java 门面**零 Android 依赖**（只用 java.*）⇒ 用普通 javac 即可，无需 android.jar
#   （这本身是个设计信号：SDK 的门面不该依赖平台 API，否则客户在单元测试里都用不了）
"$JDK/bin/javac" -nowarn -encoding UTF-8 -d "$WORK/classes" $(find "$SDK_SRC" -name '*.java') || {
  echo "✗ Java 门面编译失败"; exit 3; }
(cd "$WORK/classes" && "$JDK/bin/jar" cf "$WORK/classes.jar" .) || { echo "✗ jar 打包失败"; exit 3; }
echo "    classes.jar $(du -h "$WORK/classes.jar" | awk '{print $1}')"

echo "==> ③ 组装 AAR（zip；四样：manifest / classes.jar / jni / R.txt）"
mkdir -p "$WORK/aar/jni/arm64-v8a"
cat > "$WORK/aar/AndroidManifest.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<!-- Proteus SDK (Host ABI) —— 客户 App 引入后直接使用 dev.proteus.sdk.ProteusEngine -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="dev.proteus.sdk">
    <uses-sdk android:minSdkVersion="24" />
</manifest>
XML
: > "$WORK/aar/R.txt"   # 本 SDK 无资源；按 AAR 规范给空表
cp "$WORK/classes.jar" "$WORK/aar/classes.jar"
cp "$SO" "$WORK/aar/jni/arm64-v8a/libproteus_jni.so"

mkdir -p "$OUT_DIR"
rm -f "$AAR"
(cd "$WORK/aar" && zip -q -r "$AAR" .) || { echo "✗ AAR 打包失败"; exit 3; }

echo "==> ④ 断言（四条；任一不过即失败）"
FAILS=0
LIST="$(unzip -l "$AAR" 2>/dev/null)"
for entry in "AndroidManifest.xml" "classes.jar" "jni/arm64-v8a/libproteus_jni.so" "R.txt"; do
  if printf '%s' "$LIST" | grep -q "$entry"; then
    echo "    ✓ AAR 含 $entry"
  else
    echo "    ✗ AAR 缺 $entry"; FAILS=$((FAILS + 1))
  fi
done
# ② classes.jar 里必须有门面类（"jar 在但类是空的"要能抓到）
CJ_LIST="$("$JDK/bin/jar" tf "$WORK/classes.jar" 2>/dev/null)"
for cls in "dev/proteus/sdk/ProteusEngine.class" "dev/proteus/sdk/ProteusHost.class"; do
  if printf '%s' "$CJ_LIST" | grep -q "$cls"; then
    echo "    ✓ classes.jar 含 $(basename "$cls")"
  else
    echo "    ✗ classes.jar 缺 $cls"; FAILS=$((FAILS + 1))
  fi
done
# ③ 16 KB 对齐（Android 15+ 硬要求）
READELF="$(ls "$NDK"/toolchains/llvm/prebuilt/*/bin/llvm-readelf 2>/dev/null | head -1)"
if [ -n "$READELF" ] && [ -x "$READELF" ]; then
  BAD="$("$READELF" -l "$SO" 2>/dev/null | awk '/^  LOAD/ { print $NF }' | grep -v '^0x4000$' | head -1)"
  if [ -z "$BAD" ]; then
    echo "    ✓ .so LOAD 段全 16 KB 对齐"
  else
    echo "    ✗ .so 有非 0x4000 的 LOAD 段（对齐不足 ⇒ Android 15+ 加载失败）"; FAILS=$((FAILS + 1))
  fi
fi
# ④ 两类符号都在（只看文件在不在会被"空 .so"骗过）
NM="$(ls "$NDK"/toolchains/llvm/prebuilt/*/bin/llvm-nm 2>/dev/null | head -1)"
if [ -n "$NM" ] && [ -x "$NM" ]; then
  N_KERNEL="$("$NM" -D --defined-only "$SO" 2>/dev/null | grep -c 'Java_dev_proteus_layoutcore_RustLayout' || true)"
  N_HOST="$("$NM" -D --defined-only "$SO" 2>/dev/null | grep -c 'Java_dev_proteus_sdk_ProteusEngine' || true)"
  N_ONLOAD="$("$NM" -D --defined-only "$SO" 2>/dev/null | grep -c 'JNI_OnLoad' || true)"
  if [ "$N_KERNEL" -ge 20 ] && [ "$N_HOST" -ge 10 ] && [ "$N_ONLOAD" -ge 1 ]; then
    echo "    ✓ .so 符号齐备：内核 ABI $N_KERNEL · Host ABI $N_HOST · JNI_OnLoad $N_ONLOAD"
  else
    echo "    ✗ .so 符号不足：内核 $N_KERNEL（应 ≥20）· Host ABI $N_HOST（应 ≥10）· JNI_OnLoad $N_ONLOAD"
    FAILS=$((FAILS + 1))
  fi
fi

echo
if [ "$FAILS" -eq 0 ]; then
  echo "✅ AAR 产出通过（$AAR · $(du -h "$AAR" | awk '{print $1}')）"
  echo "   客户接入：① 把 AAR 放进 libs/；② 实现 ProteusHost；③ ProteusEngine.create(host)"
  echo "   接入文档：docs/proteus-host-abi-integration.md"
else
  echo "✗ AAR 有 $FAILS 项断言失败"
  exit 1
fi

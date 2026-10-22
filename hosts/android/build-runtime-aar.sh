#!/usr/bin/env bash
# hosts/android/build-runtime-aar.sh —— ★★★hosts 第四刀：把 Android **runtime 抽为可依赖单元（AAR）**
#
# 【为什么（用户 2026-10-05「宿主里项目信息与项目无关抽象混在一起」）】
#   与鸿蒙 HAR（#564）/ iOS 源集（#565）同源：让"渲染运行时"成为**可依赖单元**，
#   使 CLI 能生成最小宿主（`proteus create host android`）并由 `build --package` 打成 APK。
#
# 【★形态 = AAR · 保持同 Java 包（`dev.proteus.layoutcore`）】
#   运行时的 11 个类虽在 `.../java/dev/proteus/layoutcore/runtime/` 目录下，**包名仍是
#   `dev.proteus.layoutcore`**（同包 + 源码分目录，见 hosts/README-LAYERS.md）。
#   ⇒ 打进 AAR 后，消费壳（同包名）仍可访问包私有成员——**零可见性改动**
#   （对比：换包名会逼 ~93 处 public 化，见决策 #563）。这正是"保持同包"的全部意义。
#
# 【AAR 里装什么（四样，与 platform/android/build-aar.sh 同规格）】
#   AndroidManifest.xml（package dev.proteus.layoutcore, minSdk 24）
#   classes.jar          —— runtime 11 类（只依赖 android.jar，无第三方）
#   jni/<abi>/*.so       —— native（libproteus_jni.so 必带；libquickjs_jni/wasm 若在本机则随附）
#   R.txt                —— 空资源表（按 AAR 规范）
#
# 用法：bash hosts/android/build-runtime-aar.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RT_SRC="$HERE/app/src/main/java/dev/proteus/layoutcore/runtime"
OUT_DIR="$HERE/build"
AAR="$OUT_DIR/proteus-runtime.aar"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
PLATFORM="$(ls -d "$SDK"/platforms/android-* 2>/dev/null | sort -V | tail -1)/android.jar"
[ -f "$PLATFORM" ] || { echo "✗ 缺 android.jar（${PLATFORM}）"; exit 2; }
BT="$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)"

echo "==> ① 交叉编译 native 库（aarch64-linux-android）"
TOOLS="$ROOT/.tools"; NDK="$TOOLS/ndk"
[ -d "$NDK" ] || { echo "✗ 缺 NDK：$NDK"; exit 2; }
HOST_TAG="$(ls "$NDK/toolchains/llvm/prebuilt" | head -1)"
LINKER="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin/aarch64-linux-android24-clang"
[ -x "$LINKER" ] || { echo "✗ 找不到 NDK clang：$LINKER"; exit 2; }
export PATH="$HOME/.cargo/bin:$PATH"
export CC_aarch64_linux_android="$LINKER"
export CXX_aarch64_linux_android="${LINKER%clang}clang++"
export AR_aarch64_linux_android="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin/llvm-ar"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$LINKER"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/spike/target}"
(cd "$ROOT/platform/android/proteus-jni" && cargo build --release --target aarch64-linux-android 2>&1 | grep -E "^error" -A 5 || true)
SO="$CARGO_TARGET_DIR/aarch64-linux-android/release/libproteus_jni.so"
[ -f "$SO" ] || { echo "✗ 未生成 libproteus_jni.so：$SO"; exit 3; }
echo "    libproteus_jni.so $(du -h "$SO" | awk '{print $1}')"

echo "==> ② 编译 runtime Java → classes.jar（-cp android.jar）"
JDK="${JAVA_HOME:-}"
for cand in "$ROOT/.tools/jdk17" "$ROOT/.tools/jdk-17.0.20.1+1/Contents/Home"; do
  [ -x "$cand/bin/javac" ] && JDK="$cand" && break
done
[ -n "$JDK" ] && [ -x "$JDK/bin/javac" ] || { echo "✗ 找不到 javac"; exit 2; }
mkdir -p "$WORK/classes"
# ★★★平台适配层（`platform/android/proteus-platform`：字体/度量——换壳不改）与 runtime **一起编译**
#   （宿主源码引用它；`build-and-run.sh` / `check-host-compile.sh` 同口径）。
#   ★实测教训（2026-10-08）：漏了它 ⇒ `ProteusHostView` 引用 `ProteusTextPlatform` 报 11 个「找不到符号」
#     ⇒ AAR 长期陈旧（不含 SuperappRuntimeHost 等新 runtime 类）而无人察觉。
PLATFORM_JAVA_DIR="$ROOT/platform/android/proteus-platform/src"
find "$RT_SRC" "$PLATFORM_JAVA_DIR" -name '*.java' > "$WORK/srcs.txt" 2>/dev/null
[ -s "$WORK/srcs.txt" ] || { echo "✗ runtime 源为空（${RT_SRC}）"; exit 2; }
# ★★★决策 #1160：第三方运行时依赖（OkHttp/Okio）——runtime 直接引用 okhttp3/okio 类型。
#   ★AAR 必须让**消费方**（CLI 生成的壳）也能编译并运行 ⇒ 第三方 class 要一起进 classes.jar。
#     否则：① CLI 侧 javac 报"找不到符号"；② 侥幸打出 APK 也会在真机 `NoClassDefFoundError`。
#   ★"一起打进去"而不是"让消费方自己引"：宿主构建链是手工 aapt2/javac/d8，没有依赖解析，
#     消费方无从得知需要哪些 jar（这正是 vendor 入库的理由，见 thirdparty/README.md）。
THIRDPARTY_JARS="$(find "$HERE/thirdparty" -name '*.jar' 2>/dev/null | sort)"
[ -n "$THIRDPARTY_JARS" ] || { echo "✗ 缺 thirdparty/*.jar（OkHttp/Okio）——见 hosts/android/thirdparty/README.md"; exit 2; }
THIRDPARTY_CP="$(printf '%s\n' "$THIRDPARTY_JARS" | tr '\n' ':')"
THIRDPARTY_CP="${THIRDPARTY_CP%:}"
"$JDK/bin/javac" -nowarn -encoding UTF-8 --release 17 -cp "$PLATFORM:$THIRDPARTY_CP" -d "$WORK/classes" @"$WORK/srcs.txt" || { echo "✗ runtime 编译失败"; exit 3; }
# ★把第三方 class **解出来**并入 classes.jar（而不是嵌套 jar：AAR 的 classes.jar 必须是扁平 class 集合）
mkdir -p "$WORK/thirdparty-classes"
for jar in $THIRDPARTY_JARS; do
  (cd "$WORK/thirdparty-classes" && "$JDK/bin/jar" xf "$jar") || { echo "✗ 解第三方 jar 失败：$jar"; exit 3; }
done
# ★去掉 META-INF（多个 jar 各有 MANIFEST.MF / 签名文件 ⇒ 合并时互相覆盖，且 dex 不需要它们；
#   第三方签名文件进了 classes.jar 反而会让人误以为是被签过的产物）
rm -rf "$WORK/thirdparty-classes/META-INF"
N_TP="$(find "$WORK/thirdparty-classes" -name '*.class' | wc -l | tr -d ' ')"
cp -R "$WORK/thirdparty-classes/." "$WORK/classes/" || { echo "✗ 合并第三方 class 失败"; exit 3; }
(cd "$WORK/classes" && "$JDK/bin/jar" cf "$WORK/classes.jar" .) || { echo "✗ jar 打包失败"; exit 3; }
echo "    classes.jar $(du -h "$WORK/classes.jar" | awk '{print $1}')（$(find "$WORK/classes" -name '*.class' | wc -l | tr -d ' ') 个 class，含第三方 $N_TP 个）"

echo "==> ③ 组装 AAR（manifest / classes.jar / jni / R.txt）"
mkdir -p "$WORK/aar/jni/arm64-v8a"
cat > "$WORK/aar/AndroidManifest.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<!-- Proteus 渲染运行时（hosts 第四刀）——消费方可同包（dev.proteus.layoutcore）访问其类 -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="dev.proteus.layoutcore">
    <uses-sdk android:minSdkVersion="24" />
</manifest>
XML
: > "$WORK/aar/R.txt"
cp "$WORK/classes.jar" "$WORK/aar/classes.jar"
cp "$SO" "$WORK/aar/jni/arm64-v8a/libproteus_jni.so"
# 可选：本机若已构建 JS 引擎 / wasm，一并随附（运行时单元完整；缺则跳过，诚实标注）
for extra in "libquickjs_jni.so:$HERE/build/js-engine/libquickjs_jni.so" "libproteus_wasm.so:$HERE/build/wasm/libproteus_wasm.so"; do
  name="${extra%%:*}"; path="${extra#*:}"
  if [ -f "$path" ]; then cp "$path" "$WORK/aar/jni/arm64-v8a/$name"; echo "    + 随附 $name"; fi
done

mkdir -p "$OUT_DIR"; rm -f "$AAR"
(cd "$WORK/aar" && zip -q -r "$AAR" .) || { echo "✗ AAR 打包失败"; exit 3; }

echo "==> ④ 断言（任一不过即失败）"
FAILS=0
LIST="$(unzip -l "$AAR" 2>/dev/null)"
for entry in "AndroidManifest.xml" "classes.jar" "jni/arm64-v8a/libproteus_jni.so" "R.txt"; do
  printf '%s' "$LIST" | grep -q "$entry" && echo "    ✓ AAR 含 $entry" || { echo "    ✗ AAR 缺 $entry"; FAILS=$((FAILS + 1)); }
done
CJ_LIST="$("$JDK/bin/jar" tf "$WORK/classes.jar" 2>/dev/null)"
# ★断言含**运行期壳必需类**（2026-10-08 补 SuperappRuntimeHost——它曾是"AAR 陈旧"的漏网证据：
#   CLI 生成的运行期壳引用它，而 AAR 里没有 ⇒ 打包必失败）
for cls in "dev/proteus/layoutcore/VaporRenderHost.class" "dev/proteus/layoutcore/ProteusHostView.class" "dev/proteus/layoutcore/RustLayout.class" "dev/proteus/layoutcore/SuperappRuntimeHost.class" "dev/proteus/layoutcore/QuickJsEngine.class" "dev/proteus/layoutcore/HostBridge.class" "dev/proteus/layoutcore/ScreenHost.class" "dev/proteus/layoutcore/HostCapabilities.class" "dev/proteus/layoutcore/HttpTransport.class" "dev/proteus/platform/ProteusTextPlatform.class"; do
  printf '%s' "$CJ_LIST" | grep -q "$cls" && echo "    ✓ classes.jar 含 $(basename "$cls")" || { echo "    ✗ classes.jar 缺 $cls"; FAILS=$((FAILS + 1)); }
done
# ★★★#1160：第三方依赖必须真的进 AAR（否则 CLI 侧"编译不过"或"真机 NoClassDefFoundError"）
#   ★断言**具体类**而不是 jar 名：AAR 的 classes.jar 是扁平 class 集合，jar 名不存在，
#     只有"类在不在"才是消费方真正需要的性质。
for cls in "okhttp3/OkHttpClient.class" "okhttp3/Dns.class" "okhttp3/EventListener.class" "okio/BufferedSink.class"; do
  printf '%s' "$CJ_LIST" | grep -q "$cls" && echo "    ✓ classes.jar 含第三方 $(basename "$cls")" || { echo "    ✗ classes.jar 缺第三方 ${cls}（OkHttp/Okio 未并入）"; FAILS=$((FAILS + 1)); }
done
READELF="$(ls "$NDK"/toolchains/llvm/prebuilt/*/bin/llvm-readelf 2>/dev/null | head -1)"
if [ -n "$READELF" ] && [ -x "$READELF" ]; then
  BAD="$("$READELF" -l "$SO" 2>/dev/null | awk '/^  LOAD/ { print $NF }' | grep -v '^0x4000$' | head -1)"
  [ -z "$BAD" ] && echo "    ✓ .so LOAD 段全 16 KB 对齐" || { echo "    ✗ .so 有非 0x4000 LOAD 段"; FAILS=$((FAILS + 1)); }
fi
NM="$(ls "$NDK"/toolchains/llvm/prebuilt/*/bin/llvm-nm 2>/dev/null | head -1)"
if [ -n "$NM" ] && [ -x "$NM" ]; then
  N_KERNEL="$("$NM" -D --defined-only "$SO" 2>/dev/null | grep -c 'Java_dev_proteus_layoutcore_RustLayout' || true)"
  N_ONLOAD="$("$NM" -D --defined-only "$SO" 2>/dev/null | grep -c 'JNI_OnLoad' || true)"
  if [ "$N_KERNEL" -ge 20 ] && [ "$N_ONLOAD" -ge 1 ]; then
    echo "    ✓ .so 符号齐备：内核 ABI $N_KERNEL · JNI_OnLoad $N_ONLOAD"
  else
    echo "    ✗ .so 符号不足：内核 ${N_KERNEL}（应 ≥20）· JNI_OnLoad $N_ONLOAD"; FAILS=$((FAILS + 1))
  fi
fi

echo
if [ "$FAILS" -eq 0 ]; then
  echo "✅ runtime AAR 产出通过（$AAR · $(du -h "$AAR" | awk '{print $1}')）"
  # ★★★决策 #666「彻底打通」：同步一份到**随 CLI 发布**的位置——外部用户无框架 checkout 时
  #   `proteus build --package` 回退用它（host-scaffold.resolveRuntimeDirs 的 prebuilt 候选）。
  #   放 prebuilt/（**非** android/libs，避开模板 .gitignore 的 libs/*.aar ⇒ 可入库+入 npm 包）。
  REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  PREBUILT="$REPO_ROOT/packages/cli/templates-host/prebuilt/android"
  mkdir -p "$PREBUILT"
  cp "$AAR" "$PREBUILT/proteus-runtime.aar"
  echo "✅ 随包副本已同步（$PREBUILT/proteus-runtime.aar · $(du -h "$PREBUILT/proteus-runtime.aar" | awk '{print $1}')）"
  # ★★★新鲜度指纹（决策 #721）：记下**本次构建**时 `runtime/*.java` 的内容哈希 ⇒ 门禁
  #   `scripts/check-android-runtime-aar-fresh.mjs` 重算比对，抓"源改了 AAR 没重建"（本仓栽过 2 次）。
  # ★★★#1160：**第三方 jar 也进指纹**（OkHttp/Okio 会并入 classes.jar）——
  #   否则换/升 jar 时 AAR 不判陈旧，消费方拿到旧 jar 里的类。
  #   ★算法必须与 `check-android-runtime-aar-fresh.mjs` 的 `runtimeSourcesHash()` **逐字节一致**
  #     （两处各写一份的代价：改一处忘另一处 ⇒ 门禁永久红，本轮已踩一次）。
  node -e '
    const fs=require("fs"),path=require("path"),crypto=require("crypto");
    const rt=process.argv[1], stamp=process.argv[2], tp=process.argv[3];
    const h=crypto.createHash("sha256");
    const files=fs.readdirSync(rt).filter(f=>f.endsWith(".java")).sort();
    for(const f of files){h.update(f);h.update("\0");h.update(fs.readFileSync(path.join(rt,f)));h.update("\0")}
    const jars=fs.existsSync(tp)?fs.readdirSync(tp).filter(f=>f.endsWith(".jar")).sort():[];
    for(const f of jars){h.update(f);h.update("\0");h.update(fs.readFileSync(path.join(tp,f)));h.update("\0")}
    fs.writeFileSync(stamp,h.digest("hex")+"\n");
  ' "$RT_SRC" "$PREBUILT/proteus-runtime.sources.sha256" "$HERE/thirdparty"
  echo "✅ 源指纹已写入（proteus-runtime.sources.sha256 · 含第三方 jar）"
else
  echo "✗ AAR 有 $FAILS 项断言失败"; exit 1
fi

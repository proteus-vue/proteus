#!/usr/bin/env bash
# hosts/android/build-and-run.sh
# ★★M2 真机验证：构建 APK 并部署到 Android 设备（**不用 Gradle**）
#
# 【为什么手工打包（而不是 Gradle）】
#   本仓的竖切哲学（同 hosts/ios）：目标是「链路能否跑通 + 数字是否可信」，
#   Gradle 会引入 AGP/版本矩阵/仓库配置等与验证无关的变量。手工用 SDK 自带工具链：
#     aapt2（资源+清单编译）→ javac（Kotlin→? 见下）→ d8（dex）→ apksigner → adb install
#   ★诚实边界：本脚本**不编译 Kotlin**（需 kotlinc，本仓未装）——宿主代码用 **Java** 写，
#     javac 在 JDK 里现成。Kotlin 版本（MainActivity.kt / RustLayout.kt）保留作对照阅读，
#     等 M3 接真实构建链时再统一。
#
# 前置：
#   · NDK（编译 Rust → Android）：本仓库位在 .tools/ndk（见 .tools/setup.log）
#   · JDK 17+：本仓库位在 .tools/jdk17
#   · Rust target：rustup target add aarch64-linux-android
#
# 用法：bash hosts/android/build-and-run.sh [--no-install] [--release]
#   --release  ★§9.2 正式验收要求：非 debuggable 包（debug 模式数据无效）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TOOLS="$ROOT/.tools"
APP="$HERE/app"
BUILD="$HERE/build"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
# ★构建产物统一落 spike/target（data1），不写内置盘
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/spike/target}"
ADB="$SDK/platform-tools/adb"
BT="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"

# ── 工具链定位（缺失时给可执行指引，不静默降级）──
[ -d "$TOOLS/ndk" ] || { echo "✗ 缺 NDK：$TOOLS/ndk（先跑 .tools 的安装；见 .tools/setup.log）"; exit 2; }
[ -x "$TOOLS/jdk17/bin/javac" ] || { echo "✗ 缺 JDK 17：$TOOLS/jdk17/bin/javac"; exit 2; }
[ -f "$PLATFORM" ] || { echo "✗ 缺 android.jar：$PLATFORM"; exit 2; }
export JAVA_HOME="$TOOLS/jdk17"
export PATH="$JAVA_HOME/bin:$PATH"

NDK="$TOOLS/ndk"
HOST_TAG="$(ls "$NDK/toolchains/llvm/prebuilt" | head -1)"   # darwin-x86_64 或 darwin-arm64
TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/$HOST_TAG"
# ★API 级别：设备是 API 37，但 NDK r27c 提供的 platform 库最高到 35 —— 用 24（覆盖面广且足够）
API=24
LINKER="$TOOLCHAIN/bin/aarch64-linux-android${API}-clang"
[ -x "$LINKER" ] || { echo "✗ 找不到 NDK clang：$LINKER"; ls "$TOOLCHAIN/bin/" | grep -E "^aarch64-linux-android[0-9]+-clang$" | head -5; exit 2; }

# ★§9.2：正式验收必须 release 包。debuggable 只影响 APK 的 manifest 与 dex 优化级别，
#   Rust 侧始终是 release（见下方 cargo --release）
MODE="debug"
if [ "${1:-}" = "--release" ] || [ "${2:-}" = "--release" ]; then MODE="release"; fi
echo "    构建模式：$MODE$([ "$MODE" = "release" ] && echo "（§9.2 正式验收口径）" || echo "（冒烟用；debug 数据不可作验收）")"

mkdir -p "$BUILD"

echo "==> ① 编译 Rust 核心（aarch64-linux-android release）"
export PATH="$HOME/.cargo/bin:$PATH"
if [ "$(command -v cargo)" != "$HOME/.cargo/bin/cargo" ]; then
  echo "✗ cargo 未解析到 $HOME/.cargo/bin/cargo（本机另有 Homebrew rust，其 toolchain 无 Android target）"
  exit 2
fi
rustup target list --installed | grep -q aarch64-linux-android || {
  echo "✗ 未装 Android target —— 先执行：rustup target add aarch64-linux-android"; exit 2; }

# ★NDK 的 clang 需要显式传给 cargo（否则用系统 clang，链接阶段失败）
export CC_aarch64_linux_android="$LINKER"
export CXX_aarch64_linux_android="${LINKER%clang}clang++"
export AR_aarch64_linux_android="$TOOLCHAIN/bin/llvm-ar"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$LINKER"
(cd "$ROOT/packages/layout-core-rust" && cargo build --release --target aarch64-linux-android)
SO_SRC="$CARGO_TARGET_DIR/aarch64-linux-android/release/libproteus_layout_core.so"
[ -f "$SO_SRC" ] || { echo "✗ 未生成 .so：$SO_SRC"; exit 3; }
echo "    .so $(du -h "$SO_SRC" | awk '{print $1}')"

echo "==> ①.5 生成跨语言夹具（TS 编码 → 冻结进 Java；见 gen-ops-fixture.mjs）"
# ★★为什么必须在这里生成（而不是"构建前手工跑一次"）
#
# 【故障链（本仓踩过同族）】夹具是**产物**，它由 TS 侧的真实编码器/适配器产出。
#   若不在构建时刷新：改了适配器（如 `takeSplice` 形状）后构建**照样成功**，
#   设备却拿着**旧形状**的夹具在跑 ⇒ 用例绿着，而真正的契约早已分叉（= 在测旧产物）。
#   实测先例：build-bench 曾因 `| tail -1` 静默失败，让设备跑了一轮旧 bundle。
#   ⇒ 纪律：**生成物必须在构建路径上**，不能依赖"记得手工跑"。
if ! node "$HERE/gen-ops-fixture.mjs" > "$BUILD/gen-fixture.log" 2>&1; then
  echo "✗ 夹具生成失败 —— 完整输出见 $BUILD/gen-fixture.log："
  tail -20 "$BUILD/gen-fixture.log"
  exit 3
fi
tail -3 "$BUILD/gen-fixture.log" | sed 's/^/    /'

# ★同一纪律适用于 app-4050 夹具（对标基准的场景，真 SFC 编译产物）——
#   它也必须**在构建路径上**刷新，否则改了 SFC/编译器后设备仍跑旧树（"用例绿着、契约已分叉"）。
if ! node "$HERE/gen-app4050-fixture.mjs" > "$BUILD/gen-app4050.log" 2>&1; then
  echo "✗ app-4050 夹具生成失败 —— 完整输出见 $BUILD/gen-app4050.log："
  tail -20 "$BUILD/gen-app4050.log"
  exit 3
fi
tail -2 "$BUILD/gen-app4050.log" | sed 's/^/    /'

echo "==> ② 编译 Java 宿主（javac → .class）"
CLASSES="$BUILD/classes"; rm -rf "$CLASSES"; mkdir -p "$CLASSES"
find "$APP/src/main/java" -name '*.java' > "$BUILD/java-sources.txt"
[ -s "$BUILD/java-sources.txt" ] || { echo "✗ 没找到 Java 源文件"; exit 3; }
# ★JDK 17 起 `-bootclasspath` 只允许配合 `--release`（实测报「目标 17 不允许选项 --boot-class-path」）
#   → 用 `--release 17` 并只给 `-classpath`；android.jar 提供 android.*/org.json.* 等符号
#
# ★★**必须直接取 javac 的退出码**（本仓第二次踩同一类坑：iOS 那次是 `| tail -1`）
#
# 【故障链（2026-09-29 实测）】原写法
#       javac ... 2>&1 | grep -v "^Note:" | head -20 || true
#   三个缺陷叠加：① 管道退出码是 **head** 的（恒 0）② `|| true` 再把结果丢掉
#   ③ 兜底判据 `[ -d "$CLASSES/dev" ]` 只查**目录存在**——而 javac **部分成功**时
#      仍会建出 `dev/` 目录 ⇒ 判据通过 ⇒ **编译失败照样打包 APK**。
#   实测现象：报「找不到符号」却继续走完 ③④⑤⑥⑦ 打出 APK —— 等于在测旧产物（白跑一轮）。
#   ⇒ 正解：输出落盘 + `if ! javac …`（`set -e` 下唯一可靠的形态）。
if ! javac --release 17 -classpath "$PLATFORM" \
     -d "$CLASSES" @"$BUILD/java-sources.txt" > "$BUILD/javac.log" 2>&1; then
  echo "✗ javac 失败 —— 完整输出见 $BUILD/javac.log（末尾 20 行如下）："
  grep -v "^注:" "$BUILD/javac.log" | tail -20
  exit 3
fi
grep -v "^注:" "$BUILD/javac.log" | head -5 || true
[ -d "$CLASSES/dev" ] || { echo "✗ javac 退出码 0 但未产出 class（配置异常？）"; exit 3; }
echo "    class 文件 $(find "$CLASSES" -name '*.class' | wc -l | tr -d ' ') 个"

echo "==> ②.5 构建并准备 JS bundle（S3b：真实适配器）"
# ★bundle 进 **assets**（aapt2 用 `-A <assets dir>` 打进 APK）——Java 侧经 AssetManager 读源码字符串
#   交给 QuickJS eval。为什么不用 raw 资源：assets 不参与资源 ID 编译，读取路径最直接。
BUNDLE="$HERE/bridge/dist/bundle-batch.js"
# ★自动构建（若缺）——本仓纪律「生成物必须在**构建路径**上」：
#   不入库 ⇒ 必须有自动生成路径，否则 clone 后这一步静默跳过（bundle 缺失 ⇒ 测试路径不可用）
if [ ! -f "$BUNDLE" ]; then
  echo "    未找到 bundle ⇒ 自动构建 …"
  node "$HERE/bridge/build-batch.mjs" 2>&1 | sed 's/^/    /' || true
fi
if [ -f "$BUNDLE" ]; then
  mkdir -p "$APP/src/main/assets"
  cp "$BUNDLE" "$APP/src/main/assets/bundle-batch.js"
  echo "    bundle-batch.js 已入 assets（$(du -h "$BUNDLE" | awk '{print $1}')）"
else
  echo "    ⚠ 未见 $BUNDLE —— 先跑：node hosts/android/bridge/build-batch.mjs"
  echo "      （不阻断构建：缺它只影响 js-batch 测试路径）"
fi

echo "==> ③ 打包资源与清单（aapt2）"
MANIFEST="$APP/src/main/AndroidManifest.xml"
if [ "$MODE" = "release" ]; then
  # ★release：从清单里去掉 android:debuggable（debug 包数据 §9.2 明确作废）
  MANIFEST="$BUILD/AndroidManifest.release.xml"
  sed 's/ *android:debuggable="true"//' "$APP/src/main/AndroidManifest.xml" > "$MANIFEST"
  grep -q debuggable "$MANIFEST" && { echo "✗ release 清单仍含 debuggable"; exit 3; }
fi
APK="$BUILD/proteus-layoutcore.apk"
rm -f "$APK"
"$BT/aapt2" link -o "$APK" -I "$PLATFORM" \
  --manifest "$MANIFEST" \
  --min-sdk-version 24 --target-sdk-version 34 \
  -A "$APP/src/main/assets" \
  --java "$BUILD/gen" 2>&1 | head -10

echo "==> ④ dex（d8）"
# ★d8 要求输出目录**已存在**（否则 "Invalid output"，实测踩到）
mkdir -p "$BUILD/dex"; rm -f "$BUILD/dex"/*.dex
"$BT/d8" --release --min-api 24 --lib "$PLATFORM" \
  --output "$BUILD/dex" $(find "$CLASSES" -name '*.class') 2>&1 | head -10
[ -f "$BUILD/dex/classes.dex" ] || { echo "✗ d8 未产出 classes.dex"; exit 3; }

echo "==> ⑤ 组装 APK（加入 dex 与 native 库）"
# aapt2 link 只产出资源；用 zip 追加 dex 与 .so（jniLibs 布局：lib/<abi>/lib*.so）
(cd "$BUILD" && zip -q -j "$APK" dex/classes.dex)
mkdir -p "$BUILD/lib/arm64-v8a"
cp "$SO_SRC" "$BUILD/lib/arm64-v8a/libproteus_layout_core.so"
# ★`-0` = Stored（不压缩）：16 KB page size 要求 .so 可直接 mmap（压缩的必须先解压到磁盘）
(cd "$BUILD" && zip -q -0 "$APK" lib/arm64-v8a/libproteus_layout_core.so)

# ★S2：JS 引擎（QuickJS JNI 桥）——由 scripts/setup-android-js-engine.sh 产出
#   【为什么可选】引擎缺失时 QuickJsEngine.isAvailable()=false，宿主给出明确提示（不崩）
#   —— 与 Rust .so 不同：JS 引擎是**新增能力**（此前 Android 无 JS），缺它不影响既有测试路径
JS_SO="$HERE/build/js-engine/libquickjs_jni.so"
if [ -f "$JS_SO" ]; then
  cp "$JS_SO" "$BUILD/lib/arm64-v8a/libquickjs_jni.so"
  (cd "$BUILD" && zip -q -0 "$APK" lib/arm64-v8a/libquickjs_jni.so)
  echo "    JS 引擎 .so 已打入（$(du -h "$JS_SO" | awk '{print $1}')）"
else
  echo "    ⚠ 未找到 JS 引擎 .so（${JS_SO}）——先跑：bash scripts/setup-android-js-engine.sh"
  echo "      （不阻断构建：缺它只影响 js-engine 测试路径，既有路径不受影响）"
fi

# ★★APK 产物断言（2026-09-29 新增：本会话实测到"45 字节 APK 报成功"的静默失败）
#
# 【为什么必须有】此前组装完 APK **不看产物**就进签名/安装 ⇒ 空包（aapt2 失败/残留）
#   也能"构建成功"，直到真机上发现"代码没生效"才暴露——那是最贵的一类返工。
#   判据（三条，任一不满足即中止）：① 文件非空且 ≥ 100KB（含 dex + .so 的下限）
#   ② 含 classes.dex  ③ 含 Rust 核心 .so（JS 引擎 .so 可选——它是新增能力）
APK_BYTES=$(stat -f%z "$APK" 2>/dev/null || echo 0)
if [ "$APK_BYTES" -lt 100000 ]; then
  echo "✗ APK 产物异常：仅 ${APK_BYTES} 字节（预期 ≥100KB）——组装失败（见上方 aapt2/zip 输出）"
  exit 3
fi
# ★★判据写成"先取输出再匹配"（**不能用 `unzip … | grep -q`**）——本仓实测的 shell 陷阱：
#   `set -o pipefail` 下，`grep -q` **找到即退出** ⇒ 上游 `unzip` 收 SIGPIPE ⇒ 管道整体非 0
#   ⇒ `if !` 判为"失败" ⇒ **明明有条目却报缺失**（本轮实测：手动执行同命令成功、脚本内失败，
#   差异就在 pipefail）。⇒ 正解：把输出**先落变量**，再对变量做匹配（无管道、无信号竞争）。
APK_LISTING="$(unzip -l "$APK" 2>/dev/null)"
for entry in "classes.dex" "lib/arm64-v8a/libproteus_layout_core.so"; do
  if ! printf '%s' "$APK_LISTING" | grep -q "$entry"; then
    echo "✗ APK 缺条目：${entry}（产物不完整，装到设备会 UnsatisfiedLinkError / 类缺失）"
    exit 3
  fi
done
echo "    产物断言通过：${APK_BYTES} 字节 · classes.dex ✓ · Rust 核心 .so ✓"

# ★★16 KB page size 对齐（2026-09-29 新增：用户真机实测反馈「so 库都没做 16 KB 对齐」）
#
# 【为什么必须在签名**之前**】zipalign 会重写 zip（改偏移/压缩方式）
#   ⇒ 任何字节改动都让签名失效 ⇒ **顺序必须是 对齐 → 签名**（与 Android 官方推荐一致）。
#
# 【判据】`.so` 必须 ① 不压缩（Stored，否则 loader 无法直接 mmap）
#   ② 数据起始偏移 16 KB 对齐。
#   官方工具 `zipalign -P 16` 需 **build-tools 35+**（本机实测只有 34.0.0，`-P` 不存在）
#   ⇒ 用本仓等价实现 `hosts/android/zipalign16.py`（纯标准库，见其文件头）。
echo "==> ⑤.5 16 KB 对齐（Android 15+ 要求）"
# ★用官方 `zipalign`：**对齐值是参数**（`zipalign <align>`）⇒ 可直接传 16384
#   （本仓实测：`zipalign -P 16` 需 build-tools 35+，但 `<align>` 形式在 34 上就能用 16384）
#   ⇒ 无需手写 zip 重写（首版自研实现曾破坏 aapt2 的 resources.arsc 4 字节对齐 ⇒ 装不上）
ZIPALIGN=""
for d in "$SDK"/build-tools/*/; do [ -x "${d}zipalign" ] && ZIPALIGN="${d}zipalign" && break; done
if [ -z "$ZIPALIGN" ]; then
  echo "✗ 找不到 zipalign（$SDK/build-tools/*）——无法做 16 KB 对齐"
  exit 3
fi
ALIGNED="$BUILD/proteus-layoutcore-aligned.apk"
if "$ZIPALIGN" -f 16384 "$APK" "$ALIGNED" >/dev/null 2>&1; then
  mv "$ALIGNED" "$APK"
  # ★自校验（对齐是"能变红"的判据：用 python 读真实 local header 算数据起始）
  if python3 "$HERE/check-apk-align16.py" "$APK" >/dev/null 2>&1; then
    echo "    16 KB 对齐完成（$(basename "$ZIPALIGN") · 自校验通过）"
  else
    echo "✗ 16 KB 对齐自校验失败——见 python3 hosts/android/check-apk-align16.py \"$APK\""
    exit 3
  fi
else
  echo "✗ zipalign 失败（$ZIPALIGN 16384）"
  exit 3
fi

echo "==> ⑥ 签名（apksigner + debug keystore）"
KS="$BUILD/debug.keystore"
if [ ! -f "$KS" ]; then
  # ★标准 debug keystore 参数（Android 生态通用；仅用于本地实验，不入库）
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android \
    -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" \
    -keyalg RSA -keysize 2048 -validity 10000 >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --v1-signing-enabled true --v2-signing-enabled true "$APK" 2>&1 | head -5
"$BT/apksigner" verify --print-certs "$APK" 2>&1 | head -3

echo "==> ⑦ 安装并启动"
if [ "${1:-}" = "--no-install" ]; then
  echo "    跳过安装（--no-install）。APK：$APK"
  exit 0
fi
"$ADB" wait-for-device
"$ADB" install -r -t "$APK" 2>&1 | tail -3
"$ADB" shell am force-stop dev.proteus.layoutcore || true
"$ADB" shell am start -n dev.proteus.layoutcore/.MainActivity 2>&1 | tail -2

cat <<'MSG'

==> ⑧ 取回报告
   sleep 6 && adb shell run-as dev.proteus.layoutcore ls files/
   adb shell run-as dev.proteus.layoutcore cat files/layout-report.txt
   # 或（debug 包可用 run-as；也可直接看日志）
   adb logcat -d -s proteus:I | tail -60
MSG

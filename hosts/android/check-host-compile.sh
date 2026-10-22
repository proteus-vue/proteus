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
# ★HA0.5：平台适配层（字体/度量等，`platform/android`）与宿主源码**一起编译**（宿主引用它）
PLATFORM_JAVA_DIR="$ROOT/platform/android/proteus-platform/src"
# ★★CLI 宿主**模板**（`templates-host/android/src`）也一起编译——此前它**无任何本地编译判据**
#   （与 iOS 的 `check-cli-host-compile` 同族盲区）：模板改动只能靠真机打包才暴露编译错。
CLI_TPL_JAVA_DIR="$ROOT/packages/cli/templates-host/android/src"
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
# ★★★决策 #1160：第三方运行时依赖（OkHttp/Okio）——与 `build-and-run.sh` / `build-runtime-aar.sh`
#   **同一份** jar 集合（第三方 jar 已入库 `thirdparty/`，见其中 README 的版本与升级口径）。
#   ★为什么必须在这里也加：本脚本是"改宿主代码后最先跑的零设备判据"，若 classpath 与真机构建
#     不一致 ⇒ 本地全绿、真机 javac 报"找不到符号"（本仓 AAR 陈旧事故的同族）。
THIRDPARTY_JARS="$(find "$HERE/thirdparty" -name '*.jar' 2>/dev/null | sort | tr '\n' ':')"
if ! "$JDK/bin/javac" -nowarn -encoding UTF-8 -d "$OUT" -cp "$ANDROID_JAR:${THIRDPARTY_JARS%:}" \
    $(find "$SRC_DIR" "$PLATFORM_JAVA_DIR" "$CLI_TPL_JAVA_DIR" -name '*.java') > "$JAVAC_LOG" 2>&1; then
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

# ★★★QuickJS JNI 桥（`js-engine/quickjs_jni.c`）的**编译检查**（2026-10-13 · #903 暴露的门禁盲区）
#
# 【为什么单列一步（本仓真实踩坑）】#903 给 C 桥加了能力通道的字节腿（`invokeBytes` /
#   `nativeResolveHostBytes`），门禁 `check:no-json-wire` **全绿**（它只 grep 文本 token）——
#   但那个文件**根本编译不过**：误用了两个 QuickJS **未导出**的 API
#   （`JS_IsArrayBuffer` 公开头里没有；`JS_NewUint8ArrayCopy` 在 `quickjs.c` 内是 `static`，
#    `nm libquickjs.a` ⇒ `t _JS_NewUint8ArrayCopy`，**链接期不可外链**）
#   ⇒ NDK clang 18 直接 `error: call to undeclared function`（5 处错）。
#   而**此前没有任何门禁编译它**（本脚本只 javac；真机构建 `setup-android-js-engine.sh` 才编）
#   ⇒ 断代码被"绿门禁"一路放行到真机构建才炸。★教训与"门禁覆盖面必须跟着实际形态走"同源：
#   **形态判据（grep）不能替代"能不能编过"**。
#
# 【判据】用**与真机构建同一条编译命令**做 `-fsyntax-only`（零产物、~1 秒）。
#   之所以 `-fsyntax-only` 就够：C 里跨 TU 的 API 只可能来自头文件 ⇒ 用错 API 的**唯一入口形式**
#   就是 "call to undeclared function"，clang 在编译期即报错（本站实测 5 处全命中）。
# 【诚实边界】只做**语法 + 声明**检查，不产 `.so`、不编 QuickJS 六个源（那要几分钟）——
#   `undefined symbol` 一类仍由 `setup-android-js-engine.sh` 的链接步 + `assert_jni_export` 兜底。
CBRIDGE_SRC="$HERE/js-engine/quickjs_jni.c"
QJS_DIR="$ROOT/.tools/quickjs"
if [ -f "$CBRIDGE_SRC" ] && [ -f "$QJS_DIR/quickjs.h" ]; then
  echo "==> 编译检查 QuickJS JNI 桥（js-engine/quickjs_jni.c · 零设备）"
  CB_TC=""
  # 工具链探测顺序与 setup-android-js-engine.sh / build-and-run.sh 同口径：先本仓 .tools，再 SDK
  for base in "$ROOT/.tools/ndk" "$SDK/ndk/"*; do
    for tc in "$base/toolchains/llvm/prebuilt"/*; do
      [ -x "$tc/bin/aarch64-linux-android21-clang" ] && CB_TC="$tc" && break
    done
    [ -n "$CB_TC" ] && break
  done
  CB_JNI_INC="$ROOT/.tools/jdk17/include"
  if [ -n "$CB_TC" ] && [ -d "$CB_JNI_INC" ]; then
    CB_LOG="$OUT/cbridge.log"
    if "$CB_TC/bin/aarch64-linux-android21-clang" -fPIC -O2 -D_GNU_SOURCE \
         -I"$QJS_DIR" -I"$CB_JNI_INC" -I"$CB_JNI_INC/darwin" \
         -fsyntax-only "$CBRIDGE_SRC" > "$CB_LOG" 2>&1; then
      echo "    ✅ C 桥编译通过（改 js-engine/quickjs_jni.c 后先跑本脚本，再上真机）"
    else
      head -25 "$CB_LOG"
      echo "✗ quickjs_jni.c 未通过编译（见上方）——★门禁 grep 到 token ≠ 它编得过"
      exit 1
    fi
  else
    echo "    ◐ 略过：缺 NDK clang 或 JDK 头（NDK=${CB_TC:-未找到} / JDK=${CB_JNI_INC}）"
    echo "      先跑 scripts/setup-android-js-engine.sh 备齐 .tools/ndk 与 .tools/jdk17"
  fi
fi

# ★★★Rust JNI 绑定层的 **Android target 编译检查**（决策 #834 暴露的门禁盲区）
#
# 【为什么单列一步（本仓真实踩坑）】B2/B4 给 JNI 加了材质查询包装后，**javac 全绿**——
#   但 `cargo build --target aarch64-linux-android` 其实**报错**（用 `impl Fn` 传进 catch_unwind
#   ⇒ 不满足 UnwindSafe，`E0277`）。而**当时没有任何门禁构建它**（CI 无 NDK；本脚本只 javac）
#   ⇒ 断代码被提交、直到真机打包才暴露。⇒ 与"改宿主必须先过零设备编译检查"同一条纪律。
#
# 【判据】能给 Android target 编出 .so（含内核 + JNI 符号）即通过；缺 target/NDK ⇒ 诚实跳过并提示。
JNI_CRATE="$ROOT/platform/android/proteus-jni"
if [ -f "$JNI_CRATE/Cargo.toml" ]; then
  echo "==> 编译检查 Rust JNI（aarch64-linux-android · 零设备）"
  CARGO="$HOME/.cargo/bin/cargo"; [ -x "$CARGO" ] || CARGO="cargo"
  if rustup target list --installed 2>/dev/null | grep -q aarch64-linux-android; then
    NDK_DIR="$(ls -d "$SDK/ndk/"* 2>/dev/null | sort -V | tail -1)"
    if [ -n "$NDK_DIR" ] && [ -d "$NDK_DIR/toolchains/llvm/prebuilt" ]; then
      TC="$NDK_DIR/toolchains/llvm/prebuilt/$(ls "$NDK_DIR/toolchains/llvm/prebuilt" | head -1)"
      CLANG="$TC/bin/aarch64-linux-android24-clang"
      if [ -x "$CLANG" ]; then
        JNI_LOG="$OUT/jni.log"
        if CC_aarch64_linux_android="$CLANG" \
           CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$CLANG" \
           PATH="$HOME/.cargo/bin:$PATH" \
           "$CARGO" build --release --target aarch64-linux-android \
             --manifest-path "$JNI_CRATE/Cargo.toml" > "$JNI_LOG" 2>&1; then
          echo "    ✅ JNI .so 编译通过（aarch64-linux-android）"
        else
          grep -E "^error" "$JNI_LOG" | head -12 || tail -25 "$JNI_LOG"
          echo "✗ Rust JNI 未通过 Android target 编译（见上方）"
          exit 1
        fi
      else
        echo "    ◐ 略过：未找到 NDK clang（${CLANG}）"
      fi
    else
      echo "    ◐ 略过：未找到 NDK（$SDK/ndk/*）"
    fi
  else
    echo "    ◐ 略过：未装 rust target aarch64-linux-android（rustup target add aarch64-linux-android）"
  fi
fi

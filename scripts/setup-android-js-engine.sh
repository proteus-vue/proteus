#!/usr/bin/env bash
# scripts/setup-android-js-engine.sh —— ★S1：获取 + 构建 Android 的 JS 执行载体（QuickJS）
#
# 【为什么需要（本会话核实的结构事实）】Android 宿主无 JS 引擎
#   （`hosts/android` = Java + Rust `.so` 直连 JNI；WebView 仅作 native-host 演示）
#   ⇒ 卡 C1 剩「可运行 Android 实现」与 C2 剩「JSI 通路」**都受阻于此**。
#   选型见 `docs/proteus-android-js-engine-selection.md`（建议 QuickJS，含本机实测）。
#
# 【本仓惯例对齐】工具链走 `.tools/`（**gitignored**，见 .gitignore:49）+ 下载获取
#   （同 .tools/setup.log 的 JDK/NDK 模式）⇒ QuickJS **源码不入库**，由本脚本获取并构建。
#   理由：① 第三方源码入库会让 diff/体积失控 ② 版本升级应是显式动作（本脚本带版本常量）
#
# 【★供应链诚实边界（必读）】QuickJS 官方发布页 **不提供校验和/签名**
#   （实测：页面只有 .tar.xz 链接，无 SHA256/sig）。⇒ 本脚本**无法验证下载完整性**。
#   缓解措施（按优先级）：① 首次获取后**人工核对** sha256 并写入下方 PINNED_SHA256
#   （钉死后，后续下载会校验——**这才是真正的完整性保护**）
#   ② 若要更高保证，从 Bellard 官网 HTTPS 直取（本脚本即如此）+ 保留获取记录。
#
# 用法：
#   bash scripts/setup-android-js-engine.sh              # 获取 + 构建 Android .so
#   bash scripts/setup-android-js-engine.sh --host       # 只构建本机 qjs（用于零设备验证）
#   bash scripts/setup-android-js-engine.sh --check      # 只检查产物是否存在且架构正确
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TOOLS="$ROOT/.tools"
QJS_DIR="$TOOLS/quickjs"
OUT_DIR="$ROOT/hosts/android/build/js-engine"

# ★版本锁定（升级 = 显式改这里；测试记录见选型文档 §4）
QJS_VERSION="2026-06-04"
QJS_URL="https://bellard.org/quickjs/quickjs-${QJS_VERSION}.tar.xz"
# ★首次获取后人工核对并填写（留空 = 未钉死，脚本会提示）
PINNED_SHA256="b376e839b322978313d929fd20663b11ba58b75df5a46c126dd19ea2fa70ad2a"

# Android 目标（与 hosts/android 既有链路一致）
ANDROID_API=24
ABI="aarch64-linux-android${ANDROID_API}"

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

# ── NDK 探测（优先本仓 .tools/ndk，与 hosts/android/build-and-run.sh 同口径）──
find_ndk_cc() {
  local ndk="$TOOLS/ndk"
  [ -d "$ndk" ] || return 1
  local cc="$ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin/${ABI}-clang"
  [ -x "$cc" ] || return 1
  printf '%s' "$cc"
}

# ── ① 获取源码（缓存 + 校验）──
fetch_source() {
  if [ -f "$QJS_DIR/quickjs.c" ]; then
    say "  QuickJS 源码已就绪：$QJS_DIR"
    return 0
  fi
  mkdir -p "$TOOLS"
  local tarball="$TOOLS/quickjs-${QJS_VERSION}.tar.xz"
  if [ ! -f "$tarball" ]; then
    say "  下载 $QJS_URL …"
    curl -fsSL --max-time 300 -o "$tarball" "$QJS_URL" || die "下载失败（网络？）"
  fi
  # ★完整性校验（PINNED_SHA256 为空时**明确报告未校验**，不假装通过）
  if [ -z "$PINNED_SHA256" ]; then
    say "  ⚠ 未钉死校验和（官方页不提供）⇒ **本次未验证下载完整性**"
    say "    建议：人工核对后把 sha256 写入本脚本的 PINNED_SHA256（一次动作，长期受保护）"
  else
    local got
    got="$(shasum -a 256 "$tarball" | cut -d' ' -f1)"
    [ "$got" = "$PINNED_SHA256" ] || die "校验和不符！期望 ${PINNED_SHA256}，实得 ${got}"
    say "  ✅ 校验和通过（${PINNED_SHA256}）"
  fi
  say "  解压 …"
  rm -rf "$QJS_DIR"
  mkdir -p "$QJS_DIR"
  tar -xf "$tarball" -C "$QJS_DIR" --strip-components=1 || die "解压失败"
  [ -f "$QJS_DIR/quickjs.c" ] || die "解压后未见 quickjs.c（包结构变了？）"
}

# ── ② 本机 qjs（零设备验证用）──
build_host() {
  say "==> 构建本机 qjs（用于零设备验证）"
  (cd "$QJS_DIR" && make -j8 >/dev/null 2>&1) || die "本机构建失败"
  [ -x "$QJS_DIR/qjs" ] || die "未见 qjs 产物"
  local kb
  kb=$(( $(stat -f%z "$QJS_DIR/qjs") / 1024 ))
  say "  ✅ $QJS_DIR/qjs（${kb} KB）"
}

# ── ③ Android .so（★共享库需 -fPIC + Bionic 无独立 -lpthread）──
build_android() {
  local cc
  cc="$(find_ndk_cc)" || die "找不到 NDK（$TOOLS/ndk）——先跑 .tools 初始化（见 .tools/setup.log）"
  say "==> 交叉编译 Android .so（CC=${cc}）"
  mkdir -p "$OUT_DIR"
  local objs=()
  for f in quickjs dtoa libregexp libunicode cutils quickjs-libc; do
    # ★两个移植点（本会话实测踩到，见选型文档 §4）：
    #   ① -fPIC 必填（默认 build 不带 ⇒ 链接 .so 时报 R_AARCH64_ADR_PREL_PG_HI21）
    #   ② 不加 -lpthread/-ldl（Android Bionic 把它们并入 libc ⇒ 加会 "unable to find library"）
    "$cc" -fPIC -O2 -D_GNU_SOURCE -DCONFIG_VERSION="\"${QJS_VERSION}\"" \
      -c -o "$OUT_DIR/${f}.o" "$QJS_DIR/${f}.c" 2>&1 | head -3
    [ -f "$OUT_DIR/${f}.o" ] || die "编译 $f.c 失败"
    objs+=("$OUT_DIR/${f}.o")
  done
  # ★静态库（供 JNI 桥链接——JNI .so 需要 QuickJS 的符号）
  "$cc" -shared -o "$OUT_DIR/libquickjs.so" "${objs[@]}" -lm 2>&1 | head -3
  [ -f "$OUT_DIR/libquickjs.so" ] || die "链接 libquickjs.so 失败"
  local kb
  kb=$(( $(stat -f%z "$OUT_DIR/libquickjs.so") / 1024 ))
  say "  ✅ $OUT_DIR/libquickjs.so（${kb} KB）"

  # ── ★S2：JNI 桥（quickjs_jni.c → libquickjs_jni.so）──
  #   【为什么要单独一个 .so】JNI 导出符号必须在**被 System.loadLibrary 加载的那个库**里；
  #     且它与 QuickJS 静态链接（避免运行时还要 load 两个库的顺序问题）。
  local jni_src="$ROOT/hosts/android/js-engine/quickjs_jni.c"
  [ -f "$jni_src" ] || die "缺 JNI 桥源码：$jni_src"
  local jni_inc="$ROOT/.tools/jdk17/include"
  [ -d "$jni_inc" ] || die "缺 JDK 头（$jni_inc）—— .tools/jdk17 未就绪"
  say "==> 交叉编译 JNI 桥（libquickjs_jni.so）"
  # ★QuickJS 编译为「一次性打进 JNI 桥」：直接编源 + jni 头一起链接
  local jni_objs=()
  for f in quickjs dtoa libregexp libunicode cutils quickjs-libc; do
    "$cc" -fPIC -O2 -D_GNU_SOURCE -DCONFIG_VERSION="\"${QJS_VERSION}\"" \
      -I"$QJS_DIR" -c -o "$OUT_DIR/j-${f}.o" "$QJS_DIR/${f}.c" 2>&1 | head -3
    jni_objs+=("$OUT_DIR/j-${f}.o")
  done
  "$cc" -fPIC -O2 -D_GNU_SOURCE -I"$QJS_DIR" \
    -I"$jni_inc" -I"$jni_inc/darwin" \
    -c -o "$OUT_DIR/quickjs_jni.o" "$jni_src" 2>&1 | head -5
  [ -f "$OUT_DIR/quickjs_jni.o" ] || die "JNI 桥编译失败（见上方错误）"
  "$cc" -shared -o "$OUT_DIR/libquickjs_jni.so" "$OUT_DIR/quickjs_jni.o" "${jni_objs[@]}" -lm -llog 2>&1 | head -3
  [ -f "$OUT_DIR/libquickjs_jni.so" ] || die "链接 libquickjs_jni.so 失败"
  rm -f "${jni_objs[@]}" "$OUT_DIR/quickjs_jni.o"
  kb=$(( $(stat -f%z "$OUT_DIR/libquickjs_jni.so") / 1024 ))
  say "  ✅ $OUT_DIR/libquickjs_jni.so（${kb} KB）"
  assert_android_so
  assert_jni_export
}

/** ★判据（S2）：JNI 导出符号必须在产物里（否则运行期 UnsatisfiedLinkError） */
assert_jni_export() {
  local so="$OUT_DIR/libquickjs_jni.so"
  local nm_bin
  nm_bin="$(find_ndk_cc 2>/dev/null | sed 's|/bin/[^/]*$|/bin/llvm-nm|')"
  if [ -x "$nm_bin" ]; then
    if "$nm_bin" -D --defined-only "$so" 2>/dev/null | grep -q "Java_dev_proteus_layoutcore_QuickJsEngine_nativeEval"; then
      say "  ✅ JNI 导出断言通过（nativeEval / nativeEvalWithHost 符号在场）"
    else
      die "JNI 导出符号缺失（System.loadLibrary 后会 UnsatisfiedLinkError）"
    fi
  else
    say "  ⚠ 找不到 llvm-nm，跳过 JNI 导出断言（未验证）"
  fi
}

# ── ④ 产物架构断言（★判据：不是"跑通了"，是"架构正确"）──
assert_android_so() {
  local so="$OUT_DIR/libquickjs.so"
  [ -f "$so" ] || die "产物缺失：$so"
  local desc
  desc="$(file "$so")"
  case "$desc" in
    *"ARM aarch64"*) say "  ✅ 架构断言通过：ARM aarch64（${desc}）" ;;
    *) die "架构不符（期望 ARM aarch64）：$desc" ;;
  esac
}

# ── 主流程 ──
case "${1:-}" in
  --check)
    assert_android_so
    assert_jni_export
    ;;
  --host)
    fetch_source
    build_host
    ;;
  "")
    fetch_source
    build_host
    build_android
    say ""
    say "★下一步：JNI 桥（S2）——在 hosts/android 里 loadLibrary(\"quickjs\") 并暴露 evaluateScript"
    ;;
  *)
    die "未知参数：$1（用法见文件头）"
    ;;
esac

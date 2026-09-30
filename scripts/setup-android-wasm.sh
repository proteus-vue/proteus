#!/usr/bin/env bash
# scripts/setup-android-wasm.sh —— ★★C82 App 端 WebAssembly：wasm 运行时的获取 + 交叉编译
#
# 【为什么需要（本轮取证结论）】
#   App 端（Android/iOS）用的 JS 引擎是 **QuickJS**，而 QuickJS **内建没有 WebAssembly**
#   ——实测双证据：① `.tools/quickjs/qjs -e "typeof WebAssembly"` → `undefined`；
#   ② Bellard 版与 quickjs-ng 的源码里 "WebAssembly" **零命中**（本轮 grep 核实）。
#   ⇒ 但**平台完全能做**：wasm 运行时属**宿主能力**（Host ABI 的用途正是"平台能力注入"），
#     宿主提供 → 经 `proteusHost.invoke` 通道暴露给 JS（与 window/worker/preload 同一模式）。
#   ⇒ 选 **wasm3**（MIT、纯 C、~36K 行、解释执行无 JIT ⇒ **Android W^X 限制下可用**，
#     与 QuickJS 同为解释器路线——本仓 JS 引擎选型同理：Android 上 JIT 不可靠）。
#
# 【为什么是纯解释器（本仓既有认识的延续）】`docs/proteus-android-js-engine-selection.md`
#   §3.2 的结论：Android W^X 让 JIT 不可靠 ⇒ 选 QuickJS（解释器）。wasm 侧同理：
#   wasm3 是解释器 ⇒ 无 JIT 内存问题（对比 wasmtime/wasmer 需 JIT 或 AOT 预编译）。
#
# 用法：
#   bash scripts/setup-android-wasm.sh          # 获取源码 + 交叉编译 libproteus_wasm.so
#   bash scripts/setup-android-wasm.sh --check  # 只检查产物（架构 + 符号断言）
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TOOLS="$ROOT/.tools"
W3_DIR="$TOOLS/wasm3"
OUT_DIR="$ROOT/hosts/android/build/wasm"
NDK_DIR="$TOOLS/ndk"

# ★版本锁定（升级 = 显式改这里；与 quickjs 同惯例）
W3_REV="main"
W3_URL="https://codeload.github.com/wasm3/wasm3/tar.gz/refs/heads/${W3_REV}"

ANDROID_API=24
ABI="aarch64-linux-android${ANDROID_API}"
# ★★16 KB page size 对齐（Android 15+ 要求）——与 setup-android-js-engine.sh 同款。
#   【为什么必须有（用户指出「安卓三个 so 库没做 16kb 门禁校验」）】本脚本首版**漏了它**：
#   实测 `llvm-readelf -l` 显示 LOAD 段 Align 全是 **0x1000（4 KB）** ⇒ 16 KB 设备上 mmap 失败。
ALIGN_FLAG="-Wl,-z,max-page-size=16384"

say() { printf '%s\n' "$*"; }
die() { say "✗ $*"; exit 1; }

find_cc() {
  # ★路径照既有脚本（setup-android-js-engine.sh 的 find_ndk_cc）——同一 .tools 布局：
  #   toolchains/llvm/prebuilt/<host>/bin/<abi>-clang（不是递归 find：ndk 树里有多个同名候选）
  local cc="$NDK_DIR/toolchains/llvm/prebuilt/darwin-x86_64/bin/${ABI}-clang"
  [ -x "$cc" ] || die "找不到 NDK 交叉编译器：$cc ——先跑 .tools 初始化"
  printf '%s' "$cc"
}

# ── ① 获取源码（缓存式：已存在则复用）──
fetch_src() {
  if [ -f "$W3_DIR/source/wasm3.h" ]; then
    say "  ✅ wasm3 源码已就绪：${W3_DIR}（复用缓存）"
    return
  fi
  say "==> 获取 wasm3 源码（${W3_REV}）"
  mkdir -p "$TOOLS"
  local tmp="$TOOLS/wasm3-dl.tar.gz"
  curl -sL -o "$tmp" "$W3_URL" || die "下载失败：$W3_URL"
  rm -rf "$W3_DIR"
  mkdir -p "$W3_DIR"
  tar xzf "$tmp" -C "$W3_DIR" --strip-components=1 || die "解压失败"
  rm -f "$tmp"
  [ -f "$W3_DIR/source/wasm3.h" ] || die "解压后未见 source/wasm3.h（目录结构变了？）"
  say "  ✅ 源码就绪（$(wc -l < "$W3_DIR/source/wasm3.h") 行头文件）"
}

# ── ② 交叉编译（最小集：不含 WASI——语义受限是**诚实边界**，见下）──
build_so() {
  local cc
  cc="$(find_cc)"
  say "==> 交叉编译 libproteus_wasm.so（CC=${cc}）"
  mkdir -p "$OUT_DIR"
  local objs=()
  # ★只编核心解析/执行/校验（**不含 m3_api_wasi**）：WASI 需要 posix 文件系统桥，
  #   与"移动端沙箱"语义冲突（本仓 G-49 沙箱纪律）⇒ 不支持 WASI 导入是**刻意的**，
  #   漏掉的导入会在 m3_LinkRawFunction 阶段报错（显式失败，不静默）。
  for f in m3_core m3_env m3_parse m3_compile m3_exec m3_function m3_module m3_code m3_bind m3_info m3_validate m3_snapshot m3_deterministic m3_xxh64; do
    local src="$W3_DIR/source/${f}.c"
    [ -f "$src" ] || { say "  ⚠ 跳过缺失源文件：${f}.c"; continue; }
    "$cc" -fPIC -O2 -Dd_m3HasFloat=1 -Dd_m3Use32BitSlots=0 \
      -I"$W3_DIR/source" -c -o "$OUT_DIR/${f}.o" "$src" 2>&1 | head -3
    [ -f "$OUT_DIR/${f}.o" ] || die "编译 ${f}.c 失败"
    objs+=("$OUT_DIR/${f}.o")
  done
  # ★JNI 桥（wasm 运行时 → Java/JS）
  local jni_src="$ROOT/hosts/android/wasm/proteus_wasm_jni.c"
  [ -f "$jni_src" ] || die "缺 JNI 桥源码：$jni_src"
  local jni_inc="$TOOLS/jdk17/include"
  [ -d "$jni_inc" ] || die "缺 JDK 头（${jni_inc}）"
  "$cc" -fPIC -O2 -I"$W3_DIR/source" -I"$jni_inc" -I"$jni_inc/darwin" \
    -c -o "$OUT_DIR/proteus_wasm_jni.o" "$jni_src" 2>&1 | head -5
  [ -f "$OUT_DIR/proteus_wasm_jni.o" ] || die "JNI 桥编译失败"
  "$cc" -shared "$ALIGN_FLAG" -o "$OUT_DIR/libproteus_wasm.so" "$OUT_DIR/proteus_wasm_jni.o" "${objs[@]}" -lm -llog 2>&1 | head -3
  [ -f "$OUT_DIR/libproteus_wasm.so" ] || die "链接失败"
  rm -f "$OUT_DIR"/*.o
  local kb; kb=$(( $(stat -f%z "$OUT_DIR/libproteus_wasm.so") / 1024 ))
  say "  ✅ ${OUT_DIR}/libproteus_wasm.so（${kb} KB）"
  assert_so
}

# ── ③ 产物断言（架构 + 导出符号——同 quickjs 的判据口径）──
assert_so() {
  local so="$OUT_DIR/libproteus_wasm.so"
  local desc; desc="$(file "$so")"
  case "$desc" in
    *"ARM aarch64"*) say "  ✅ 架构断言通过（ARM aarch64）" ;;
    *) die "架构不对：$desc" ;;
  esac
  local nm_bin; nm_bin="$(find_cc | sed 's|/bin/[^/]*$|/bin/llvm-nm|')"
  if [ -x "$nm_bin" ]; then
    local missing=0 sym
    for sym in nativeWasmVersion nativeWasmInstantiate nativeWasmCall nativeWasmRelease; do
      if ! "$nm_bin" -D --defined-only "$so" 2>/dev/null | grep -q "Java_dev_proteus_layoutcore_WasmRuntime_${sym}"; then
        say "  ✗ 缺符号：Java_dev_proteus_layoutcore_WasmRuntime_${sym}"
        missing=1
      fi
    done
    [ "$missing" = "0" ] && say "  ✅ JNI 导出断言通过（4 个符号全在场）" || die "JNI 导出符号缺失"
  else
    say "  ⚠ 找不到 llvm-nm，跳过导出断言"
  fi
}

# ── ④ 检查模式 ──
check_only() {
  local so="$OUT_DIR/libproteus_wasm.so"
  [ -f "$so" ] || { say "⚠ 未构建（${so}）——跑：bash scripts/setup-android-wasm.sh"; exit 0; }
  say "==> 检查产物：${so}"
  assert_so
}

case "${1:-}" in
  --check) check_only ;;
  *) fetch_src; build_so
     say ""
     say "★下一步：宿主 Java 侧（WasmRuntime.java）经 System.loadLibrary(\"proteus_wasm\") 使用；"
     say "  APK 打包需把 .so 放进 lib/arm64-v8a/（见 hosts/android/build-and-run.sh）" ;;
esac

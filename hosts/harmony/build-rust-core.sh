#!/usr/bin/env bash
# hosts/harmony/build-rust-core.sh —— 交叉编译 Rust 排版核 → 鸿蒙（aarch64-unknown-linux-ohos）
#
# 【为什么需要】方案 M5：鸿蒙腿要与 Android/iOS **同一份 Rust 排版核**（"写一遍"的兑现）。
#   Android 走 NDK + JNI 绑定；iOS 走 staticlib + @_silgen_name；鸿蒙走
#   **OHOS NDK clang 交叉编译 + C ABI 直接链接**（无绑定层——C ABI 就是契约）。
#
# 【产物】`host-app/entry/src/main/cpp/thirdparty/libproteus_layout_core.a`
#   （32MB 静态库；gitignore——构建期依赖，由本脚本生成）
#   ★首次构建 APK 前必须先跑本脚本（CMakeLists 会检测；缺失时只跳过 4050 基准，不阻断构建）。
#
# 【前置（一次）】`rustup target add aarch64-unknown-linux-ohos`（本脚本自动补）
#
# 用法：bash hosts/harmony/build-rust-core.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CRATE="$ROOT/packages/layout-core-rust"
OUT="$HERE/host-app/entry/src/main/cpp/thirdparty"

# ── DevEco NDK 解析（与 hdc.sh / build-host-app.sh 同策略）──
find_deveco() {
  if [ -n "${PROTEUS_DEVECO:-}" ] && [ -d "${PROTEUS_DEVECO}" ]; then echo "$PROTEUS_DEVECO"; return 0; fi
  local candidates=(
    "/Volumes/data1/work/office-applications/DevEco-Studio.app/Contents"
    "$HOME/Applications/DevEco-Studio.app/Contents"
    "/Applications/DevEco-Studio.app/Contents"
  )
  local c
  for c in "${candidates[@]}"; do
    if [ -x "$c/sdk/default/openharmony/native/llvm/bin/aarch64-unknown-linux-ohos-clang" ]; then
      echo "$c"; return 0
    fi
  done
  return 1
}
DEVECO="$(find_deveco)" || { echo "✗ 找不到 DevEco Studio（或用 PROTEUS_DEVECO 指定 Contents 目录）"; exit 2; }

OHOS_NDK="$DEVECO/sdk/default/openharmony/native"
CLANG="$OHOS_NDK/llvm/bin/aarch64-unknown-linux-ohos-clang"

echo "==> 工具链"
echo "    NDK   : $OHOS_NDK"
echo "    clang : $($CLANG --version 2>/dev/null | head -1)"

# ── rust target（幂等）──
export PATH="$HOME/.cargo/bin:$PATH"
rustup target add aarch64-unknown-linux-ohos 2>&1 | tail -1

# ── 交叉编译环境（cargo 读 CARGO_TARGET_<TARGET>_LINKER 约定）──
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_OHOS_LINKER="$CLANG"
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_OHOS_AR="$OHOS_NDK/llvm/bin/llvm-ar"
export CC_aarch64_unknown_linux_ohos="$CLANG"
export AR_aarch64_unknown_linux_ohos="$OHOS_NDK/llvm/bin/llvm-ar"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/spike/target}"

echo "==> 编译（cargo build --release --target aarch64-unknown-linux-ohos）"
(cd "$CRATE" && cargo build --release --target aarch64-unknown-linux-ohos 2>&1 | tail -4)

SRC="$CARGO_TARGET_DIR/aarch64-unknown-linux-ohos/release/libproteus_layout_core.a"
[ -f "$SRC" ] || { echo "✗ 未产出静态库：$SRC"; exit 1; }

mkdir -p "$OUT"
cp "$SRC" "$OUT/libproteus_layout_core.a"
echo
echo "==> 产物"
ls -la "$OUT/libproteus_layout_core.a"
echo "    架构：$($OHOS_NDK/llvm/bin/llvm-readelf -h "$OUT/libproteus_layout_core.a" 2>/dev/null | grep -m1 Machine || echo aarch64)"
echo
echo "下一步：bash hosts/harmony/build-host-app.sh（CMake 会自动链接本核）"

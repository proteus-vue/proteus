#!/usr/bin/env bash
# scripts/check-harmony-host-compile.sh —— ★★★零设备编译检查：鸿蒙宿主 C++（tear 住"改宿主代码先过编译"纪律）
#
# 【为什么需要】Android 有 `check:android-host-compile`（javac + android.jar）、iOS 有
#   `check:ios-selfdraw-compile`（swiftc -typecheck）——**鸿蒙此前没有**：改 `proteus_host.cpp` /
#   `proteus_render.cpp` 只能等 DevEco `assembleHap`（重）或真机才发现语法错。
#   本脚本用 **DevEco 自带的 OHOS clang** 对两个 .cpp 做 `-fsyntax-only`（零设备、秒级）。
#
# 【诚实边界】只做**语法/类型**检查（`-fsyntax-only`），不链接、不产 so ⇒ 抓得到 C++ 语法/头文件/
#   API 签名类错误，抓不到链接期/运行期问题（那些仍需 `assembleHap` + 真机）。这与 android/ios 的
#   零设备检查同口径（javac / swiftc -typecheck 也不链接）。
#
# 【DevEco 定位】与 hosts/harmony/build-host-app.sh / hdc.sh 同策略：显式覆盖 > 常见安装位。
#   找不到 ⇒ **跳过并退出 0**（CI 上无 DevEco 属正常；本地有则真检查）。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CPP_DIR="$ROOT/hosts/harmony/host-app/proteus_render/src/main/cpp"

find_deveco() {
  if [ -n "${PROTEUS_DEVECO:-}" ] && [ -d "${PROTEUS_DEVECO}" ]; then echo "$PROTEUS_DEVECO"; return 0; fi
  for c in \
    "/Volumes/data1/work/office-applications/DevEco-Studio.app/Contents" \
    "$HOME/Applications/DevEco-Studio.app/Contents" \
    "/Applications/DevEco-Studio.app/Contents"; do
    [ -d "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}

DEVECO="$(find_deveco)" || { echo "ℹ 未找到 DevEco Studio（无 OHOS 工具链）——跳过鸿蒙 C++ 编译检查（CI 正常）"; exit 0; }
SDK="$DEVECO/sdk/default/openharmony/native"
CLANG="$SDK/llvm/bin/clang"
SYSROOT="$SDK/sysroot"
[ -x "$CLANG" ] || { echo "ℹ 缺 OHOS clang（${CLANG}）——跳过"; exit 0; }
ARCH_INC="$(ls "$SYSROOT/usr/include" 2>/dev/null | grep -iE 'aarch64|aarch' | head -1)"
[ -n "$ARCH_INC" ] || ARCH_INC="aarch64-linux-ohos"

echo "==> 编译检查鸿蒙宿主 C++（OHOS clang -fsyntax-only，零设备）"
fail=0
# ★T-app-fetch（2026-10-18）：`invoke_wire.h` 只有被某个 TU include 才会被编译到。
#   `proteus_host.cpp` 已 include 它（能力通道 http.request 用）⇒ 上面的循环天然覆盖；
#   这里再单独编一个**最小 TU**，保证"头文件自身可独立编译"（它声明零依赖，应成立）。
if printf '#include "invoke_wire.h"\nint main(){return 0;}\n' > /tmp/proteus_iw_probe.cpp \
   && "$CLANG" --target=aarch64-linux-ohos --sysroot="$SYSROOT" -fsyntax-only -std=c++17 \
      -I"$SYSROOT/usr/include" -I"$SYSROOT/usr/include/$ARCH_INC" -I"$CPP_DIR" \
      /tmp/proteus_iw_probe.cpp 2>/tmp/harmony_cc_invoke_wire.log; then
  echo "  ✅ invoke_wire.h（独立 TU）"
else
  echo "  ✗ invoke_wire.h（独立 TU）"
  grep -E "error:" /tmp/harmony_cc_invoke_wire.log | head -10
  fail=1
fi
for f in proteus_host.cpp proteus_render.cpp glass_vk.cpp; do
  if "$CLANG" --target=aarch64-linux-ohos --sysroot="$SYSROOT" -fsyntax-only \
      -I"$SYSROOT/usr/include" -I"$SYSROOT/usr/include/$ARCH_INC" -I"$CPP_DIR" \
      "$CPP_DIR/$f" 2>/tmp/harmony_cc_$f.log; then
    echo "  ✅ $f"
  else
    echo "  ✗ $f"
    grep -E "error:" /tmp/harmony_cc_$f.log | head -10
    fail=1
  fi
done
[ "$fail" = 0 ] && { echo "✅ 鸿蒙宿主 C++ 编译检查通过（改动 proteus_host.cpp/proteus_render.cpp 后先跑本脚本，再上真机）"; exit 0; }
echo "✗ 鸿蒙宿主 C++ 编译检查未过"; exit 1

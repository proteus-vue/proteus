#!/usr/bin/env bash
# hosts/harmony/check-glass-parity.sh —— ★★★鸿蒙玻璃像素等价门禁（决策 #841）
#
# 【它证明什么（OS 级一致性的硬证据 · 鸿蒙腿）】新架构下玻璃算法真源在 Rust WGSL；鸿蒙腿由 naga 落成
#   **SPIR-V**，宿主用**离屏 Vulkan** 跑（glass_vk.cpp，算法 0 行）。本脚本用**同一份合成 backdrop**：
#     ① Rust CPU 参考实现（`proteus-shader-gen --render-ref`，oracle）；
#     ② **真机（鸿蒙）** GPU 离屏 Vulkan 渲染生成物 SPIR-V（`--ps scene vkglass` → 落 vkglass-gpu.json）。
#   逐像素比对——容差内相等 ⇒ "鸿蒙 GPU 落地 == 算法真源"（与 iOS Metal 门禁同口径）。
#
# 【为什么需要设备】鸿蒙没有本机 Vulkan（不像 iOS 可用 macOS Metal 离线跑）⇒ 必须在真机上渲染后拉回。
#   ★这是**设备门禁**（CI 无设备 ⇒ 无法跑；见 check-gates-sync 的 LOCAL_ONLY 说明）。
#
# 前置：宿主已构建（bash hosts/harmony/build-host-app.sh）+ 设备连接（bash hosts/harmony/hdc.sh check）。
# 用法：bash hosts/harmony/check-glass-parity.sh   退出码 0/1
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
[ -z "${HARMONY_HDC:-}" ] || true
HDC() { bash "$HERE/hdc.sh" "$@"; }
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
export PATH="$HOME/.cargo/bin:$PATH"
BUNDLE="dev.proteus.host"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ★★无设备则**跳过并退出 0**（与 check:harmony-host-compile 同策略）——CI/无设备的机器跑 verify
#   不应假红。真机门禁的意义在**本地有设备时**强制对比（对齐 ios 的 check:glass-pixel-parity 思路）。
TARGETS="$(HDC list targets 2>/dev/null | tr -d '\r' | grep -v '^\s*$' || true)"
case "$TARGETS" in
  "" | *"[Empty]"* | *Unauthorized*)
    echo "ℹ 无可用鸿蒙设备（list targets: ${TARGETS:-空}）——跳过鸿蒙玻璃像素等价（CI/无设备正常）"
    exit 0 ;;
esac

echo "==> ① 合成 backdrop + spec（固定样例，两端同输入）"
node "$ROOT/hosts/ios/lib/gen-parity-spec.mjs" "$WORK/spec.json" || exit 2

echo "==> ② Rust CPU 参考渲染（oracle）"
( cd "$ROOT/packages/shader-codegen-rust" && cargo run --release --offline --quiet -- --render-ref "$WORK/spec.json" > "$WORK/ref.json" ) || { echo "✗ CPU 参考渲染失败"; exit 3; }
[ -s "$WORK/ref.json" ] || { echo "✗ 参考渲染无输出"; exit 3; }
echo "  参考：$(node -e "const d=require('$WORK/ref.json');console.log(d.width+'x'+d.height+' rgba '+d.rgba.length)")"

echo "==> ③ 真机（鸿蒙）离屏 Vulkan 渲染生成物 SPIR-V"
HDC install "$HERE/host-app/entry/build/default/outputs/default/entry-default-signed.hap" >/dev/null 2>&1 || true
DEV_FILE="/data/app/el2/100/base/$BUNDLE/haps/entry/files/vkglass-gpu.json"
HDC shell "rm -f $DEV_FILE" >/dev/null 2>&1 || true
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene vkglass" >/dev/null 2>&1 || { echo "✗ aa start 失败"; exit 4; }
# ★零盲等：等被测对象**主动上报** PROTEUS_VKGLASS_RUN（有界条件等待）
if [ -x "$WAIT_SH" ]; then
  bash "$WAIT_SH" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q PROTEUS_VKGLASS_RUN'" --timeout 30 --interval 2 >/dev/null 2>&1 || { echo "✗ 未等到 PROTEUS_VKGLASS_RUN（设备未渲染？）"; exit 4; }
else
  echo "  ⚠ 缺 wait_for.sh——不盲等，直接读结果（可能过早）"
fi
HDC shell "hilog -x | grep PROTEUS_VKGLASS_PROBE | tail -1" 2>/dev/null | sed 's/^/  /'
HDC file recv "$DEV_FILE" "$WORK/gpu.json" >/dev/null 2>&1 || { echo "✗ 拉取 GPU 输出失败"; exit 4; }
[ -s "$WORK/gpu.json" ] || { echo "✗ GPU 输出为空"; exit 4; }

echo "==> ④ 逐像素比对（容差内相等）"
node "$HERE/../ios/lib/compare-rgba.mjs" "$WORK/ref.json" "$WORK/gpu.json"
RC=$?
if [ "$RC" = "0" ]; then echo "✅ 玻璃像素等价（鸿蒙 Vulkan 落地 == Rust 算法真源）"; else echo "✗ 像素不等价"; fi
exit $RC

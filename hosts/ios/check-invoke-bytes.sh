#!/usr/bin/env bash
# hosts/ios/check-invoke-bytes.sh —— ★★iOS 二进制腿的**端到端门禁**（macOS 本机 · 真实 JavaScriptCore · 零设备）
#
# 【为什么需要（不是"多一个脚本"）】`check:no-json-wire` 只判**形态在不在**（grep 源码：C 回调注入、
#   Uint8Array 转换、回推入口……），它**证明不了那套形态跑得通**。本轮实测的形态级陷阱都只在"真跑一次"
#   时才暴露：JSC 的 `JSObjectGetTypedArrayBytesPtr` 返回的是**临时指针**（不立即拷就废）、
#   `Uint8Array` 与 `Array` 在跨边界后长相相似（JS 侧可能被当数组处理）、C 回调签名差一个可选性
#   就整个拒编、坏入参若静默返回 `undefined` 会被 JS 侧误判成"已受理等回推"。
#   ⇒ 判据分工：`check:no-json-wire` 管**形态**；本脚本管**通路**（真 JSC 上把字节搬过去、再搬回来）。
#
# 【本脚本做什么】用 `xcrun swiftc` 编译「Swift 线格式编解码器 + JSC 字节桥 + 探针 main」
#   （三者与 App 用的是**同一份源码**，不另写测试替身），在 **macOS 的真实 JSC** 上跑 12 项自检：
#     注入可见 / 去程全字段（含中文）/ 回执是 Uint8Array 而非 Array / 回执逐字节等于宿主编码器结果 /
#     回推逐字节一致 / 坏入参（普通数组、空帧）必须抛异常 / 1MB 大载荷往返长度+校验和一致 / 宿主记账。
#
# 【★为什么可以在 macOS 上验 iOS 的腿】两端用的都是 Apple 公开的 JSC C API（`JSObjectGetTypedArrayBytesPtr`
#   等，`API_AVAILABLE(macos(10.12), ios(10.0))`）⇒ 通路语义在 macOS 上成立即在 iOS 上成立；差异只在
#   上层视图（UIView/URLSession 的具体行为），那由真机/模拟器场景验（本脚本**不假装**覆盖真机）。
#
# 【★诚实边界】① 探针用**桩 handler**（`http.request` 回 pending、`echo` 原样回）⇒ 验的是**桥与线格式**；
#   真实网络由 `http-capability.swift` + 真机场景验；② 本门禁是**本地门禁**（需 macOS + Swift 工具链，
#   CI 是 ubuntu-latest ⇒ 不接 CI——与 `check:ios-cli-host-compile` 同族，已在 `check:gates-sync` 登记）。
#
# 用法：bash hosts/ios/check-invoke-bytes.sh
# 退出码：0 全通过 / 1 有失败 / 2 环境缺失
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SRC_WIRE="$HERE/ProteusHost/runtime/InvokeWire.swift"
SRC_BRIDGE="$HERE/ProteusHost/runtime/invoke-bytes-bridge.swift"
SRC_PROBE="$HERE/tools/InvokeBytesProbe.swift"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

for f in "$SRC_WIRE" "$SRC_BRIDGE" "$SRC_PROBE"; do
  [ -f "$f" ] || { echo "✗ 找不到源码：$f"; exit 2; }
done

# ── 工具链探测（缺则**明确报缺**，不静默跳过——静默跳过 = 假绿）──
command -v xcrun >/dev/null 2>&1 || { echo "✗ 缺 \`xcrun\`（本门禁需 macOS + Xcode/CommandLineTools 的 Swift 工具链）"; exit 2; }
xcrun -f swiftc >/dev/null 2>&1 || { echo "✗ 找不到 \`swiftc\`（装 Xcode 或 CommandLineTools）"; exit 2; }

echo "==> 编译 iOS 二进制腿（线格式 + JSC 桥 + 探针 · 本机 macOS JSC）"
# ★判据是 **swiftc 自己的退出码**（本仓踩过"用 grep 过滤掉 javac 退出码 ⇒ 假绿"的坑）
if ! xcrun swiftc -O -framework JavaScriptCore -o "$OUT/probe" "$SRC_WIRE" "$SRC_BRIDGE" "$SRC_PROBE" 2>"$OUT/cc.log"; then
  echo "✗ 编译失败（源码级缺陷）："
  sed -n '1,40p' "$OUT/cc.log"
  exit 1
fi
echo "    ✓ 编译通过（与 App 同一份源码：不写测试替身）"

echo "==> 跑端到端自检（真实 JavaScriptCore）"
"$OUT/probe"
rc=$?

if [ "$rc" -ne 0 ]; then
  echo "✗ iOS 二进制腿端到端自检失败（详见上方 ✗ 行）——" >&2
  echo "  常见根因：① 未立即拷贝 typed-array 裸指针（JSC 文档：该指针是临时的）；" >&2
  echo "            ② 回执没造 Uint8Array（JS 侧会被当数组 ⇒ 又要 Array.from 一遍 = 白做）；" >&2
  echo "            ③ 坏入参静默返回（JS 侧误判「已受理等回推」）；④ 线格式与 TS SSOT 漂移。" >&2
  exit 1
fi
echo "✅ iOS 二进制腿通路成立（真实 JSC · 去程/回执/回推/大载荷/坏入参，共 12 项）"

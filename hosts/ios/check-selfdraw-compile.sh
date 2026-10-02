#!/usr/bin/env bash
# hosts/ios/check-selfdraw-compile.sh —— ★iOS 自绘宿主的**编译检查**（零设备、零签名）
#
# 【为什么需要（2026-09-29 实测的覆盖盲区）】
#   `run-selfdraw.sh` 是**唯一**编译 `ProteusHost/selfdraw-scene.swift` 的地方，
#   而它需要真机 + 描述文件 + 签名（免费账号名额有限）。⇒ 后果：
#   **改动这个 Swift 宿主的代码，本地没有任何东西会类型检查它**——
#   只能靠"装了才知道"，与 Android 侧「桩测」要解决的同一类问题。
#   实测触发场景：给 iOS 宿主加自定义字体注册通道时，没有任何本地判据能证明它能编译。
#
# 【本脚本做什么】只跑 `swiftc -typecheck`（**不产出二进制、不签名、不装机**）：
#   把 iOS 宿主源码 + 依赖它的文件一起做类型检查。设备编译用同一份源码 ⇒ 类型错误本地即暴露。
#
# 【为什么可以 typecheck 而不链接】宿主用 UIKit/CoreText/JavaScriptCore 的**公开 API**，
#   SDK 里都有；不需要 Rust 静态库（那是链接期的事，与类型无关）。
#
# 用法：bash hosts/ios/check-selfdraw-compile.sh
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/xcode-env.sh"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# ★★G-39（2026-09-30）：selfdraw App 的源码是**多个文件**（selfdraw-scene.swift +
#   host-runtime-scene.swift）；写死单文件会让新文件**悄悄不参与类型检查**
#   （本轮实测：加 host-runtime-scene.swift 后本脚本报 "cannot find HostRuntimeScene in scope"
#   ——正是它该抓的"文件没进编译"形态）。
#   ★**不能 glob 整个 ProteusHost/**：同目录有**四个独立 App 的 @main 入口**
#   （main.swift / calayer-scene.swift / layout-core-bench.swift / selfdraw-scene.swift），
#   一起编译会多 @main 冲突。⇒ 显式列出本 App 的源码集（新增文件必须加到这里 + run-selfdraw.sh）。
#   ★判据：列表里每个文件都必须存在（缺一个即红——不静默跳过）。
HOST_SRCS=(
  "$HERE/ProteusHost/selfdraw-scene.swift"
  "$HERE/ProteusHost/host-runtime-scene.swift"
  "$HERE/ProteusHost/host-capabilities.swift"
  "$HERE/ProteusHost/host-lifecycle-events.swift"
  "$HERE/ProteusHost/screen-host.swift"
  "$HERE/ProteusHost/app-stack-scene.swift"
  "$HERE/ProteusHost/showcase-scene.swift"
)
for f in "${HOST_SRCS[@]}"; do
  [ -f "$f" ] || { echo "✗ 找不到宿主源码：$f"; exit 2; }
done

# ★与 run-selfdraw.sh 的编译参数**保持一致**（否则本地绿、设备红——"验证了但验的是别的"）：
#   sdk=iphoneos · target arm64-apple-ios15.0 · 同批 framework
echo "==> 类型检查 iOS 自绘宿主（swiftc -typecheck · 零设备）"
RC=0
# ★HA0.5：宿主依赖平台适配层（`platform/ios/`）⇒ 两者必须**一起**类型检查
#   （否则会出现"宿主引用了一个没参与编译的类型"这类假红/假绿）
PLATFORM_SRC="$(ls "$HERE"/../../platform/ios/ProteusPlatform/*.swift 2>/dev/null | tr '\n' ' ')"
OUT="$(xcrun --sdk iphoneos swiftc -typecheck \
  -target arm64-apple-ios15.0 \
  -framework UIKit -framework CoreText -framework JavaScriptCore -framework AVFoundation \
  -parse-as-library \
  $PLATFORM_SRC "${HOST_SRCS[@]}" 2>&1)" || RC=$?
if [ "$RC" -ne 0 ]; then
  printf '%s\n' "$OUT" | tail -20
  echo "✗ 类型检查失败（exit ${RC}）"
  exit "$RC"
fi

# ★★重复键门禁（2026-09-30 加）：字典**字面量**里插两组相同键 ⇒ 编译期只出**告警**
#   （exit 0）、运行期是 fatalError（`Dictionary literal contains duplicate keys`）。
#   本仓已踩两次（模拟器闪退 / A/B 报告路径——paint_hint_env 被插两次），
#   两次都**悄悄漏过**本脚本（旧版忽略告警）⇒ 在此把该告警升级为红。
if printf '%s' "$OUT" | grep -q "duplicate entries for string literal key"; then
  echo "✗ 检测到字典字面量重复键（编译告警 · 运行必崩）——必须先修："
  printf '%s\n' "$OUT" | grep -n -B1 -A1 "duplicate entries for string literal key" | head -12
  exit 1
fi

# ★★L4 观测夹具（l4-scene.swift）是**独立 App**（自带 @main）——单文件单独 typecheck，
#   不进 HOST_SRCS（会与主 App 的 @main 冲突）。改它之后本脚本同样覆盖。
echo "==> 类型检查 L4 观测夹具（l4-scene.swift · 独立 App）"
L4_SRC="$HERE/ProteusHost/l4-scene.swift"
[ -f "$L4_SRC" ] || { echo "✗ 找不到 $L4_SRC"; exit 2; }
if ! OUT_L4="$(xcrun --sdk iphonesimulator swiftc -typecheck \
      -target arm64-apple-ios15.0-simulator -framework UIKit -parse-as-library "$L4_SRC" 2>&1)"; then
  printf '%s\n' "$OUT_L4" | tail -10
  echo "✗ L4 夹具类型检查失败"
  exit 1
fi

echo "✅ iOS 宿主类型检查通过（改动 selfdraw-scene.swift / l4-scene.swift 后先跑本脚本，再上真机）"

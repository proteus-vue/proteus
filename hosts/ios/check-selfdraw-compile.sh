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
HOST_SRC="$HERE/ProteusHost/selfdraw-scene.swift"

[ -f "$HOST_SRC" ] || { echo "✗ 找不到宿主源码：$HOST_SRC"; exit 2; }

# ★与 run-selfdraw.sh 的编译参数**保持一致**（否则本地绿、设备红——"验证了但验的是别的"）：
#   sdk=iphoneos · target arm64-apple-ios15.0 · 同批 framework
echo "==> 类型检查 iOS 自绘宿主（swiftc -typecheck · 零设备）"
xcrun --sdk iphoneos swiftc -typecheck \
  -target arm64-apple-ios15.0 \
  -framework UIKit -framework CoreText -framework JavaScriptCore \
  -parse-as-library \
  "$HOST_SRC"

echo "✅ iOS 宿主类型检查通过（改动 selfdraw-scene.swift 后先跑本脚本，再上真机）"

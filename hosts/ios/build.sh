#!/usr/bin/env bash
# hosts/ios/build.sh —— 构建可运行的 iOS 模拟器 App（★竖切 M1）
#
# 为什么要这套脚本（而不是 Xcode 工程）：
#   竖切阶段的目标是「链路能否跑通」——用 swiftc 直出 + 手工组装 .app 包最快，
#   且**无 .xcodeproj 二进制**（纯文本可 review、CI 可跑）。等 M3+ 接入真实构建链再谈工程化。
#
# 步骤：① JS bundle（esbuild）② Swift 编译（swiftc，链接 JavaScriptCore）
#      ③ 组装 .app 包（Info.plist + 可执行 + bundle.js）
#
# 用法：bash hosts/ios/build.sh [--simulator "iPhone 16"]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/build"
APP="$BUILD/ProteusHost.app"
SIM_NAME="${2:-iPhone 16}"

echo "==> ① JS bundle（Vue + Dispatcher + NativeBackend → 单文件 IIFE）"
node "$HERE/bridge/build.mjs"

echo "==> ② Swift 编译（swiftc → 模拟器 SDK）"
TARGET="arm64-apple-ios15.0-simulator"
mkdir -p "$BUILD"
# ★`xcrun --sdk iphonesimulator swiftc`——避免 clang 误用 macOS sysroot
xcrun --sdk iphonesimulator swiftc \
  -target "$TARGET" \
  -framework UIKit -framework JavaScriptCore \
  -parse-as-library \
  -o "$BUILD/ProteusHost" \
  "$HERE/ProteusHost/main.swift"

echo "==> ③ 组装 .app 包"
rm -rf "$APP"
mkdir -p "$APP"
cp "$BUILD/ProteusHost" "$APP/ProteusHost"
cp "$HERE/bridge/dist/bundle.js" "$APP/bundle.js"
cat > "$APP/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>ProteusHost</string>
  <key>CFBundleIdentifier</key><string>dev.proteus.host</string>
  <key>CFBundleName</key><string>ProteusHost</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSRequiresIPhoneOS</key><true/>
  <key>MinimumOSVersion</key><string>15.0</string>
  <key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
  <key>UILaunchScreen</key><dict/>
  <key>UIApplicationSceneManifest</key>
  <dict>
    <key>UIApplicationSupportsMultipleScenes</key><false/>
    <key>UISceneConfigurations</key>
    <dict/>
  </dict>
  <key>UISupportedInterfaceOrientations</key>
  <array><string>UIInterfaceOrientationPortrait</string></array>
</dict>
</plist>
PLIST

echo "==> 完成：$APP"
ls -la "$APP"
echo
echo "安装并运行："
echo "  xcrun simctl boot \"$SIM_NAME\" 2>/dev/null || true"
echo "  xcrun simctl install booted \"$APP\""
echo "  xcrun simctl launch --console-pty booted dev.proteus.host"

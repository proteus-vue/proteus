#!/usr/bin/env bash
# hosts/ios/experiments/run.sh —— 构建 + 跑实验 + 取回报告
#
# 用法：bash hosts/ios/experiments/run.sh [simulator-name]
# 产物：hosts/ios/experiments/results/experiments.json（+ 打印到 stdout）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
BUILD="$HERE/build"
APP="$BUILD/Experiments.app"
RESULTS="$HERE/results"
SIM="${1:-iPhone 18 Pro}"
BUNDLE_ID="dev.proteus.experiments"

echo "==> ① 编译（release 优化——性能实验必须 -O）"
mkdir -p "$BUILD" "$RESULTS"
# ★`xcrun --sdk iphonesimulator swiftc`——避免 clang 误用 macOS sysroot（见 run-device.sh 注释）
xcrun --sdk iphonesimulator swiftc -O \
  -target arm64-apple-ios15.0-simulator \
  -framework UIKit -framework CoreText \
  -parse-as-library \
  -o "$BUILD/Experiments" \
  "$HERE/Experiments/main.swift"

echo "==> ② 组装 .app"
rm -rf "$APP"; mkdir -p "$APP"
cp "$BUILD/Experiments" "$APP/Experiments"
cat > "$APP/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Experiments</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>Experiments</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSRequiresIPhoneOS</key><true/>
  <key>MinimumOSVersion</key><string>15.0</string>
  <key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
  <key>UILaunchScreen</key><dict/>
  <key>UIApplicationSceneManifest</key>
  <dict><key>UIApplicationSupportsMultipleScenes</key><false/><key>UISceneConfigurations</key><dict/></dict>
  <key>UISupportedInterfaceOrientations</key>
  <array><string>UIInterfaceOrientationPortrait</string></array>
</dict>
</plist>
PLIST

echo "==> ③ 启动模拟器并安装"
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null 2>&1 || true
xcrun simctl uninstall booted "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install booted "$APP"

echo "==> ④ 运行实验（等待完成信号，最长 180s）"
xcrun simctl launch booted "$BUNDLE_ID" >/dev/null
DEADLINE=$(( $(date +%s) + 180 ))
CONT=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  CONT="$(xcrun simctl get_app_container booted "$BUNDLE_ID" data 2>/dev/null || true)"
  if [ -n "$CONT" ] && [ -f "$CONT/Documents/experiments.json" ]; then break; fi
  sleep 2
done
if [ -z "$CONT" ] || [ ! -f "$CONT/Documents/experiments.json" ]; then
  echo "✗ 未取到 experiments.json（超时或崩溃）"; exit 1
fi
cp "$CONT/Documents/experiments.json" "$RESULTS/experiments.json"
echo "==> ⑤ 报告：$RESULTS/experiments.json"
cat "$RESULTS/experiments.json"

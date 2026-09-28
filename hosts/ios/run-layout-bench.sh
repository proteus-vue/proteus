#!/usr/bin/env bash
# hosts/ios/run-layout-bench.sh
# ★★M4 主体：iOS 端 4050 元素测试（拍平 vs 不拍平 vs 原生 UILabel）
# 用法：bash hosts/ios/run-layout-bench.sh [设备UDID]
set -euo pipefail

# ★解析可用的 Xcode（devicectl/xcodebuild 只在完整 Xcode 里；本机 Xcode 在非默认位置）
#   详见 hosts/ios/lib/xcode-env.sh —— 导出 DEVELOPER_DIR，免去每次手工指定。
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/xcode-env.sh"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/build"; APP="$BUILD/ProteusBench.app"
BUNDLE_ID="dev.proteus.layoutcore"   # ★复用已被设备信任的 id（新 id 需手动信任，且免费账号有额度限制）
RUST_CRATE="$ROOT/packages/layout-core-rust"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/spike/target}"
mkdir -p "$BUILD"

UDID="${1:-}"
[ -n "$UDID" ] || UDID="$(xcrun devicectl list devices 2>/dev/null | grep -vE 'simulated' | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' | head -1 || true)"
[ -n "$UDID" ] || { echo "✗ 未发现真机"; exit 2; }

echo "==> ① 编译 Rust 核心（iOS release）"
export PATH="$HOME/.cargo/bin:$PATH"
[ "$(command -v cargo)" = "$HOME/.cargo/bin/cargo" ] || { echo "✗ cargo 未解析到 rustup"; exit 3; }
(cd "$RUST_CRATE" && cargo build --release --target aarch64-apple-ios)
LIB="$CARGO_TARGET_DIR/aarch64-apple-ios/release/libproteus_layout_core.a"

echo "==> ② 编译 Swift 宿主"
rm -rf "$APP"; mkdir -p "$APP"
xcrun --sdk iphoneos swiftc -O -target arm64-apple-ios15.0 \
  -framework UIKit -framework CoreText -parse-as-library \
  -o "$APP/ProteusBench" "$HERE/ProteusHost/layout-core-bench.swift" "$LIB"

echo "==> ③ 组装 .app"
cat > "$APP/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>ProteusBench</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>ProteusBench</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>MinimumOSVersion</key><string>15.0</string>
  <key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
  <key>UILaunchScreen</key><dict/>
  <key>UIApplicationSceneManifest</key>
  <dict><key>UIApplicationSupportsMultipleScenes</key><false/><key>UISceneConfigurations</key><dict/></dict>
</dict></plist>
PLIST

echo "==> ④ 签名"
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Apple Development|iPhone Developer/ {print $2; exit}')"
[ -n "$IDENTITY" ] || { echo "✗ 无签名身份"; exit 4; }
PROFILE=""
for pf in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"/*.mobileprovision; do
  [ -f "$pf" ] || continue
  security cms -D -i "$pf" > "$BUILD/probe.plist" 2>/dev/null || continue
  APPID="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$BUILD/probe.plist" 2>/dev/null || true)"
  case "$APPID" in *".$BUNDLE_ID") PROFILE="$pf"; break ;; esac
done
if [ -n "$PROFILE" ]; then
  /usr/libexec/PlistBuddy -x -c 'Print :Entitlements' "$BUILD/probe.plist" > "$BUILD/entitlements.plist"
  cp "$PROFILE" "$APP/embedded.mobileprovision"
  codesign --force --sign "$IDENTITY" --entitlements "$BUILD/entitlements.plist" --timestamp=none "$APP"
else
  echo "    ⚠ 无匹配描述文件（先 provision ${BUNDLE_ID}）"; codesign --force --sign "$IDENTITY" --timestamp=none "$APP"
fi

echo "==> ⑤ 安装并启动"
xcrun devicectl device install app --device "$UDID" "$APP" 2>&1 | tail -2
xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" 2>&1 | tail -1
sleep 6
echo "==> ⑥ 取回报告"
mkdir -p "$HERE/results"
xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
  --domain-identifier "$BUNDLE_ID" --source Documents/layout-core-bench.json \
  --destination "$HERE/results/layout-core-bench-ios.json" 2>&1 | tail -1

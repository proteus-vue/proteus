#!/usr/bin/env bash
# hosts/ios/run-calayer-scene.sh
# ★★M4 起点：**iOS CALayer 路线**真机验证（方案 §6.2：宿主 UIView + CALayer 树，跳过 UIView）
#
# 【与 Android 侧的关系】两端用**同一套场景规格**（12 行 / 行高 40 / 同一颜色公式）
#   → 同一个核验脚本（hosts/android/screenshot-verify.py）可直接对拍。
#
# 用法：bash hosts/ios/run-calayer-scene.sh [设备UDID]
set -euo pipefail

# ★解析可用的 Xcode（devicectl/xcodebuild 只在完整 Xcode 里；本机 Xcode 在非默认位置）
#   详见 hosts/ios/lib/xcode-env.sh —— 导出 DEVELOPER_DIR，免去每次手工指定。
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/xcode-env.sh"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/build"
APP="$BUILD/ProteusCALayer.app"
BUNDLE_ID="dev.proteus.calayer"
RUST_CRATE="$ROOT/packages/layout-core-rust"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/spike/target}"

mkdir -p "$BUILD"

echo "==> ① 探测真机"
UDID="${1:-}"
if [ -z "$UDID" ]; then
  UDID="$(xcrun devicectl list devices 2>/dev/null | grep -vE 'simulated' | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' | head -1 || true)"
fi
[ -n "$UDID" ] || { echo "✗ 未发现真机"; exit 2; }
echo "    $UDID"

echo "==> ② 编译 Rust 核心（iOS release）"
export PATH="$HOME/.cargo/bin:$PATH"
[ "$(command -v cargo)" = "$HOME/.cargo/bin/cargo" ] || { echo "✗ cargo 未解析到 rustup（见 run-layout-core.sh 说明）"; exit 3; }
(cd "$RUST_CRATE" && cargo build --release --target aarch64-apple-ios)
LIB="$CARGO_TARGET_DIR/aarch64-apple-ios/release/libproteus_layout_core.a"
[ -f "$LIB" ] || { echo "✗ 静态库未生成"; exit 3; }

echo "==> ③ 编译 Swift 宿主（UIKit + 链接 Rust）"
rm -rf "$APP"; mkdir -p "$APP"
xcrun --sdk iphoneos swiftc -O \
  -target arm64-apple-ios15.0 \
  -framework UIKit -framework CoreText \
  -parse-as-library \
  -o "$APP/ProteusCALayer" \
  "$HERE/ProteusHost/dev/calayer-scene.swift" \
  "$LIB"

echo "==> ④ 组装 .app"
cat > "$APP/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>ProteusCALayer</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>ProteusCALayer</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>MinimumOSVersion</key><string>15.0</string>
  <key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
  <key>UILaunchScreen</key><dict/>
  <!-- ★启动屏**背景色**（本仓实测踩到的白屏根因）：
       「UILaunchScreen」空 dict ⇒ iOS 用**系统背景色**⇒ 浅色模式下是**白**，
       而本应用是深色（背景 #101020 / 黑）⇒ 启动瞬间**白一下**再变黑。
       「UIUserInterfaceStyle = Dark」让系统背景 = 黑 ⇒ 启动屏与首帧连续（白闪消失）。
       ★本应用所有颜色都是硬编码深色 ⇒ 强制深色**语义正确**（不是权宜之计）。
       ★★这里不能写反引号：本 heredoc 未加引号 ⇒ 反引号会被**命令替换执行**
         （实测：「UILaunchScreen: command not found」噪声，且注释文字被替换成空）。 -->
  <key>UIUserInterfaceStyle</key><string>Dark</string>
  <key>UIApplicationSceneManifest</key>
  <dict><key>UIApplicationSupportsMultipleScenes</key><false/><key>UISceneConfigurations</key><dict/></dict>
</dict>
</plist>
PLIST

echo "==> ⑤ 签名（复用已申请的描述文件 + 原样提取 entitlements）"
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
  echo "    ⚠ 未找到匹配 $BUNDLE_ID 的描述文件（需先 provision；否则可能装不上）"
  codesign --force --sign "$IDENTITY" --timestamp=none "$APP"
fi

echo "==> ⑥ 安装并启动"
xcrun devicectl device install app --device "$UDID" "$APP" 2>&1 | tail -3
xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" 2>&1 | tail -2

cat <<'MSG'

==> ⑦ 取回报告与截图
  sleep 4
  xcrun devicectl device copy from --device <UDID> --domain-type appDataContainer \
    --domain-identifier dev.proteus.calayer --source Documents/calayer-scene.json \
    --destination /tmp/calayer-scene.json
  xcrun devicectl device info files --device <UDID> --domain-type tmp ...
  # 截图：devicectl 无截图能力 → 用 xcrun devicectl device screenshot（若可用）或 Xcode
MSG

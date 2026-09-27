#!/usr/bin/env bash
# hosts/ios/experiments/device/run-layout-core.sh
# ★★把 **Rust 排版核心**送上真机：① 与浏览器基准的一致性 ② 4050 元素布局性能
#
# 【与 run-device.sh 的关系】那份跑 H1–H4（UIKit/CALayer 路线决策）；本脚本跑
#   「自研核心是否正确/够快」——两个问题、两份报告，互不污染。
#
# 【前置】设备已连接并信任 + Xcode 已登录 Apple ID（描述文件依赖，见 provision.sh）
#   Rust 侧需已装 iOS target：rustup target add aarch64-apple-ios
#
# 用法：bash hosts/ios/experiments/device/run-layout-core.sh [设备UDID]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
BUILD="$HERE/build"
RESULTS="$HERE/results"
APP="$BUILD/ProteusLayoutCore.app"
BUNDLE_ID="dev.proteus.layoutcore"
RUST_CRATE="$ROOT/packages/layout-core-rust"
GOLDEN="$RUST_CRATE/tests/golden/browser-layout.json"
# ★构建产物统一落 spike/target（data1），不写内置盘
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/spike/target}"

mkdir -p "$BUILD" "$RESULTS"

echo "==> ① 探测已连接真机"
UDID="${1:-}"
if [ -z "$UDID" ]; then
  # ★排除法（沿用 run-device.sh 的结论）：取「有 UDID 且整行不含 simulated」的第一台
  UDID="$(xcrun devicectl list devices 2>/dev/null | grep -vE 'simulated' | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' | head -1 || true)"
fi
[ -n "$UDID" ] || { echo "✗ 未发现真机（先连接并信任）"; exit 2; }
echo "    设备 UDID: $UDID"

echo "==> ② 编译 Rust 核心（aarch64-apple-ios release）"
# ★必须用 rustup 的 toolchain：本机 PATH 里 rustc 来自 Homebrew（/opt/homebrew/bin/rustc），
#   而 iOS target 是 `rustup target add` 装进 ~/.cargo 的 toolchain 里的 —— 两者不是同一套，
#   直接用 PATH 上的 cargo 会报 `error[E0463]: can't find crate for \`core\``（实测踩到两次）。
#   故**显式把 ~/.cargo/bin 前置**，并校验 cargo 确实来自那里。
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v cargo >/dev/null 2>&1 || [ "$(command -v cargo)" != "$HOME/.cargo/bin/cargo" ]; then
  echo "✗ cargo 未解析到 $HOME/.cargo/bin/cargo（当前：$(command -v cargo 2>/dev/null || echo 未找到)）"
  echo "  原因：本机另装了 Homebrew 的 rust，其 toolchain 里没有 iOS target。"
  echo "  修法：确认 \$HOME/.cargo/bin 在 PATH 前置（本脚本已做），或用 rustup 重装 rust。"
  exit 3
fi
rustup target list --installed | grep -q aarch64-apple-ios || {
  echo "✗ 未安装 iOS target —— 先执行：rustup target add aarch64-apple-ios"
  exit 3
}
(cd "$RUST_CRATE" && cargo build --release --target aarch64-apple-ios)
LIB="$CARGO_TARGET_DIR/aarch64-apple-ios/release/libproteus_layout_core.a"
[ -f "$LIB" ] || { echo "✗ 静态库未生成：$LIB"; exit 3; }
echo "    静态库 $(du -h "$LIB" | awk '{print $1}')"

echo "==> ③ 编译 Swift 宿主（真机 SDK + 链接 Rust 静态库）"
# ★`xcrun --sdk iphoneos swiftc`（不用 -sdk 标志——后者会让 clang 用 macOS sysroot，见 run-device.sh 注释）
rm -rf "$APP"; mkdir -p "$APP"
xcrun --sdk iphoneos swiftc -O \
  -target arm64-apple-ios15.0 \
  -framework UIKit \
  -parse-as-library \
  -o "$APP/ProteusLayoutCore" \
  "$HERE/layout-core-device.swift" \
  "$LIB"

echo "==> ④ 组装 .app（含 golden —— 判据跟着核心一起上机）"
cp "$GOLDEN" "$APP/browser-layout.json"
cat > "$APP/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>ProteusLayoutCore</string>
  <key>CFBundleIdentifier</key><string>dev.proteus.layoutcore</string>
  <key>CFBundleName</key><string>ProteusLayoutCore</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>MinimumOSVersion</key><string>15.0</string>
  <key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
  <key>UILaunchScreen</key><dict/>
</dict>
</plist>
PLIST

echo "==> ⑤ 签名（复用 provision.sh 申请的描述文件 + entitlements）"
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Apple Development|iPhone Developer/ {print $2; exit}')"
[ -n "$IDENTITY" ] || { echo "✗ 无签名身份——先按 provision.sh 的指引在 Xcode 登录 Apple ID"; exit 4; }

# ★描述文件位置：Xcode 把为「swiftc 直编 + codesign」申请的描述文件放在 UserData 下
#   （不是 ~/Library/MobileDevice/Provisioning Profiles——那里为空，本仓实测踩到）
PROFILE=""
for pf in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"/*.mobileprovision; do
  [ -f "$pf" ] || continue
  security cms -D -i "$pf" > "$BUILD/probe.plist" 2>/dev/null || continue
  APPID="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$BUILD/probe.plist" 2>/dev/null || true)"
  case "$APPID" in
    *".$BUNDLE_ID") PROFILE="$pf"; break ;;
  esac
done

if [ -n "$PROFILE" ]; then
  # ★必须**原样**提取描述文件里的 entitlements，不得手工拼装：
  #   免费个人团队的描述文件除 application-identifier 外还要求
  #   `com.apple.developer.team-identifier` 与 `keychain-access-groups`，
  #   少一项即签名无效（实测症状：0xe8008016 invalid entitlements，见 run-device.sh 同款记录）
  /usr/libexec/PlistBuddy -x -c 'Print :Entitlements' "$BUILD/probe.plist" > "$BUILD/entitlements.plist" 2>/dev/null || true
  cp "$PROFILE" "$APP/embedded.mobileprovision"
  echo "    描述文件：$(basename "$PROFILE")"
else
  echo "    ⚠ 未找到匹配 $BUNDLE_ID 的描述文件"
  echo "      先申请：bash hosts/ios/experiments/device/provision.sh $BUNDLE_ID"
fi

if [ -s "$BUILD/entitlements.plist" ]; then
  codesign --force --sign "$IDENTITY" --entitlements "$BUILD/entitlements.plist" --timestamp=none "$APP"
else
  echo "    ⚠ 未取到描述文件 entitlements——尝试无 entitlements 签名（可能装不上）"
  codesign --force --sign "$IDENTITY" --timestamp=none "$APP"
fi

echo "==> ⑥ 安装到真机"
xcrun devicectl device install app --device "$UDID" "$APP" 2>&1 | tail -5

echo "==> ⑦ 启动（报告写入 App 的 Documents）"
xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" 2>&1 | tail -3

cat <<'MSG'

==> ⑧ 取回报告
   等 3–5 秒后执行（本脚本已打印 App 容器路径，把下两行替换为实际路径）：
     xcrun devicectl device info files --device <UDID> --domain-type appDataContainer --domain-identifier dev.proteus.layoutcore
     # 或直接看日志（更快）：
     xcrun devicectl device console --device <UDID> 2>&1 | grep -A 30 "Rust 排版核心"
MSG

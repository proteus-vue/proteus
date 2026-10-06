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
  -o "$APP/ProteusBench" "$HERE/ProteusHost/dev/layout-core-bench.swift" "$LIB"

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
  <!-- ★启动屏**背景色**（本仓实测踩到的白屏根因）：
       「UILaunchScreen」空 dict ⇒ iOS 用**系统背景色**⇒ 浅色模式下是**白**，
       而本应用是深色（背景 #101020 / 黑）⇒ 启动瞬间**白一下**再变黑。
       「UIUserInterfaceStyle = Dark」让系统背景 = 黑 ⇒ 启动屏与首帧连续（白闪消失）。
       ★本应用所有颜色都是硬编码深色 ⇒ 强制深色**语义正确**（不是权宜之计）。
       ★★这里不能写反引号：本 heredoc 未加引号 ⇒ 反引号会被**命令替换执行**。 -->
  <key>UIUserInterfaceStyle</key><string>Dark</string>
  <key>UIApplicationSceneManifest</key>
  <dict><key>UIApplicationSupportsMultipleScenes</key><false/><key>UISceneConfigurations</key><dict/></dict>
</dict></plist>
PLIST

echo "==> ④ 签名"
# ★★签名身份解析（2026-10-02 实测坑）：本机有两张**同名**证书（一张已吊销）——
#   `--sign "名字"` 会报 ambiguous 而静默失败（实测：报告没被刷新，看到的是旧数据）。
#   修法：取 `find-identity -v`（只列**有效**）行的 **SHA-1 哈希**（第 2 列），用哈希签名。
#   ★`-v` 的输出里**吊销证书也带**「(CSSMERR_TP_CERT_REVOKED)」后缀且可能排在前
#     ⇒ 必须先 `grep -v REVOKED` 再取（首版漏了这步，取到吊销证书 → 安装失败 -402620392）。
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | grep -v REVOKED | grep -E 'Apple Development|iPhone Developer' | head -1 | awk '{print $2}')"
[ -n "$IDENTITY" ] || { echo "✗ 无有效签名身份"; exit 4; }
echo "    签名身份 SHA-1：$IDENTITY"
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

echo "==> ⑤ 安装并启动（事件驱动：报告落盘后自退——launch --console 返回即完成）"
# ★★2026-09-30 重写（用户红线：「禁止任何 sleep/timeout——要么 App 主动上报，要么有条件等待」）：
#   原实现 `launch` 后 `sleep 6` 再取报告（盲等；报告晚了就静默取到旧数据）。
#   现在：宿主 `PROTEUS_EXIT_AFTER_REPORT=1` ⇒ 报告落盘后进程自退；
#   `launch --console` **阻塞到进程退出**才返回 ⇒ 返回即完成。零睡眠 / 零轮询。
xcrun devicectl device install app --device "$UDID" "$APP" 2>&1 | tail -2
LB_LOG="$(mktemp)"
xcrun devicectl device process launch --console --terminate-existing \
  --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
  --device "$UDID" "$BUNDLE_ID" > "$LB_LOG" 2>&1 || true
if grep -q "BENCH_REPORT_READY" "$LB_LOG"; then
  echo "    App 已主动上报（报告落盘后退出）"
else
  echo "    ⚠ 日志未见 BENCH_REPORT_READY —— 以取回的报告为准；日志尾："
  tail -5 "$LB_LOG" | sed 's/^/      /'
fi
rm -f "$LB_LOG"
echo "==> ⑥ 取回报告（App 已退出 ⇒ 一次取回；无 sleep）"
mkdir -p "$HERE/results"
xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
  --domain-identifier "$BUNDLE_ID" --source Documents/layout-core-bench.json \
  --destination "$HERE/results/layout-core-bench-ios.json" 2>&1 | tail -1

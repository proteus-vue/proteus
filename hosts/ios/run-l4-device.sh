#!/usr/bin/env bash
# hosts/ios/run-l4-device.sh —— L4 观测夹具（iOS）在**真机**上采集截图 → 入库
#
# 【与 run-l4-sim.sh 的差别（为什么真机要单独一个脚本）】
#   · 取屏方式不同：`simctl io screenshot`（模拟器）**不适用**；devicectl **没有截图能力**
#     （run-calayer-scene.sh 头注已记）⇒ 真机走 **App 内渲染自存**：视图渲染为 PNG 写
#     Documents/l4-scene.png（`layer.render` = CoreAnimation 同一光栅化路径——本仓已验证模式，
#     见 l4-scene.swift 的 `savePng()`），再由 `devicectl device copy from` 取回。
#   · 完成信号：`PROTEUS_EXIT_AFTER_REPORT=1` + `launch --console`（**阻塞到 App 退出才返回**
#     ⇒ 返回即报告与 PNG 均已落盘 —— 零轮询 / 零 sleep / 零 timeout，本仓事件驱动纪律）。
#
# 【★bundle id 复用 dev.proteus.calayer（覆盖设备上的 ProteusCALayer 实验 app）】
#   免费开发者账号在设备上**最多 3 个 app**，而设备上现有 3 个 dev.proteus.*（实测
#   `devicectl device info apps`）⇒ 新增 bundle id 会被 "maximum number of installed apps" 拒。
#   选 calayer：语义最近（同为 CALayer 路线观测装置）、描述文件有效。
#   换 id：`PROTEUS_L4_BUNDLE_ID=dev.proteus.xxx bash hosts/ios/run-l4-device.sh`。
#
# 用法：bash hosts/ios/run-l4-device.sh [UDID]
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/xcode-env.sh"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/build-l4-device"
APP="$BUILD/L4SceneDevice.app"
BUNDLE_ID="${PROTEUS_L4_BUNDLE_ID:-dev.proteus.calayer}"
OUT="${PROTEUS_L4_OUT:-$ROOT/docs/generated/consistency-samples/pixels}"

mkdir -p "$BUILD" "$OUT"

echo "==> ① 探测真机"
UDID="${1:-}"
if [ -z "$UDID" ]; then
  UDID="$(xcrun devicectl list devices 2>/dev/null | grep -vE 'simulated' \
    | grep -E 'physical|available' | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' | head -1 || true)"
fi
[ -n "$UDID" ] || { echo "✗ 未发现真机（devicectl list devices）"; exit 2; }
echo "    $UDID"

echo "==> ② 零设备类型检查（改 Swift 先过这一步）"
if ! xcrun --sdk iphoneos swiftc -typecheck -target arm64-apple-ios15.0 \
      -framework UIKit -parse-as-library "$HERE/ProteusHost/l4-scene.swift" 2>&1 | head -8; then
  echo "✗ 类型检查失败"; exit 2
fi

echo "==> ③ 编译（设备 SDK）"
rm -rf "$APP"; mkdir -p "$APP"
xcrun --sdk iphoneos swiftc -O -target arm64-apple-ios15.0 \
  -framework UIKit -parse-as-library \
  -o "$APP/L4SceneDevice" "$HERE/ProteusHost/l4-scene.swift" 2>&1 | grep -E "error:" | head -5
[ -f "$APP/L4SceneDevice" ] || { echo "✗ Swift 编译未产出可执行文件"; exit 3; }

echo "==> ④ 组装 .app + 签名"
PROFILE=""
PROBE="$BUILD/probe.plist"
for pf in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"/*.mobileprovision; do
  [ -f "$pf" ] || continue
  security cms -D -i "$pf" > "$PROBE" 2>/dev/null || continue
  APPID="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$PROBE" 2>/dev/null || true)"
  case "$APPID" in *".$BUNDLE_ID") PROFILE="$pf"; break ;; esac
done
[ -n "$PROFILE" ] || { echo "✗ 无匹配描述文件（BUNDLE_ID=${BUNDLE_ID}；换：PROTEUS_L4_BUNDLE_ID=... ）"; exit 3; }

cat > "$APP/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>L4SceneDevice</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>L4Scene</string>
  <key>CFBundleDisplayName</key><string>L4 Scene</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>MinimumOSVersion</key><string>15.0</string>
  <key>UIDeviceFamily</key><array><integer>1</integer></array>
  <key>UILaunchScreen</key><dict/>
  <key>UIUserInterfaceStyle</key><string>Dark</string>
  <key>UIApplicationSceneManifest</key><dict>
    <key>UIApplicationSupportsMultipleScenes</key><false/>
  </dict>
  <key>UISupportedInterfaceOrientations</key><array><string>UIInterfaceOrientationPortrait</string></array>
</dict></plist>
PLIST

# ★entitlements 必须 `PlistBuddy -x` 导出 XML（只 Print 得到"描述"→ codesign 报 invalid blob）
/usr/libexec/PlistBuddy -x -c 'Print :Entitlements' "$PROBE" > "$BUILD/entitlements.plist"
cp "$PROFILE" "$APP/embedded.mobileprovision"
# ★按 SHA-1 选身份（同名证书可能有一张已吊销；按名称选会命中吊销的那张——本仓实测 0xe8008018）
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
  | grep -v CSSMERR | grep -E 'Apple Development|iPhone Developer' \
  | grep -oE '[0-9A-F]{40}' | head -1)"
[ -n "$IDENTITY" ] || { echo "✗ 无有效签名身份"; exit 3; }
codesign --force --sign "$IDENTITY" --entitlements "$BUILD/entitlements.plist" --timestamp=none "$APP" 2>&1 | tail -1
echo "    身份：${IDENTITY:0:12}… · 描述文件：$(basename "$PROFILE")"

echo "==> ⑤ 安装"
INSTALL_LOG="$(mktemp)"
if ! xcrun devicectl device install app --device "$UDID" "$APP" > "$INSTALL_LOG" 2>&1; then
  echo "✗ 安装失败："
  grep -E "maximum number of installed apps|Invalid|error [0-9]+|Failed" "$INSTALL_LOG" | head -5 | sed 's/^/    /'
  rm -f "$INSTALL_LOG"; exit 4
fi
rm -f "$INSTALL_LOG"
echo "    已安装（覆盖 $BUNDLE_ID 旧版本——免费账号 3-app 上限下复用该 id）"

echo "==> ⑥ 启动（阻塞到 App 退出 = 报告与 PNG 已落盘；零轮询）"
LAUNCH_LOG="$(mktemp)"
xcrun devicectl device process launch --console --terminate-existing \
  --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
  --device "$UDID" "$BUNDLE_ID" > "$LAUNCH_LOG" 2>&1 || true
if grep -qiE "not.*trusted|denied|Unable to launch" "$LAUNCH_LOG"; then
  echo "✗ 启动被拒（首次装该证书的 app 需在设备上手动信任：设置 → 通用 → VPN与设备管理）："
  grep -iE "not.*trusted|denied|Unable" "$LAUNCH_LOG" | head -3 | sed 's/^/    /'
  rm -f "$LAUNCH_LOG"; exit 5
fi
rm -f "$LAUNCH_LOG"

echo "==> ⑦ 取回（报告 + PNG）"
RPT_TMP="$BUILD/l4-scene.json"
PNG_TMP="$BUILD/l4-scene.png"
xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
  --domain-identifier "$BUNDLE_ID" --source "Documents/l4-scene.json" --destination "$RPT_TMP" >/dev/null 2>&1 \
  || { echo "✗ 取回报告失败"; exit 6; }
xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
  --domain-identifier "$BUNDLE_ID" --source "Documents/l4-scene.png" --destination "$PNG_TMP" >/dev/null 2>&1 \
  || { echo "✗ 取回 PNG 失败（App 内渲染自存失败？看报告 shot 字段）"; exit 6; }

# 报告里 shot 必须不是 FAILED（机器判据——不静默）
if grep -q '"shot" : "FAILED"' "$RPT_TMP" 2>/dev/null; then
  echo "✗ 报告里 shot=FAILED（App 内渲染失败）"; exit 6
fi

cp "$PNG_TMP" "$OUT/l4.ios-device.png"

echo "==> ⑧ 防假绿：特征色探针（含 Display P3 归一）"
node "$ROOT/scripts/probe-png-colors.mjs" "$OUT/l4.ios-device.png" "47,111,237" "124,92,255" "255,154,108" >/dev/null 2>&1 \
  || { echo "✗ 特征色未命中（截图无效）"; exit 7; }

cp "$RPT_TMP" "$HERE/results/l4-scene-device.json" 2>/dev/null || true
echo "  [l4.ios-device] $(ls -l "$OUT/l4.ios-device.png" | awk '{print $5}')B sha=$(shasum -a 256 "$OUT/l4.ios-device.png" | awk '{print substr($1,1,12)}')"

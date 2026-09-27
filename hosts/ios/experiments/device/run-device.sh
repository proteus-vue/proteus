#!/usr/bin/env bash
# hosts/ios/experiments/device/run-device.sh —— 真机跑对照实验（H3/H4 的关键证据源）
#
# 【为什么需要专门脚本】真机安装**必须代码签名**，而签名身份因机器而异 →
#   脚本自动探测可用身份；探测不到就**明确报错并给出解决步骤**（而不是静默失败）。
#
# 用法：
#   bash hosts/ios/experiments/device/run-device.sh [设备UDID]
#   # 不传 UDID → 自动选第一台已连接真机
#
# 前置（一次性）：
#   ① 数据线连接 iPhone，设备上点「信任此电脑」
#   ② Xcode → Settings → Accounts 登录 Apple ID（免费账号即可，自动生成开发证书）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
BUILD="$HERE/build"
APP="$BUILD/ProteusExperiments.app"
RESULTS="$HERE/results"
BUNDLE_ID="dev.proteus.experiments"

mkdir -p "$BUILD" "$RESULTS"

echo "==> ① 探测已连接真机"
UDID="${1:-}"
if [ -z "$UDID" ]; then
  # ★只取 reality=physical 的设备：devicectl 输出最后一列是 reality（simulated/physical）
  #   踩坑：初版用 `/physical|connected/` 匹配整行 → 把模拟器（现实列=simulated、状态列=connected）也算进来，
  #   且 awk $3 取到的是名字片段（"Pro"）而非 UDID。
  UDID="$(xcrun devicectl list devices 2>/dev/null | grep -E 'physical' | grep -vE 'simulated' | head -1 | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' | head -1 || true)"
fi
if [ -z "$UDID" ]; then
  cat <<'MSG'
✗ 未发现已连接的真机。

  请依次完成（缺一不可）：
    1) 用数据线连接 iPhone/iPad
    2) 设备上弹「要信任此电脑吗」→ 点『信任』
    3) Xcode → Settings → Accounts → 用 Apple ID 登录（免费账号即可）
       （首次会生成开发证书；本机当前 `security find-identity` 为 0 个）
    4) 确认 Xcode → Window → Devices 里能看到该设备
  然后重跑本脚本。
MSG
  exit 2
fi
echo "    设备 UDID: $UDID"

echo "==> ② 探测签名身份"
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Apple Development|iPhone Developer/ {print $2; exit}')"
if [ -z "$IDENTITY" ]; then
  cat <<'MSG'
✗ 没有可用的代码签名身份（Apple Development 证书）。

  解决：Xcode → Settings → Accounts → 登录 Apple ID（免费个人团队即可），
        Xcode 会自动创建开发证书与本机私钥；完成后 `security find-identity -v -p codesigning` 应有输出。
MSG
  exit 2
fi
TEAM_ID="$(security find-identity -v -p codesigning 2>/dev/null | grep -o '([A-Z0-9]*)' | head -1 | tr -d '()' || true)"
echo "    身份: $IDENTITY (team ${TEAM_ID:-unknown})"

echo "==> ③ 编译（release + 真机 SDK）"
# ★用 `xcrun --sdk iphoneos swiftc`（而非 -sdk 标志）：后者会让 clang 仍用 macOS sysroot
#   （实测警告 `using sysroot for 'macOS 27.0' but targeting 'arm64-apple-ios...'`）
xcrun --sdk iphoneos swiftc -O \
  -target arm64-apple-ios15.0 \
  -framework UIKit -framework CoreText \
  -parse-as-library \
  -o "$BUILD/ProteusExperiments" \
  "$HERE/main-device.swift"

echo "==> ④ 组装 + 签名 .app"
rm -rf "$APP"; mkdir -p "$APP"
cp "$BUILD/ProteusExperiments" "$APP/ProteusExperiments"
cat > "$APP/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>ProteusExperiments</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>ProteusExperiments</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSRequiresIPhoneOS</key><true/>
  <key>MinimumOSVersion</key><string>15.0</string>
  <key>UILaunchScreen</key><dict/>
  <key>UIApplicationSceneManifest</key>
  <dict><key>UIApplicationSupportsMultipleScenes</key><false/><key>UISceneConfigurations</key><dict/></dict>
  <key>UISupportedInterfaceOrientations</key>
  <array><string>UIInterfaceOrientationPortrait</string></array>
</dict>
</plist>
PLIST

# 无 .xcodeproj 的签名：codesign + 内嵌 provisioning profile（若存在）
PROFILE="$(ls ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision 2>/dev/null | head -1 || true)"
SIGN_ARGS=(--force --sign "$IDENTITY" --timestamp=none)
if [ -n "$PROFILE" ]; then
  cp "$PROFILE" "$APP/embedded.mobileprovision"
  ENTITLEMENTS="$BUILD/entitlements.plist"
  # 从描述文件里提取 application-identifier（免费账号为 <TEAMID>.<bundleid>）
  security cms -D -i "$PROFILE" > "$BUILD/profile.plist" 2>/dev/null || true
  APPID="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$BUILD/profile.plist" 2>/dev/null || true)"
  if [ -n "$APPID" ]; then
    cat > "$ENTITLEMENTS" <<ENT
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>application-identifier</key><string>$APPID</string>
  <key>get-task-allow</key><true/>
</dict></plist>
ENT
    SIGN_ARGS+=(--entitlements "$ENTITLEMENTS")
  fi
fi
codesign "${SIGN_ARGS[@]}" "$APP" 2>&1 | tail -3

echo "==> ⑤ 安装到设备"
xcrun devicectl device install app --device "$UDID" "$APP"

echo "==> ⑥ 启动并等待报告（真机实验约 30–90s）"
xcrun devicectl device process launch --device "$UDID" --console "$BUNDLE_ID" > "$BUILD/device-console.log" 2>&1 &
LAUNCH_PID=$!
DEADLINE=$(( $(date +%s) + 240 ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if grep -q "ALL_DONE" "$BUILD/device-console.log" 2>/dev/null; then break; fi
  sleep 3
done
kill "$LAUNCH_PID" 2>/dev/null || true

# 从控制台抓 JSON（真机沙盒需通过 devicectl 拷贝）
if grep -q "PROTEUS_EXPERIMENTS_DONE" "$BUILD/device-console.log" 2>/dev/null; then
  python3 - "$BUILD/device-console.log" "$RESULTS/device.json" <<'PY'
import json, re, sys
text = open(sys.argv[1], encoding='utf-8', errors='replace').read()
m = re.search(r'\{[\s\S]*\}\s*$', text)
if m:
    json.dump(json.loads(m.group()), open(sys.argv[2], 'w'), ensure_ascii=False, indent=2)
    print('report →', sys.argv[2])
PY
else
  echo "✗ 未从控制台取到报告（最后一次输出）："; tail -20 "$BUILD/device-console.log" || true
  echo "  → 也可用 Instruments 采集：xcrun xctrace record --template 'Core Animation' --device $UDID --launch $BUNDLE_ID"
  exit 1
fi
echo "==> 完成：$RESULTS/device.json"
cat "$RESULTS/device.json"

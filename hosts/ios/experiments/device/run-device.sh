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

# ★解析可用的 Xcode（devicectl/xcodebuild 只在完整 Xcode 里；本机 Xcode 在非默认位置）
#   详见 hosts/ios/lib/xcode-env.sh —— 导出 DEVELOPER_DIR，免去每次手工指定。
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../lib/xcode-env.sh"

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
  # ★设备甄别规则（两次修正后的版本）
  #   踩坑① 初版 `awk '/physical|connected/ {print $3}'` → 模拟器状态列也是 connected，被算进来；
  #          且 $3 取到名字片段（"Pro"）而非 UDID。
  #   踩坑② 改用 `grep physical` → **真机那行的 reality 列是空的**（只有 simulated 的才标出来），
  #          于是真机反被漏掉（脚本报「未发现真机」而设备明明已配对）。
  #   正解：**排除法**——取「有 UDID 且整行不含 simulated」的第一台。
  UDID="$(xcrun devicectl list devices 2>/dev/null | grep -vE 'simulated' | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' | head -1 || true)"
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
TEAM_ID="$(security find-identity -v -p codesigning 2>/dev/null | grep -o '([A-Z0-9]*)' | head -1 | tr -d '()' || true)"
if [ -z "$IDENTITY" ]; then
  echo "    ✗ 无签名身份（Apple Development 证书）——环境未就绪，但**先做编译验证**以排除代码问题"
  # ★设计取舍：签名缺失时仍然编译——这样「代码是否可编译」与「环境是否可安装」是**两个独立信号**，
  #   用户配好 Apple ID 后能立刻知道是环境问题而非代码问题（避免来回试错）。
  SKIP_SIGN=1
else
  SKIP_SIGN=0
  echo "    身份: $IDENTITY (team ${TEAM_ID:-unknown})"
fi

echo "==> ③ 编译（release + 真机 SDK）"
# ★用 `xcrun --sdk iphoneos swiftc`（而非 -sdk 标志）：后者会让 clang 仍用 macOS sysroot
#   （实测警告 `using sysroot for 'macOS 27.0' but targeting 'arm64-apple-ios...'`）
xcrun --sdk iphoneos swiftc -O \
  -target arm64-apple-ios15.0 \
  -framework UIKit -framework CoreText \
  -parse-as-library \
  -o "$BUILD/ProteusExperiments" \
  "$HERE/main-device.swift"

if [ "$SKIP_SIGN" = "1" ]; then
  echo "==> ④ 跳过签名（无身份）——编译验证已完成"
  file "$BUILD/ProteusExperiments" | sed 's/^/    /'
  cat <<'MSG'

  ★ 环境待办（脚本已确认设备可探测，只差签名）：
      Xcode → Settings → Accounts → 用 Apple ID 登录（免费个人团队即可）
      登录后 `security find-identity -v -p codesigning` 应出现 "Apple Development: ..."，
      然后重跑本脚本即可完成安装与实验。

  ★ 同时确认设备已配对（本脚本会自动探测；若未配对可执行）：
      xcrun devicectl manage pair --device <UDID>
MSG
  exit 3
fi

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
  <!-- ★启动屏**背景色**（本仓实测踩到的白屏根因）：
       「UILaunchScreen」空 dict ⇒ iOS 用**系统背景色**⇒ 浅色模式下是**白**，
       而本应用是深色（背景 #101020 / 黑）⇒ 启动瞬间**白一下**再变黑。
       「UIUserInterfaceStyle = Dark」让系统背景 = 黑 ⇒ 启动屏与首帧连续（白闪消失）。
       ★本应用所有颜色都是硬编码深色 ⇒ 强制深色**语义正确**（不是权宜之计）。
       ★★这里不能写反引号：本 heredoc 未加引号 ⇒ 反引号会被**命令替换执行**。 -->
  <key>UIUserInterfaceStyle</key><string>Dark</string>
  <key>UIApplicationSceneManifest</key>
  <dict><key>UIApplicationSupportsMultipleScenes</key><false/><key>UISceneConfigurations</key><dict/></dict>
  <key>UISupportedInterfaceOrientations</key>
  <array><string>UIInterfaceOrientationPortrait</string></array>
</dict>
</plist>
PLIST

# ── 签名：必须用**与 bundle id 匹配**的描述文件 + 其携带的 entitlements ──
#   踩坑记录（实测 0xe8008016 invalid entitlements）：
#     初版手工拼 `<TEAMID>.<bundleid>` 并只写 application-identifier/get-task-allow
#     → 安装时报 "Failed to verify code signature ... invalid entitlements"。
#   根因：免费个人团队的描述文件除 application-identifier 外，**还要求**
#     `com.apple.developer.team-identifier` 与 `keychain-access-groups`（少一项即签名无效）。
#   正解：**从描述文件里原样提取 entitlement**，不做任何手工拼装。
PROFILE=""
for pf in ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision; do
  [ -f "$pf" ] || continue
  security cms -D -i "$pf" > "$BUILD/probe.plist" 2>/dev/null || continue
  APPID="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$BUILD/probe.plist" 2>/dev/null || true)"
  case "$APPID" in
    *".$BUNDLE_ID") PROFILE="$pf"; break ;;
  esac
done

if [ -z "$PROFILE" ]; then
  cat <<MSG
✗ 未找到匹配 bundle id（${BUNDLE_ID}）的描述文件。

  Xcode 只在**实际构建某个工程**时才会为该 bundle id 生成描述文件。
  请任选其一：
    a) 用 Xcode 打开任一 iOS 工程并把 Bundle Identifier 设为 $BUNDLE_ID 后构建一次；或
    b) 先跑本仓库的触发脚本：
         bash hosts/ios/experiments/device/provision.sh
       它会用最小工程为 $BUNDLE_ID 申请描述文件（需已登录 Apple ID）。
MSG
  exit 4
fi
echo "    描述文件: $(basename "$PROFILE")"

cp "$PROFILE" "$APP/embedded.mobileprovision"
security cms -D -i "$PROFILE" > "$BUILD/profile.plist" 2>/dev/null
# ★原样导出描述文件携带的 entitlements（不手工拼装——见上方踩坑记录）
/usr/libexec/PlistBuddy -x -c 'Print :Entitlements' "$BUILD/profile.plist" > "$BUILD/entitlements.plist"

codesign --force --sign "$IDENTITY" --timestamp=none \
  --entitlements "$BUILD/entitlements.plist" "$APP" 2>&1 | tail -3
echo "    签名完成，校验："
codesign -dv --entitlements - "$APP" 2>&1 | grep -E "Identifier|application-identifier|team-identifier" | sed 's/^/      /'

echo "==> ⑤ 安装到设备"
xcrun devicectl device install app --device "$UDID" "$APP"

echo "==> ⑥ 启动并等待报告（真机实验约 30–90s）"
xcrun devicectl device process launch --device "$UDID" --console "$BUNDLE_ID" > "$BUILD/device-console.log" 2>&1 &
LAUNCH_PID=$!
DEADLINE=$(( $(date +%s) + 240 ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if grep -q "PROTEUS_EXP. ALL_DONE" "$BUILD/device-console.log" 2>/dev/null; then break; fi
  sleep 3
done
kill "$LAUNCH_PID" 2>/dev/null || true

if ! grep -q "PROTEUS_EXP. ALL_DONE" "$BUILD/device-console.log" 2>/dev/null; then
  echo "✗ 实验未跑完（最后一次输出）："; tail -20 "$BUILD/device-console.log" || true
  echo "  → 也可用 Instruments：xcrun xctrace record --template 'Core Animation' --device $UDID --launch $BUNDLE_ID"
  exit 1
fi

# ★真机报告取自**设备沙盒**（不走 stdout）——真机 console 只回显 print/进度打点，
#   完整 JSON 在 App 容器里，需经 devicectl 拷贝。
#   踩坑：初版只从 stdout 正则抓 JSON → 真机上永远抓不到（日志里只有 9 行进度打点）。
echo "==> ⑦ 从设备沙盒取回报告"
xcrun devicectl device copy from --device "$UDID" \
  --domain-type appDataContainer --domain-identifier "$BUNDLE_ID" \
  --source Documents/experiments.json --destination "$RESULTS/device.json" 2>&1 | tail -2

echo "==> 完成：$RESULTS/device.json"
cat "$RESULTS/device.json"

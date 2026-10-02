#!/usr/bin/env bash
# hosts/ios/run-l4-sim.sh —— L4 观测夹具（iOS）在**模拟器**上采集截图 → 入库
#
# 【与其它 L4 采集脚本同一纪律】
#   · 事件驱动（零盲等）：App 侧 `PROTEUS_EXIT_AFTER_REPORT=1` ⇒ 报告落盘后自退；
#     `simctl launch --console` **阻塞到进程退出**才返回 ⇒ 返回即完成（本仓既定机制，
#     见 run-selfdraw-sim.sh 的同段注释——那里记录了这个机制的由来）。
#   · 取屏 = `simctl io booted screenshot`（模拟器自带；无须 App 内截图通道）。
#   · 防假绿：报告 on 屏幕尺寸 + 特征色探针（截到空白/启动屏当场红）。
#
# 【为什么先 typecheck 再编译】本仓红线：改 Swift 宿主先过零设备编译检查
#   （`check-selfdraw-compile.sh` 覆盖主 App 的源码集；本脚本先对 l4-scene.swift 单文件 typecheck）。
#
# 用法：bash hosts/ios/run-l4-sim.sh [模拟器名]
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/xcode-env.sh"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/build-l4"
APP="$BUILD/L4Scene.app"
BUNDLE_ID="dev.proteus.l4scene"
OUT="${PROTEUS_L4_OUT:-$ROOT/docs/generated/consistency-samples/pixels}"
SIM_NAME="${1:-iPhone 18 Pro}"

mkdir -p "$BUILD" "$OUT"

echo "==> ① 零设备类型检查（改 Swift 先过这一步）"
if ! xcrun --sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios15.0-simulator \
      -framework UIKit -parse-as-library "$HERE/ProteusHost/l4-scene.swift" 2>&1 | head -8; then
  echo "✗ 类型检查失败"; exit 2
fi

echo "==> ② 编译（模拟器 SDK）"
rm -rf "$APP"; mkdir -p "$APP"
xcrun --sdk iphonesimulator swiftc -O -target arm64-apple-ios15.0-simulator \
  -framework UIKit -parse-as-library \
  -o "$APP/L4Scene" "$HERE/ProteusHost/l4-scene.swift" 2>&1 | grep -E "error:" | head -5
[ -f "$APP/L4Scene" ] || { echo "✗ Swift 编译未产出可执行文件"; exit 3; }

echo "==> ③ 组装 .app"
cat > "$APP/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>L4Scene</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>L4Scene</string>
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

echo "==> ④ 启动模拟器（bootstatus 阻塞到完成——无轮询/无 sleep）"
xcrun simctl bootstatus "$SIM_NAME" -b >/dev/null 2>&1 || { echo "✗ 模拟器未能启动：$SIM_NAME"; exit 4; }

echo "==> ⑤ 安装 + 启动（★不自退：截图必须在进程活着时做）"
xcrun simctl uninstall booted "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl install booted "$APP" || { echo "✗ 安装失败"; exit 4; }
# ★容器路径必须在 install 之后取（本仓实测：安装会换容器）
CONTAINER="$(xcrun simctl get_app_container booted "$BUNDLE_ID" data 2>/dev/null || true)"
[ -n "$CONTAINER" ] || { echo "✗ 取不到数据容器"; exit 4; }

# ★★为什么**不**用 PROTEUS_EXIT_AFTER_REPORT（本批实测踩到）：
#   自退会让 App 在 `simctl io screenshot` 之前终止 ⇒ 截到的是**主屏**（不是本场景）。
#   报告落盘只证明"画过"，不证明"窗口还在"⇒ 截图与报告必须**同进程活着**时完成。
#   条件等待改为：报告文件出现（= 首帧已提交）⇒ 立刻截图 ⇒ 再杀进程（清理）。
xcrun simctl launch booted "$BUNDLE_ID" >/dev/null 2>&1 || { echo "✗ 启动失败"; exit 5; }
# ★有条件等待（本仓唯一允许含 sleep 的原语 wait_for.sh；--file 探测 + 总超时，非盲等）：
#   首版写"for 60 轮查文件"是**错的**——循环里没有间隔 ⇒ 毫秒内空转完 60 轮，
#   App 根本没时间渲染（实测：报告未落盘就报超时）。条件等待必须有真实探测间隔。
bash "$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh" \
  --file "$CONTAINER/Documents/l4-scene.json" --timeout 90 --interval 1 \
  || { echo "✗ 报告未落盘（wait_for 超时）"; exit 5; }

echo "==> ⑥ 取屏（App 仍在运行；报告已保证首帧提交）"
# ★先写临时文件再复制（本仓实测）：`simctl io screenshot` 直接写项目目录会被沙箱拒
#   （Operation not permitted）——写 /tmp 则正常。
TMP_SHOT="$(mktemp -t l4-ios).png"
xcrun simctl io booted screenshot "$TMP_SHOT" >/dev/null 2>&1
cp "$TMP_SHOT" "$OUT/l4.ios.png" 2>/dev/null || true
rm -f "$TMP_SHOT"
xcrun simctl terminate booted "$BUNDLE_ID" >/dev/null 2>&1 || true
[ -s "$OUT/l4.ios.png" ] || { echo "✗ 截图未取到"; exit 6; }

cp "$CONTAINER/Documents/l4-scene.json" "$HERE/results/l4-scene.json" 2>/dev/null || true
echo "  [l4.ios] $(ls -l "$OUT/l4.ios.png" | awk '{print $5}')B sha=$(shasum -a 256 "$OUT/l4.ios.png" | awk '{print substr($1,1,12)}')"

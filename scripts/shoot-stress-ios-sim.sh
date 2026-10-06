#!/usr/bin/env bash
# 六端 SFC 压力夹具采集（iOS 模拟器）——`--stress` 模式渲染 SFC 编译产物 → sfc.ios.png
#
# 【与 run-l4-sim.sh 的关系】L4 采的是手写 CALayer 夹具；本脚本采的是 **SFC 编译产物**
#   （`examples/pages/consistency-stress.vue`，与 Web/Android 同源）——第三条链的截图。
#   完成信号/防假绿纪律与 L4 相同（事件驱动 + 特征色探针）。
#
# 【为什么不自退】与 L4 同款实测：App 自退会让 `simctl io screenshot` 截到主屏
#   ⇒ 报告落盘后**立即截图**，再 terminate（见 run-l4-sim.sh 的注释）。
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../hosts/ios" && pwd)/lib/xcode-env.sh"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS="$HERE/hosts/ios"
BUILD="$IOS/build-sim"
APP="$BUILD/ProteusSelfDraw.app"
BUNDLE_ID="dev.proteus.selfdraw.sim"
OUT="${PROTEUS_STRESS_OUT:-$HERE/docs/generated/consistency-samples/sfc}"
SIM_NAME="${1:-iPhone 18 Pro}"

mkdir -p "$OUT"

echo "==> ① 构建 TS 侧 + bundle（含 stress 产物：gen-vapor-table 会自动跑）"
(cd "$HERE" && pnpm --filter @proteus-vue/renderer-app run build 2>&1 | tail -1)
for s in build-selfdraw.mjs build-bench.mjs build-showcase.mjs; do
  if ! out="$( (cd "$HERE" && node "hosts/ios/bridge/$s") 2>&1 )"; then
    echo "✗ bundle 构建失败：$s"; echo "$out" | tail -5 | sed 's/^/    /'; exit 6
  fi
done
# stress 产物（bench bundle 构建时会跑 gen-vapor-table.mjs —— 它产出 vapor-stress.json）
[ -f "$IOS/bridge/dist/vapor-stress.json" ] || {
  echo "✗ 缺 vapor-stress.json（gen-vapor-table.mjs 未产出？）"; exit 6; }

echo "==> ② Rust 核心（模拟器 target）"
export PATH="$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HERE/spike/target}"
(cd "$HERE/packages/layout-core-rust" && cargo build --release --target aarch64-apple-ios-sim 2>&1 | grep -E "^error|Finished" | tail -1)
LIB="$CARGO_TARGET_DIR/aarch64-apple-ios-sim/release/libproteus_layout_core.a"
[ -f "$LIB" ] || { echo "✗ 静态库未生成"; exit 3; }
# ★HA1：宿主接 Host ABI ⇒ 还要链接 host-abi 静态库（与设备版 run-selfdraw.sh 同款；
#   缺它 ⇒ 链接期失败：`link command failed`——本批实测踩到）
(cd "$HERE/packages/host-abi" && cargo build --release --target aarch64-apple-ios-sim 2>&1 | grep -E "^error|Finished" | tail -1)
ABI_LIB="$CARGO_TARGET_DIR/aarch64-apple-ios-sim/release/libproteus_host_abi.a"
[ -f "$ABI_LIB" ] || { echo "✗ 未生成 host-abi 静态库"; exit 3; }

echo "==> ③ 编译 Swift 宿主（模拟器 SDK）"
rm -rf "$APP"; mkdir -p "$APP"
# ★必须带平台适配层（platform/ios/ProteusPlatform/*.swift）——selfdraw-scene.swift 引用
#   `ProteusTextAdapter` 等类型来自那里。**既有 run-selfdraw-sim.sh 漏了它**（那脚本的模拟器路径
#   在 HA0.5 抽取平台层后已坏——本批实测的旁证：单独编译 selfdraw-scene.swift 报
#   "cannot find type 'ProteusTextAdapter' in scope"）。本脚本直接带全，保证真能编过。
PLATFORM_SRC="$(ls "$HERE"/platform/ios/ProteusPlatform/*.swift 2>/dev/null | tr '\n' ' ')"
[ -n "$PLATFORM_SRC" ] || { echo "✗ 找不到 platform/ios 平台适配源码"; exit 3; }
# ★★宿主是多文件 App（与 check-selfdraw-compile.sh 的 HOST_SRCS 同一列表——那里是**清单唯一
#   事实源**；本脚本的重合度由"两端都能编过"保证）。缺任一 ⇒ `cannot find 'XxxScene' in scope`。
HOST_SRCS=(
  "$IOS/ProteusHost/runtime/selfdraw-scene.swift"
  "$IOS/ProteusHost/runtime/host-runtime-bridge.swift"
  "$IOS/ProteusHost/runtime/proteus-host-controller.swift"
  "$IOS/ProteusHost/runtime/host-capabilities.swift"
  "$IOS/ProteusHost/runtime/host-lifecycle-events.swift"
  "$IOS/ProteusHost/runtime/screen-host.swift"
  "$IOS/ProteusHost/dev/host-runtime-scene.swift"
  "$IOS/ProteusHost/dev/app-stack-scene.swift"
  "$IOS/ProteusHost/dev/showcase-scene.swift"
  "$IOS/ProteusHost/shell/selfdraw-app.swift"
)
for f in "${HOST_SRCS[@]}"; do [ -f "$f" ] || { echo "✗ 缺宿主源码：$f"; exit 3; }; done
xcrun --sdk iphonesimulator swiftc -O -target arm64-apple-ios15.0-simulator \
  -framework UIKit -framework CoreText -framework JavaScriptCore -parse-as-library \
  -o "$APP/ProteusSelfDraw" $PLATFORM_SRC "${HOST_SRCS[@]}" "$ABI_LIB" "$LIB" 2>&1 | grep -E "error:" | head -5
[ -f "$APP/ProteusSelfDraw" ] || { echo "✗ Swift 编译未产出可执行文件"; exit 3; }

echo "==> ④ 组装 .app"
for b in bundle-selfdraw bundle-bench bundle-showcase; do cp "$IOS/bridge/dist/$b.js" "$APP/$b.js"; done
cat > "$APP/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>ProteusSelfDraw</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>ProteusSelfDraw</string>
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

echo "==> ⑤ 启动模拟器 + 安装"
xcrun simctl bootstatus "$SIM_NAME" -b >/dev/null 2>&1 || { echo "✗ 模拟器未能启动：$SIM_NAME"; exit 4; }
xcrun simctl uninstall booted "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl install booted "$APP" || { echo "✗ 安装失败"; exit 4; }
CONTAINER="$(xcrun simctl get_app_container booted "$BUNDLE_ID" data 2>/dev/null || true)"
[ -n "$CONTAINER" ] || { echo "✗ 取不到数据容器"; exit 4; }

echo "==> ⑥ 启动（--stress；不自退：截图须在进程存活时做）"
xcrun simctl launch booted "$BUNDLE_ID" --stress >/dev/null 2>&1 || { echo "✗ 启动失败"; exit 5; }
bash "$HERE/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh" \
  --file "$CONTAINER/Documents/stress-sfc.json" --timeout 90 --interval 1 \
  || { echo "✗ 报告未落盘（wait_for 超时）"; exit 5; }

echo "==> ⑦ 取屏 + 取报告"
TMP_SHOT="$(mktemp -t stress-ios).png"
xcrun simctl io booted screenshot "$TMP_SHOT" >/dev/null 2>&1
cp "$TMP_SHOT" "$OUT/sfc.ios.png" 2>/dev/null || true
rm -f "$TMP_SHOT"
xcrun simctl terminate booted "$BUNDLE_ID" >/dev/null 2>&1 || true
[ -s "$OUT/sfc.ios.png" ] || { echo "✗ 截图未取到"; exit 6; }
cp "$CONTAINER/Documents/stress-sfc.json" "$OUT/sfc.ios.json" 2>/dev/null || true
# 截图 PNG（App 内渲染自存的那份——与 screencap 互补：一个走系统截屏，一个走层渲染）
cp "$CONTAINER/Documents/stress-sfc.png" "$OUT/sfc.ios.snapshot.png" 2>/dev/null || true

echo "==> ⑧ 防假绿：特征色探针"
node "$HERE/scripts/probe-png-colors.mjs" "$OUT/sfc.ios.png" "47,111,237" "111,74,232" "27,27,33" >/dev/null 2>&1 \
  || { echo "✗ 特征色未命中（截图无效）"; exit 7; }

echo "  [sfc.ios] $(ls -l "$OUT/sfc.ios.png" | awk '{print $5}')B sha=$(shasum -a 256 "$OUT/sfc.ios.png" | awk '{print substr($1,1,12)}')"
echo "  报告：$(head -c 200 "$OUT/sfc.ios.json" 2>/dev/null | tr -d '\n')"

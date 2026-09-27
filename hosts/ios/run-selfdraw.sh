#!/usr/bin/env bash
# hosts/ios/run-selfdraw.sh —— ★★跑通「标准 Vue 应用 → 自绘管线」（真机）
#
# 【验证什么】
#   标准 Vue 组件 → Vue 自定义渲染器 → 语义树 → **Rust 排版核心算几何** → CALayer 树
#   —— 全链路**无 UIKit 布局参与**（这是与既有竖切 entry.ts 的本质差别）。
#   同时带回 **JS 逻辑层性能读数**（mount / update / 纯 JS 吞吐 / 边界序列化成本）。
#
# 【为什么必须真机】JS 逻辑层性能必须在**真实 JavaScriptCore** 上量（模拟器与桌面 JSC
#   的 JIT 策略不同，桌面数字不代表设备）；且 CALayer 渲染需要真实 GPU。
#
# 用法：bash hosts/ios/run-selfdraw.sh [--bench] [设备UDID]
#   --bench  跑**逻辑层基准**（复杂响应式用例 + 规模扫描）而非自绘场景；
#            报告落到 results/logic-bench-report.json
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RUST_CRATE="$ROOT/packages/layout-core-rust"
BUILD="$HERE/build-selfdraw"
APP="$BUILD/ProteusSelfDraw.app"
# ★包名必须与**已 provision 的描述文件**匹配（免费个人团队无法任意新增 App ID）。
#   本机可用的 ID 见：for pf in ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision;
#     do security cms -D -i "$pf" | PlistBuddy -c "Print :Entitlements:application-identifier" /dev/stdin; done
BUNDLE_ID="${PROTEUS_BUNDLE_ID:-dev.proteus.experiments}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/spike/target}"

MODE="selfdraw"
UDID=""
for a in "$@"; do
  case "$a" in
    --bench) MODE="bench" ;;
    *) [ -z "$UDID" ] && UDID="$a" ;;
  esac
done
if [ -z "$UDID" ]; then
  UDID="$(xcrun devicectl list devices 2>/dev/null | grep -vE 'simulated' | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' | head -1 || true)"
fi
[ -n "$UDID" ] || { echo "✗ 未发现真机"; exit 2; }
echo "==> 目标设备：$UDID · 模式：$MODE"

echo "==> ① 构建 TS 侧（renderer-app 的 dist —— 自绘适配器所在）"
# ★必须先构建：bundle 用 alias 指向 dist（renderer-app 不是根依赖，无 node_modules link）
(cd "$ROOT" && pnpm --filter @proteus-vue/renderer-app run build 2>&1 | tail -2)

echo "==> ② JS bundle（Vue + 适配器 → 单文件 IIFE）[$MODE]"
if [ "$MODE" = "bench" ]; then
  (cd "$ROOT" && node hosts/ios/bridge/build-bench.mjs 2>&1 | tail -1)
else
  (cd "$ROOT" && node hosts/ios/bridge/build-selfdraw.mjs 2>&1 | tail -1)
fi

echo "==> ③ 编译 Rust 核心（iOS release）"
export PATH="$HOME/.cargo/bin:$PATH"
[ "$(command -v cargo)" = "$HOME/.cargo/bin/cargo" ] || { echo "✗ cargo 未解析到 rustup"; exit 3; }
(cd "$RUST_CRATE" && cargo build --release --target aarch64-apple-ios 2>&1 | grep -E "^error|warning: unused|Finished" | tail -3)
LIB="$CARGO_TARGET_DIR/aarch64-apple-ios/release/libproteus_layout_core.a"
[ -f "$LIB" ] || { echo "✗ 未生成静态库：$LIB"; exit 3; }

echo "==> ④ 编译 Swift 宿主（自绘场景）"
rm -rf "$APP"; mkdir -p "$APP"
xcrun --sdk iphoneos swiftc -O -target arm64-apple-ios15.0 \
  -framework UIKit -framework CoreText -framework JavaScriptCore -parse-as-library \
  -o "$APP/ProteusSelfDraw" "$HERE/ProteusHost/selfdraw-scene.swift" "$LIB"

echo "==> ⑤ 组装 .app"
if [ "$MODE" = "bench" ]; then
  cp "$HERE/bridge/dist/bundle-bench.js" "$APP/bundle-bench.js"
else
  cp "$HERE/bridge/dist/bundle-selfdraw.js" "$APP/bundle-selfdraw.js"
fi
# ★描述文件与 entitlements 从**描述文件原样提取**（本仓 iOS 竖切实测的坑：
#   手工拼装会 0xe8008016 invalid entitlements；免费个人团队还需 team-identifier
#   + keychain-access-groups，少一项即无效）
PROFILE_DIR="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
PROFILE="$(ls -t "$PROFILE_DIR"/*.mobileprovision 2>/dev/null | head -1 || true)"
[ -n "$PROFILE" ] || { echo "✗ 未找到描述文件（$PROFILE_DIR）"; exit 3; }
PLIST_TMP="$(mktemp -d)"
security cms -D -i "$PROFILE" > "$PLIST_TMP/profile.plist" 2>/dev/null
TEAM_ID="$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$PLIST_TMP/profile.plist" 2>/dev/null || echo "")"
APP_ID="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$PLIST_TMP/profile.plist" 2>/dev/null || echo "")"
[ -n "$APP_ID" ] || { echo "✗ 描述文件缺少 application-identifier"; exit 3; }
/usr/libexec/PlistBuddy -c "Print :Entitlements" "$PLIST_TMP/profile.plist" > "$PLIST_TMP/entitlements.plist" 2>/dev/null || true

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
  <key>UIApplicationSceneManifest</key><dict>
    <key>UIApplicationSupportsMultipleScenes</key><false/>
  </dict>
  <key>UISupportedInterfaceOrientations</key><array><string>UIInterfaceOrientationPortrait</string></array>
</dict></plist>
PLIST
cp "$PROFILE" "$APP/embedded.mobileprovision"
[ -s "$PLIST_TMP/entitlements.plist" ] && cp "$PLIST_TMP/entitlements.plist" "$PLIST_TMP/ent.plist"

echo "==> ⑥ 签名"
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Apple Development|iPhone Developer/ {print $2; exit}')"
[ -n "$IDENTITY" ] || { echo "✗ 无签名身份"; exit 3; }
# ★从可用的描述文件里挑一个与 BUNDLE_ID 匹配的（本仓 iOS 竖切实测的两条纪律：
#   ① entitlements 必须用 `PlistBuddy -x` 导出为 **XML**（只 Print 会得到"描述"而非 plist
#      → codesign 报 "unrecognized blob type / invalid length"）
#   ② 手工拼装 entitlements 会 0xe8008016；免费个人团队还需 team-identifier + keychain-access-groups）
PROFILE=""
PROBE="$BUILD/probe.plist"
for pf in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"/*.mobileprovision; do
  [ -f "$pf" ] || continue
  security cms -D -i "$pf" > "$PROBE" 2>/dev/null || continue
  APPID="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$PROBE" 2>/dev/null || true)"
  case "$APPID" in *".$BUNDLE_ID") PROFILE="$pf"; break ;; esac
done
[ -n "$PROFILE" ] || { echo "✗ 无匹配描述文件（BUNDLE_ID=$BUNDLE_ID；换一个已 provision 的 ID：PROTEUS_BUNDLE_ID=... ）"; exit 3; }
/usr/libexec/PlistBuddy -x -c 'Print :Entitlements' "$PROBE" > "$BUILD/entitlements.plist"
cp "$PROFILE" "$APP/embedded.mobileprovision"
codesign --force --sign "$IDENTITY" --entitlements "$BUILD/entitlements.plist" --timestamp=none "$APP" 2>&1 | tail -1
echo "    身份：$IDENTITY · 描述文件：$(basename "$PROFILE")"

echo "==> ⑦ 安装并启动"
xcrun devicectl device install app --device "$UDID" "$APP" 2>&1 | grep -iE "installed|error" | tail -2 || true
if [ "$MODE" = "bench" ]; then
  # ★启动参数：宿主据此选择 bundle 与报告名（`--bench`）
  xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" --bench 2>&1 | tail -2 || true
else
  xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" 2>&1 | tail -2 || true
fi

echo "==> ⑧ 取回报告与截图"
sleep 6
mkdir -p "$HERE/results"
REPORT_FILE="selfdraw-report.json"
SNAP_FILE="selfdraw-final.png"
if [ "$MODE" = "bench" ]; then REPORT_FILE="logic-bench-report.json"; SNAP_FILE="bench-final.png"; fi
for f in "$REPORT_FILE" "$SNAP_FILE"; do
  xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" --source "Documents/$f" \
    --destination "$HERE/results/$f" 2>&1 | tail -1 || true
done
echo "    报告：$HERE/results/$REPORT_FILE"
[ -f "$HERE/results/$REPORT_FILE" ] && python3 -c "
import json,sys
d=json.load(open('$HERE/results/$REPORT_FILE'))
print('  引擎：', d.get('engine'))
jr=d.get('js_report',{})
print('  宿主报告：引擎', d.get('engine'), '· 层数', d.get('layer_count'), '· 节点', d.get('host_node_count'))
for k,v in (jr.get('phases') or {}).items():
    print(f'  [{k}] vue={v.get(\"vue_ms\")}ms 适配={v.get(\"to_request_ms\")}ms 序列化={v.get(\"serialize_ms\")}ms 宿主={v.get(\"host_ms\")}ms 合计={v.get(\"total_ms\")}ms 节点={v.get(\"node_count\")} patch={v.get(\"patch_count\")}')
t=jr.get('js_only_throughput') or {}
print('  纯JS吞吐：', t.get('avg_ms'),'ms/次（',t.get('iterations'),'次，max',t.get('max_ms'),'ms）')
print('  未知键：', jr.get('unknown_keys'))
" 2>/dev/null || echo "    （报告未取到——检查设备日志）"

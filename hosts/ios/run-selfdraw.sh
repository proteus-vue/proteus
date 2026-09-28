#!/usr/bin/env bash
# hosts/ios/run-selfdraw.sh —— ★★跑通「标准 Vue 应用 → 自绘管线」（真机）
#
# ★★纪律（本机踩坑）：**`$VAR` 不得直接接全角字符**（如 `（$VAR）`）——
#   macOS 自带 bash 3.2 在**非 UTF-8 locale** 下会把全角字符的首字节吞进变量名
#   （现象：`PROFILE_DIR\xEF: unbound variable` + `set -u` 直接中断）。
#   ⇒ 一律写成 `${VAR}`。终端里跑没事（locale 是 UTF-8），但被工具/CI 以 C locale 调用时必炸。
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

# ★解析可用的 Xcode（devicectl/xcodebuild 只在完整 Xcode 里；本机 Xcode 在非默认位置）
#   详见 hosts/ios/lib/xcode-env.sh —— 导出 DEVELOPER_DIR，免去每次手工指定。
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/xcode-env.sh"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RUST_CRATE="$ROOT/packages/layout-core-rust"
BUILD="$HERE/build-selfdraw"
APP="$BUILD/ProteusSelfDraw.app"
# ★包名必须与**已 provision 的描述文件**匹配（免费个人团队无法任意新增 App ID）。
#   本机可用的 ID 见：for pf in ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision;
#     do security cms -D -i "$pf" | PlistBuddy -c "Print :Entitlements:application-identifier" /dev/stdin; done
# ★2026-09-28 换默认值：旧包名 `dev.proteus.experiments` 属**旧团队 F4R3P3L477**（其签名证书私钥已丢），
#   且该设备上的免费账号名额被旧团队三个应用占满（**上限 3 个**）⇒ 改用新团队 XKH568R7A5 的包名。
#   若描述文件缺失，先跑：bash hosts/ios/experiments/device/provision.sh cn.shxuxi.proteus.experiments XKH568R7A5
BUNDLE_ID="${PROTEUS_BUNDLE_ID:-cn.shxuxi.proteus.experiments}"
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
  # ★设备标识有**两种形态**（本机实测：Xcode 26.5 + 无线配对给出的是标准 UUID）：
  #   · 旧：ECID 式  00008101-001938AC1A68801E   （8-16）
  #   · 新：标准 UUID F02622D7-29CC-5E75-9AF9-A3AB36BC5C55 （8-4-4-4-12）
  #   只认前者会让探测**静默返回空**（现象 = "✗ 未发现真机"，但设备其实连着）——
  #   本仓已踩：同一台 iPhone 12 在两种 Xcode 下标识形态不同。故两种都认。
  UDID="$(xcrun devicectl list devices 2>/dev/null | grep -vE 'simulated' \
    | grep -oE '[0-9A-Fa-f]{8}-([0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}|[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}' | head -1 || true)"
fi
[ -n "$UDID" ] || { echo "✗ 未发现真机"; exit 2; }
echo "==> 目标设备：$UDID · 模式：$MODE"

echo "==> ① 构建 TS 侧（renderer-app 的 dist —— 自绘适配器所在）"
# ★必须先构建：bundle 用 alias 指向 dist（renderer-app 不是根依赖，无 node_modules link）
(cd "$ROOT" && pnpm --filter @proteus-vue/renderer-app run build 2>&1 | tail -2)

# ★本次构建标识：注入 bundle + 用于「报告是否就绪」的内容判定
BUILD_ID="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)-$(date +%H%M%S)"
export PROTEUS_BUILD_ID="$BUILD_ID"
if [ -f "$HERE/bridge/inject-build-id.mjs" ]; then
  (cd "$ROOT" && node hosts/ios/bridge/inject-build-id.mjs "$BUILD_ID") || true
fi
echo "==> 本次 BUILD_ID：$BUILD_ID"

echo "==> ② JS bundle（两个都建——见步骤⑤的说明）"
(cd "$ROOT" && node hosts/ios/bridge/build-selfdraw.mjs 2>&1 | tail -1)
(cd "$ROOT" && node hosts/ios/bridge/build-bench.mjs 2>&1 | tail -1)

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
# ★★两个 bundle **都装**（本仓实测踩到：只装当前模式那个 ⇒ 从桌面点开时
#   没有 `--bench` 启动参数 ⇒ 找不到 bundle-selfdraw.js ⇒ 应用起不来（黑屏/闪退）。
#   修复：构建阶段把两个都编出来、都塞进 .app；运行时按启动参数选。
(cd "$ROOT" && node hosts/ios/bridge/build-selfdraw.mjs 2>&1 | tail -1)
(cd "$ROOT" && node hosts/ios/bridge/build-bench.mjs 2>&1 | tail -1)
cp "$HERE/bridge/dist/bundle-selfdraw.js" "$APP/bundle-selfdraw.js"
cp "$HERE/bridge/dist/bundle-bench.js" "$APP/bundle-bench.js"
# ★描述文件与 entitlements 从**描述文件原样提取**（本仓 iOS 竖切实测的坑：
#   手工拼装会 0xe8008016 invalid entitlements；免费个人团队还需 team-identifier
#   + keychain-access-groups，少一项即无效）
PROFILE_DIR="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
PROFILE="$(ls -t "$PROFILE_DIR"/*.mobileprovision 2>/dev/null | head -1 || true)"
[ -n "$PROFILE" ] || { echo "✗ 未找到描述文件（${PROFILE_DIR}）"; exit 3; }
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
[ -n "$PROFILE" ] || { echo "✗ 无匹配描述文件（BUNDLE_ID=${BUNDLE_ID}；换一个已 provision 的 ID：PROTEUS_BUNDLE_ID=... ）"; exit 3; }
/usr/libexec/PlistBuddy -x -c 'Print :Entitlements' "$PROBE" > "$BUILD/entitlements.plist"
cp "$PROFILE" "$APP/embedded.mobileprovision"
codesign --force --sign "$IDENTITY" --entitlements "$BUILD/entitlements.plist" --timestamp=none "$APP" 2>&1 | tail -1
echo "    身份：$IDENTITY · 描述文件：$(basename "$PROFILE")"

echo "==> ⑦ 安装并启动"
# ★★安装必须**校验成功**，失败即停（本仓实测踩坑：安装失败时脚本继续往下走，
#   在第 ⑧ 段**盲等一个永远不会到来的报告**，白等 10 分钟还看不出原因）。
#   免费开发者账号在设备上最多装 **3 个** App；超限的报错形如
#   `maximum number of installed apps using a free developer profile: {...}`
#   ⇒ 卸载该清单里不再需要的旧应用即可（注意 uninstall 收的是 **bundle id**
#     如 `dev.proteus.experiments`，**不是** application-identifier `TEAM.dev.proteus.experiments`）。
INSTALL_LOG="$(mktemp)"
if ! xcrun devicectl device install app --device "$UDID" "$APP" > "$INSTALL_LOG" 2>&1; then
  echo "✗ 安装失败——原因（详见下方）："
  grep -E "maximum number of installed apps|Invalid|error [0-9]+|无法安装|Failed" "$INSTALL_LOG" | head -6 | sed 's/^/    /'
  echo "    ★若是「max 3 apps」：用 bundle id 卸载旧应用后重跑，例如"
  echo "      xcrun devicectl device uninstall app --device $UDID <bundle-id>"
  rm -f "$INSTALL_LOG"
  exit 4
fi
grep -iE "installed" "$INSTALL_LOG" | tail -1 | sed 's/^/    /'
rm -f "$INSTALL_LOG"

# ★★从**桌面点开**等价于不带参数启动 = 自绘场景（两个 bundle 都在包内，任选其一都可用）。
#   `--bench` 只是显式指定跑基准。
# ★★必须先**终止旧进程**（本仓实测踩到：`process launch` 对已运行的应用只是切到前台，
#   于是「重装 + 启动」后跑的还是**旧代码**，而报告 build_id 不变——我因此白查了好几轮，
#   还误以为「S 组注册失败」。⇒ 纪律：重装后必须 terminate 再 launch。）
xcrun devicectl device process terminate --device "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
# ★terminate 是**异步**的，但不能固定 sleep 盲等（本仓效率纪律）：
#   复用仓库自带的**条件等待**脚本，探测「该可执行文件已不在设备进程列表」。
#   ★注意匹配的锚点：`device info processes` 列的是**可执行路径**
#   （我们的 = `ProteusSelfDraw`），不含 bundle id——故用可执行名而非 $BUNDLE_ID。
#   探测不到 = 就绪（含"本来就没在跑"，故用 `! grep`）。
bash "$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh" \
  --cmd "! xcrun devicectl device info processes --device $UDID 2>/dev/null | grep -q ProteusSelfDraw" \
  --timeout 20 --interval 3 >/dev/null 2>&1 || true
# ★★启动同样必须校验（本仓实测：首次用新证书安装后，启动会被拦为
#   "profile has not been explicitly trusted by the user" —— 需在设备上
#   设置 → 通用 → VPN与设备管理 → 信任该开发者证书；此步骤无法由脚本代做）。
LAUNCH_LOG="$(mktemp)"
if [ "$MODE" = "bench" ]; then
  xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" --bench > "$LAUNCH_LOG" 2>&1 || true
else
  xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" > "$LAUNCH_LOG" 2>&1 || true
fi
if grep -qiE "not been explicitly trusted|invalid code signature|error 3 \(0x03\)" "$LAUNCH_LOG"; then
  echo "✗ 启动被拦：需在**设备上手动信任开发者证书**"
  echo "    设置 → 通用 → VPN与设备管理 → 「Apple Development: …」→ 信任"
  echo "    （iOS 的强制步骤，脚本无法代做）"
  rm -f "$LAUNCH_LOG"
  exit 5
fi
tail -1 "$LAUNCH_LOG" | sed 's/^/    /'
rm -f "$LAUNCH_LOG"

echo "==> ⑧ 取回报告与截图"
mkdir -p "$HERE/results"
REPORT_FILE="selfdraw-report.json"
SNAP_FILE="selfdraw-final.png"
if [ "$MODE" = "bench" ]; then REPORT_FILE="logic-bench-report.json"; SNAP_FILE="bench-final.png"; fi
# ★条件等待：报告必须**比开始时新**才算本次运行完成
#
# 【为什么不能用固定 sleep（本仓踩坑）】bench 有 19 个用例、最大 1000 项规模，
#   跑完远超当初写的 6 秒 ⇒ 取回的是**上一次运行的残留报告**，
#   读数全是旧的；我还因此误判成「新代码没生效」，白查一轮。
#   ⇒ 改为：记录本地 mtime → 反复尝试取回 → 直到 mtime 前移（或超时）。
# ★★判据必须是**内容**（报告的 build_id == 本次构建），不能用文件 mtime：
#   拷贝动作本身就会刷新 mtime ⇒ 若拿 mtime 判「是否就绪」，会**永远判定为就绪**
#   （本仓实测：脚本报「等待 0s」但拿到的其实是上一轮的残留报告）。
WAITED=0
TIMEOUT=600
while [ "$WAITED" -lt "$TIMEOUT" ]; do
  xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" --source "Documents/$REPORT_FILE" \
    --destination "$HERE/results/$REPORT_FILE" >/dev/null 2>&1 || true
  OK=$(python3 - "$HERE/results/$REPORT_FILE" "$BUILD_ID" <<'PYCHK' 2>/dev/null || echo 0
import json, sys
try:
    jr = (json.load(open(sys.argv[1])).get('js_report') or {})
    print(1 if jr.get('build_id') == sys.argv[2] else 0)
except Exception:
    print(0)
PYCHK
)
  if [ "$OK" = "1" ]; then echo "    报告已就绪（build_id=${BUILD_ID}，等待 ${WAITED}s）"; break; fi
  sleep 5
  WAITED=$((WAITED + 5))
done
if [ "$WAITED" -ge "$TIMEOUT" ]; then echo "    ⚠ 等待超时（${TIMEOUT}s）——报告仍未含本次 build_id"; fi

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

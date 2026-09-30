#!/usr/bin/env bash
# hosts/ios/run-selfdraw.sh —— ★★跑通「标准 Vue 应用 → 自绘管线」（真机）
#
# ★★纪律（本机踩坑）：**`$VAR` 不得直接接全角字符**（如 `（${VAR}）`）——
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
# ★用例过滤（仅 --bench 有效）：`--cases=S5` 只跑 S5* 用例——定向验证不跑全套
#   （效率纪律：bench 46 用例整套数分钟，验证单改动通常只需 2–4 个）
CASE_FILTER=""
for a in "$@"; do
  case "$a" in
    --bench) MODE="bench" ;;
    --host-runtime) MODE="host-runtime" ;;
    --app-stack) MODE="app-stack" ;;
    --showcase) MODE="showcase" ;;
    --cases=*) CASE_FILTER="${a#--cases=}" ;;
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
# ★★**构建失败必须中断**（本仓实测：`build-bench` 因 TS 重复声明失败，
#   而 `| tail -1` + `set -e` 在子 shell 管道里**没能拦住** ⇒ 跑了旧 bundle，
#   设备读数与源码不符，我为此白查 4 轮）。⇒ 显式检查退出码并在失败时报错。
# ★注意：管道里 `$?` 是 **tail 的**退出码（本仓实测：首版这么写仍然漏报）
#   ⇒ 必须用 `PIPESTATUS[0]` 取 node 的退出码。
build_bundle() {
  local script="$1"
  local out
  out="$( (cd "$ROOT" && node "hosts/ios/bridge/$script") 2>&1 )" || {
    echo "✗ bundle 构建失败：$script"
    echo "$out" | tail -5 | sed 's/^/    /'
    exit 6
  }
  echo "$out" | tail -1
}
build_bundle build-selfdraw.mjs
build_bundle build-bench.mjs
build_bundle build-host-runtime.mjs
build_bundle build-app-stack.mjs
build_bundle build-showcase.mjs

echo "==> ③ 编译 Rust 核心（iOS release）"
export PATH="$HOME/.cargo/bin:$PATH"
[ "$(command -v cargo)" = "$HOME/.cargo/bin/cargo" ] || { echo "✗ cargo 未解析到 rustup"; exit 3; }
(cd "$RUST_CRATE" && cargo build --release --target aarch64-apple-ios 2>&1 | grep -E "^error|warning: unused|Finished" | tail -3)
LIB="$CARGO_TARGET_DIR/aarch64-apple-ios/release/libproteus_layout_core.a"
[ -f "$LIB" ] || { echo "✗ 未生成静态库：$LIB"; exit 3; }
# ★HA1：宿主接 Host ABI ⇒ 链接 host-abi 静态库（它与 layout-core 同源，只是 ABI 门面）
(cd "$ROOT/packages/host-abi" && cargo build --release --target aarch64-apple-ios 2>&1 | grep -E "^error" -A 4 || true)
ABI_LIB="$CARGO_TARGET_DIR/aarch64-apple-ios/release/libproteus_host_abi.a"
[ -f "$ABI_LIB" ] || { echo "✗ 未生成 host-abi 静态库：$ABI_LIB"; exit 3; }

echo "==> ④ 编译 Swift 宿主（自绘场景）"
rm -rf "$APP"; mkdir -p "$APP"
# ★HA0.5：宿主依赖平台适配层（`platform/ios/`）⇒ 必须一起编译（与 check-selfdraw-compile.sh 同口径）
PLATFORM_SRC="$(ls "$ROOT"/platform/ios/ProteusPlatform/*.swift 2>/dev/null | tr '\n' ' ')"
[ -n "$PLATFORM_SRC" ] || { echo "✗ 找不到 platform/ios 平台适配源码（HA0.5 抽取后被删？）"; exit 3; }
xcrun --sdk iphoneos swiftc -O -target arm64-apple-ios15.0 \
  -framework UIKit -framework CoreText -framework JavaScriptCore -framework AVFoundation -parse-as-library \
  -o "$APP/ProteusSelfDraw" $PLATFORM_SRC "$HERE/ProteusHost/selfdraw-scene.swift" \
  "$HERE/ProteusHost/host-runtime-scene.swift" "$HERE/ProteusHost/host-capabilities.swift" \
  "$HERE/ProteusHost/host-lifecycle-events.swift" "$HERE/ProteusHost/screen-host.swift" "$HERE/ProteusHost/app-stack-scene.swift" "$HERE/ProteusHost/showcase-scene.swift" "$ABI_LIB" "$LIB"

echo "==> ⑤ 组装 .app"
# ★★两个 bundle **都装**（本仓实测踩到：只装当前模式那个 ⇒ 从桌面点开时
#   没有 `--bench` 启动参数 ⇒ 找不到 bundle-selfdraw.js ⇒ 应用起不来（黑屏/闪退）。
#   修复：构建阶段把两个都编出来、都塞进 .app；运行时按启动参数选。
# ★② 已构建（若那里失败会 exit 6）；此处只拷贝——**重复构建既慢又掩盖失败**
cp "$HERE/bridge/dist/bundle-selfdraw.js" "$APP/bundle-selfdraw.js"
cp "$HERE/bridge/dist/bundle-bench.js" "$APP/bundle-bench.js"
# ★G-39：宿主运行时 bundle（第三个——`--host-runtime` 模式用）
cp "$HERE/bridge/dist/bundle-host-runtime.js" "$APP/bundle-host-runtime.js"
# ★M5：执行器场景 bundle（`--app-stack` 模式用）
cp "$HERE/bridge/dist/bundle-app-stack.js" "$APP/bundle-app-stack.js"
# ★Morpheus 炫技场 bundle（`--showcase` 模式用）
cp "$HERE/bridge/dist/bundle-showcase.js" "$APP/bundle-showcase.js"
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
  <!-- ★启动屏**背景色**（本仓实测踩到的白屏根因）：
       「UILaunchScreen」空 dict ⇒ iOS 用**系统背景色**⇒ 浅色模式下是**白**，
       而本应用是深色（背景 #101020 / 黑）⇒ 启动瞬间**白一下**再变黑。
       「UIUserInterfaceStyle = Dark」让系统背景 = 黑 ⇒ 启动屏与首帧连续（白闪消失）。
       ★本应用所有颜色都是硬编码深色 ⇒ 强制深色**语义正确**（不是权宜之计）。
       ★★这里不能写反引号：本 heredoc 未加引号 ⇒ 反引号会被**命令替换执行**。 -->
  <key>UIUserInterfaceStyle</key><string>Dark</string>
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
#
# ★★事件驱动完成信号（2026-09-30 重写；用户红线：「禁止任何盲等——要么让 App 主动上报，
#   要么有条件等待；sleep/timeout 一律禁止」）
#   原实现：launch 立即返回 → 轮询 copy 报告 → sleep 5 × 120（最多 600 秒）。当日实测三处缺陷：
#     ① 轮询判据 `js_report.build_id` 在 **selfdraw 入口永不产出** ⇒ 该模式下判据
#        **永远不可能满足**——每轮白等满 600 秒（一次 11 分钟的运行里 10 分钟花在这里）；
#     ② 同判据对"上一轮残留报告 + 本次构建"也可能为真 ⇒ 可能拿到旧数据（判据不够强）；
#     ③ 盲等本身已列为用户红线。
#   ⇒ 新机制：宿主 `PROTEUS_EXIT_AFTER_REPORT=1` ⇒ 报告落盘后**进程即退出**；
#     `devicectl ... launch --console` **等 App 退出才返回** ⇒ 该命令的返回就是完成信号。
#     零轮询 / 零 sleep / 零 timeout —— 脚本里不存在"等"这个动作。
#   ★`--console`：日志流落盘备查（成功时含 `SELFDRAW_REPORT_READY` 标记）。
#   ★`--terminate-existing`：替代原先的「terminate + 条件等待进程消失」（devicectl 内处理；
#     原有实测教训保留：重装后若复用了旧进程会跑**旧代码** —— 由下方 build_id 断言兜底）。
#
# ★报告文件名先算出（基准对照与取回都要用它）
mkdir -p "$HERE/results"
REPORT_FILE="selfdraw-report.json"
SNAP_FILE="selfdraw-final.png"
if [ "$MODE" = "bench" ]; then REPORT_FILE="logic-bench-report.json"; SNAP_FILE="bench-final.png"; fi
# ★G-39：宿主运行时模式写独立报告（不污染既有产物命名）
if [ "$MODE" = "host-runtime" ]; then REPORT_FILE="host-runtime.json"; SNAP_FILE="host-shell.json"; fi
# ★M5：执行器场景两份报告（主 + 执行器；判据合并读）
if [ "$MODE" = "app-stack" ]; then REPORT_FILE="app-stack.json"; SNAP_FILE="app-stack-executor.json"; fi
# ★Morpheus 炫技场（一份报告 + 一张收尾截图）
if [ "$MODE" = "showcase" ]; then REPORT_FILE="showcase.json"; SNAP_FILE="showcase-final.png"; fi
# ★过滤跑写独立文件（否则会把全量基准报告覆盖掉——历史读数不可再生）
if [ -n "$CASE_FILTER" ]; then
  SLUG="$(printf '%s' "$CASE_FILTER" | tr ',' '_')"
  REPORT_FILE="bench-filtered-${SLUG}.json"
  SNAP_FILE="bench-filtered-${SLUG}.png"
fi

# ★基准 run_ts：launch 前先读设备上**现有**报告的时间戳；launch 返回后取回的报告必须不同
#   （证明"本轮真的写了新报告"；对照设备自己的旧报告 ⇒ 不涉及跨机器时钟）。
BASE_TS="none"
BASEF="$(mktemp)"
if xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" --source "Documents/$REPORT_FILE" \
    --destination "$BASEF" >/dev/null 2>&1; then
  BASE_TS="$(node "$HERE/lib/read-run-ts.mjs" "$BASEF")"
fi
rm -f "$BASEF"

# ★★启动（**阻塞到 App 退出** = 报告已落盘）；启动被拦的情况必须显式报出（本仓实测：
#   首次用新证书安装后会被拦为 "profile has not been explicitly trusted by the user"，
#   需在设备上 设置 → 通用 → VPN与设备管理 信任证书——无法由脚本代做）。
LAUNCH_LOG="$(mktemp)"
LAUNCH_RC=0
echo "    启动 App（阻塞到报告落盘后自退——无轮询 / 无 sleep / 无超时；长跑请放后台）"
if [ "$MODE" = "showcase" ]; then
  # ★★Morpheus 炫技场：单段 launch（App 内部：建树 → 三段编舞（帧循环驱动）→ 读数 + 截图 →
  #   SHOWCASE_REPORT_READY → PROTEUS_EXIT_AFTER_REPORT=1 自退）。脚本侧零轮询。
  xcrun devicectl device process launch --console --terminate-existing \
    --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
    --device "$UDID" "$BUNDLE_ID" --showcase > "$LAUNCH_LOG" 2>&1 || LAUNCH_RC=$?
elif [ "$MODE" = "app-stack" ]; then
  # ★★M5 执行器模式：单段 launch（App 内部：主场景同步 → 执行器两相 → **非阻塞轮询** →
  #   两份报告落盘 → APP_STACK_REPORT_READY → PROTEUS_EXIT_AFTER_REPORT=1 自退）。
  #   ★动画由 CADisplayLink 帧循环推进，轮询每轮让出主线程（见 app-stack-scene.swift 文件头）——
  #     脚本侧只需**阻塞到退出**（与 selfdraw/bench 同款，零轮询）。
  xcrun devicectl device process launch --console --terminate-existing \
    --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
    --device "$UDID" "$BUNDLE_ID" --app-stack > "$LAUNCH_LOG" 2>&1 || LAUNCH_RC=$?
elif [ "$MODE" = "host-runtime" ]; then
  # ══════════════════════════════════════════════════════════════════
  # ★★G-39 宿主运行时模式：**两段式**（本仓事件驱动纪律的延伸）
  #
  # 【为什么不能像 selfdraw/bench 那样一次 launch 到底】
  #   本场景要验证的是「**真实系统生命周期**被壳转发进 JS 运行时」（G-39 动机第一条）——
  #   而生命周期事件来自**外部动作**（切到别的 App → willResignActive；切回 → didBecomeActive）。
  #   ⇒ 需要 ① 后台 launch（阻塞，等 App 自退）② 等"相位完成"信号 ③ 触发真实前后台往返
  #     ④ 等 App 达成退出条件（suspend+resume 都 applied ⇒ HOST_RUNTIME_REPORT_READY ⇒ exit）
  #     ⑤ 取回两份报告（主报告 + 壳转发报告）。
  #
  # 【为什么这不是"盲等"】每一步都有**条件**：
  #   · phase done —— 等 launch 日志里出现 HOST_RUNTIME_PHASE_DONE（内容条件）；
  #   · App 退出 —— `kill -0 $LPID` 探进程存活（本地判定，零成本），launch 返回 = 报告已落盘；
  #   · 触发往返 —— 启动「设置」App（真实 willResignActive）后重新 launch 本 App（真实 didBecomeActive）。
  #   ★launch 的 stdout 走文件（不是管道）——避免 `$(...)` 缓冲吞掉进度日志。
  # ══════════════════════════════════════════════════════════════════
  WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
  # ★wait_for.sh 是唯一原语（check-no-blind-wait 门禁）——**没有盲等回退**
  [ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh（${WAIT_SH}）——本脚本禁止盲等"; exit 2; }
  wait_cond() { # $1=命令（字符串） $2=秒
    bash "$WAIT_SH" --cmd "$1" --timeout "$2" --interval 2 || true
  }
  ( xcrun devicectl device process launch --console --terminate-existing \
      --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
      --device "$UDID" "$BUNDLE_ID" --host-runtime --k-crash > "$LAUNCH_LOG" 2>&1; echo "LAUNCH_RC=$?" >> "$LAUNCH_LOG" ) &
  LPID=$!
  # ① 等"两相完成 + 生命周期观察者已装"（内容条件；缺此信号 ⇒ App 未就绪，后续触发会丢事件）
  if ! wait_cond "grep -q HOST_RUNTIME_PHASE_DONE '$LAUNCH_LOG'" 60; then
    echo "✗ 未等到相位完成信号（60s）——日志尾："
    tail -8 "$LAUNCH_LOG" | sed 's/^/      /'
    kill "$LPID" 2>/dev/null
    rm -f "$LAUNCH_LOG"
    exit 7
  fi
  echo "    相位完成信号已达（两相 + 观察者就绪）"
  # ② 触发真实前后台往返：先启动「设置」（本 App → willResignActive），再重新激活本 App
  #    ★实测依据（2026-09-30）：两次 launch 后 PID 不变 ⇒ 是同进程前后台往返，不是重启。
  xcrun devicectl device process launch --device "$UDID" com.apple.Preferences >/dev/null 2>&1 || true
  xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  # ③ 等 App 达成退出条件（kill -0 存活探测；launch 返回 = 报告已落盘）
  #    ★K 组（--k-crash）：退出条件是**真未捕获异常**（进程真死，非 exit(0)）——同一探测语义
  if ! wait_cond "! kill -0 $LPID 2>/dev/null" 120; then
    echo "✗ App 未在 120s 内达成退出条件（suspend+resume 都 applied 才退）——日志尾："
    tail -10 "$LAUNCH_LOG" | sed 's/^/      /'
    kill "$LPID" 2>/dev/null
    rm -f "$LAUNCH_LOG"
    exit 7
  fi
  wait "$LPID" 2>/dev/null || true
  LAUNCH_RC="$(sed -n 's/^LAUNCH_RC=//p' "$LAUNCH_LOG" | tail -1)"
  if grep -qiE "not been explicitly trusted|invalid code signature|error 3 \(0x03\)" "$LAUNCH_LOG"; then
    echo "✗ 启动被拦：需在**设备上手动信任开发者证书**（设置 → 通用 → VPN与设备管理）"
    rm -f "$LAUNCH_LOG"
    exit 5
  fi
  if grep -q "HOST_RUNTIME_REPORT_READY" "$LAUNCH_LOG"; then
    echo "    App 已主动上报：生命周期往返完成、报告落盘后退出（launch rc=${LAUNCH_RC:-?}）"
  else
    echo "    ⚠ 日志未见 HOST_RUNTIME_REPORT_READY（launch rc=${LAUNCH_RC:-?}）——以报告断言为准，日志尾："
    tail -6 "$LAUNCH_LOG" | sed 's/^/      /'
  fi
  rm -f "$LAUNCH_LOG"
elif [ "$MODE" = "bench" ]; then
  # ★用例过滤透传（`--cases=S5` ⇒ 宿主注入 __PROTEUS_CASES__）
  if [ -n "$CASE_FILTER" ]; then
    xcrun devicectl device process launch --console --terminate-existing \
      --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
      --device "$UDID" "$BUNDLE_ID" --bench "--cases=${CASE_FILTER}" > "$LAUNCH_LOG" 2>&1 || LAUNCH_RC=$?
  else
    xcrun devicectl device process launch --console --terminate-existing \
      --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
      --device "$UDID" "$BUNDLE_ID" --bench > "$LAUNCH_LOG" 2>&1 || LAUNCH_RC=$?
  fi
else
  xcrun devicectl device process launch --console --terminate-existing \
    --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
    --device "$UDID" "$BUNDLE_ID" > "$LAUNCH_LOG" 2>&1 || LAUNCH_RC=$?
fi
if [ -f "$LAUNCH_LOG" ] && grep -qiE "not been explicitly trusted|invalid code signature|error 3 \(0x03\)" "$LAUNCH_LOG"; then
  echo "✗ 启动被拦：需在**设备上手动信任开发者证书**"
  echo "    设置 → 通用 → VPN与设备管理 → 「Apple Development: …」→ 信任"
  echo "    （iOS 的强制步骤，脚本无法代做）"
  rm -f "$LAUNCH_LOG"
  exit 5
fi
if [ "$MODE" != "host-runtime" ]; then
  if grep -q "SELFDRAW_REPORT_READY" "$LAUNCH_LOG"; then
    echo "    App 已主动上报：报告落盘后退出（launch rc=${LAUNCH_RC}）"
  else
    echo "    ⚠ 日志未见 SELFDRAW_REPORT_READY（launch rc=${LAUNCH_RC}）——以报告断言为准，日志尾："
    tail -5 "$LAUNCH_LOG" | sed 's/^/      /'
  fi
  rm -f "$LAUNCH_LOG"
fi

echo "==> ⑧ 取回报告（App 已退出 ⇒ 只取一次；无轮询 / 无 sleep / 无超时）"
# ★★事件驱动（见 §⑦ 注释）：launch --console 返回 ⇒ App 已退出 ⇒ 报告已落盘。
#   只取**一次** + 两条内容断言（断言失败 ⇒ 直接失败退出，不等待）：
#     ① run_ts ≠ 基线（基线 = 设备**自己的**上一份报告）⇒ 确系本轮新报告；
#     ② js_report.build_id == 本次构建 ⇒ 防「重装后仍跑旧进程」（本仓实测踩过）。
FETCH_ERR="$(mktemp)"
if ! xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" --source "Documents/$REPORT_FILE" \
    --destination "$HERE/results/$REPORT_FILE" > "$FETCH_ERR" 2>&1; then
  echo "✗ 报告未取到：$(tail -1 "$FETCH_ERR")"
  rm -f "$FETCH_ERR"
  exit 7
fi
rm -f "$FETCH_ERR"
if [ "$MODE" = "app-stack" ]; then
  # ★M5：app-stack 报告是 `__proteusAppStackRun` 的**原样输出**（无 run_ts/build_id 字段）。
  #   新鲜度改由**退出口径**保证：`launch --console` 阻塞返回 = App 本进程已退出
  #   （device 上只可能有一个本 App 实例）；内容断言由判据脚本负责（读的是端上真数据）。
  echo "    （app-stack 模式：跳过 run_ts/build_id 断言——报告为纯逻辑读数；以判据为准）"
else
  FRESH_MSG="$(node "$HERE/lib/check-report-freshness.mjs" "$HERE/results/$REPORT_FILE" "$BASE_TS" 2>&1)"; FRESH_RC=$?
  if [ "$FRESH_RC" != "0" ]; then
    echo "✗ 报告不是本轮写出的（${FRESH_MSG}）——App 可能崩溃/被拦；不等待，直接失败"
    exit 7
  fi
fi
if [ "$MODE" = "host-runtime" ]; then
  # host-runtime 报告的 build_id 在**顶层**（不是 js_report 嵌套——该形态属渲染场景）
  BID_OK="$(python3 -c "
import json,sys
d=json.load(open('$HERE/results/$REPORT_FILE'))
print('ok' if d.get('build_id')=='$BUILD_ID' else 'build_id 不符：报告=%r 期望=%r' % (d.get('build_id'),'$BUILD_ID'))
" 2>&1)"
  if [ "$BID_OK" != "ok" ]; then
    echo "✗ ${BID_OK}——设备上跑的不是本次构建；不等待，直接失败"
    exit 7
  fi
elif [ "$MODE" = "showcase" ]; then
  # showcase 报告的 build_id 在**顶层**（JS 侧编译期注入——与 host-runtime 同款）
  BID_OK="$(python3 -c "
import json,sys
d=json.load(open('$HERE/results/$REPORT_FILE'))
print('ok' if d.get('build_id')=='$BUILD_ID' else 'build_id 不符：报告=%r 期望=%r' % (d.get('build_id'),'$BUILD_ID'))
" 2>&1)"
  if [ "$BID_OK" != "ok" ]; then
    echo "✗ ${BID_OK}——设备上跑的不是本次构建；不等待，直接失败"
    exit 7
  fi
elif [ "$MODE" = "app-stack" ]; then
  # ★M5：app-stack 报告是 `__proteusAppStackRun` 的**原样输出**（无 build_id 字段——它不是
  #   编译期注入的 bundle，而是纯逻辑读数）⇒ build_id 断言不适用；新鲜度由 run_ts 断言兜底。
  echo "    （app-stack 模式：跳过 build_id 断言——报告无该字段；run_ts 新鲜度已断言）"
else
  BID_MSG="$(node "$HERE/lib/check-report-build-id.mjs" "$HERE/results/$REPORT_FILE" "$BUILD_ID" 2>&1)"; BID_RC=$?
  if [ "$BID_RC" != "0" ]; then
    echo "✗ ${BID_MSG}——设备上跑的不是本次构建；不等待，直接失败"
    exit 7
  fi
fi
echo "    ✅ 报告为本轮写出且 build_id 匹配（零等待）"

# ★★G-39：宿主运行时模式——取壳转发报告 + 跑判据（与 Android 侧**同一判据脚本**）
if [ "$MODE" = "host-runtime" ]; then
  SHELL_REPORT="host-shell.json"
  if xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
      --domain-identifier "$BUNDLE_ID" --source "Documents/$SHELL_REPORT" \
      --destination "$HERE/results/$SHELL_REPORT" >/dev/null 2>&1; then
    echo "    壳转发报告：$HERE/results/$SHELL_REPORT"
  else
    echo "    ⚠ 壳转发报告未取到（${SHELL_REPORT}）——判据会据此判红（生命周期未被壳转发）"
  fi
  # ★K 证据（死前落盘）：判据按主报告**同目录**推导 host-app-events.json —— 必须先删本地旧件
  rm -f "$HERE/results/host-app-events.json"
  if xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
      --domain-identifier "$BUNDLE_ID" --source "Documents/host-app-events.json" \
      --destination "$HERE/results/host-app-events.json" >/dev/null 2>&1; then
    echo "    K 证据：$HERE/results/host-app-events.json（真未捕获异常 → JS 回执 → 死前落盘）"
  else
    echo "    ⚠ K 证据未取到（host-app-events.json）——判据会据此判红（应用事件源未被真驱动）"
  fi
  echo "==> ⑨ 判据（与 Android 同一脚本：platform 由报告 host_id 自报）"
  python3 "$ROOT/hosts/android/check-host-runtime.py" "$HERE/results/$REPORT_FILE" "$HERE/results/$SHELL_REPORT"
  exit $?
fi

# ★★Morpheus 炫技场：取收尾截图 + 跑专属判据
if [ "$MODE" = "showcase" ]; then
  if xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
      --domain-identifier "$BUNDLE_ID" --source "Documents/showcase-final.png" \
      --destination "$HERE/results/showcase-final.png" >/dev/null 2>&1; then
    echo "    收尾截图：$HERE/results/showcase-final.png"
  else
    echo "    ⚠ 截图未取到（判据会据此判红）"
  fi
  echo "==> ⑨ 判据（hosts/ios/check-showcase.py）"
  python3 "$HERE/check-showcase.py" "$HERE/results/$REPORT_FILE" "$HERE/results/showcase-final.png"
  exit $?
fi

# ★★M5：执行器模式——取第二份报告（执行器结果）+ 跑**同一份**判据（与 Android 侧共用）
if [ "$MODE" = "app-stack" ]; then
  EXEC_REPORT="app-stack-executor.json"
  rm -f "$HERE/results/$EXEC_REPORT"  # ★先删本地旧件（防 pull 失败读上轮）
  if xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
      --domain-identifier "$BUNDLE_ID" --source "Documents/$EXEC_REPORT" \
      --destination "$HERE/results/$EXEC_REPORT" >/dev/null 2>&1; then
    echo "    执行器报告：$HERE/results/$EXEC_REPORT"
  else
    echo "    ⚠ 执行器报告未取到（${EXEC_REPORT}）——判据 ⑦ 组会如实判红"
  fi
  echo "==> ⑨ 判据（与 Android 同一脚本 hosts/android/check-app-stack.py）"
  python3 "$ROOT/hosts/android/check-app-stack.py" "$HERE/results/$REPORT_FILE"
  exit $?
fi

# ★截图 = 软信号（bench 模式本就不产 PNG；报告已在上面硬断言过）
if xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" --source "Documents/$SNAP_FILE" \
    --destination "$HERE/results/$SNAP_FILE" >/dev/null 2>&1; then
  echo "    截图：$HERE/results/$SNAP_FILE"
else
  echo "    （无截图：$SNAP_FILE —— bench 模式属正常）"
fi
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

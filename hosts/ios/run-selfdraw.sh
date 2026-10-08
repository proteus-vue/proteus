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
#   ★★两台电脑（家/办公室）签名切换（2026-10-08）：按**主机名**读 hosts/ios/signing.local.json 的
#     签名档选证书/描述文件——每台机只需上档一次（bash hosts/ios/signing.sh use <账号>，见 hosts/ios/README.md）。
set -euo pipefail

# ★解析可用的 Xcode（devicectl/xcodebuild 只在完整 Xcode 里；本机 Xcode 在非默认位置）
#   详见 hosts/ios/lib/xcode-env.sh —— 导出 DEVELOPER_DIR，免去每次手工指定。
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/xcode-env.sh"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# ★★★两台电脑的签名切换（2026-10-08）——按**主机名**读 hosts/ios/signing.local.json 的签名档，
#   解析出本机该用的证书/描述文件/bundle（实现与判据见 hosts/ios/lib/ios-signing.mjs 文件头）。
#   无档 / 解析失败 ⇒ 完全落回下方原有自动逻辑（单机用户零影响）。
#   优先级：PROTEUS_BUNDLE_ID（显式）> 本机签名档 > 自动扫描述文件（原逻辑）。
PROTEUS_IOS_PIN_ACTIVE=0
if _PIN_OUT="$(node "$HERE/lib/ios-signing.mjs" resolve --shell 2>/dev/null)"; then
  eval "$_PIN_OUT"
else
  echo "    [pin] ⚠ 签名档解析失败（落回自动模式）——诊断：node hosts/ios/lib/ios-signing.mjs status"
fi

RUST_CRATE="$ROOT/packages/layout-core-rust"
BUILD="$HERE/build-selfdraw"
APP="$BUILD/ProteusSelfDraw.app"
# ★包名必须与**已 provision 的描述文件**匹配（免费个人团队无法任意新增 App ID）。
#   本机可用的 ID 见：for pf in ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision;
#     do security cms -D -i "$pf" | PlistBuddy -c "Print :Entitlements:application-identifier" /dev/stdin; done
# ★★2026-10-02 改为**自动探测**（本仓纪律：环境变化让硬编码默认值反复失效——已实测两次）：
#   默认值曾为 `dev.proteus.experiments`（旧团队），2026-09-28 因"私钥丢失"改为
#   `cn.shxuxi.proteus.experiments`（新团队 XKH568R7A5）；而后者**现又不在 Xcode 偏好里**
#   （描述文件不存在 ⇒ 每次跑都要手动传 PROTEUS_BUNDLE_ID，且报错在**编译+签名 5 分钟后**才出现）。
#   ⇒ 现在从**本机可用的描述文件**里自动挑第一个**有效**（未过期）的，与 BUNDLE_ID 匹配逻辑同源。
#   显式覆盖仍可用：PROTEUS_BUNDLE_ID=xxx。
# ★★2026-10-08 再改：**本机签名档（按主机名）优先**——两台电脑各上档一次后，本段直接取档里的 bundle，
#   不再依赖"扫到的第一个描述文件"（多团队/多项目机器上，扫第一个是**枚举顺序**，不是本机意图）。
#   优先级：PROTEUS_BUNDLE_ID（显式）> 本机签名档 > 自动扫描述文件（下方原逻辑）。
if [ -z "${PROTEUS_BUNDLE_ID:-}" ] && [ "${PROTEUS_IOS_PIN_ACTIVE}" = "1" ] && [ -n "${PROTEUS_IOS_BUNDLE_ID:-}" ]; then
  BUNDLE_ID="$PROTEUS_IOS_BUNDLE_ID"
  echo "    [pin] 按本机签名档选中 bundle id：${BUNDLE_ID}（档位：${PROTEUS_IOS_PIN_LABEL:-?} · team ${PROTEUS_IOS_TEAM:-?}）"
elif [ -z "${PROTEUS_BUNDLE_ID:-}" ]; then
  _AUTO_ID=""
  for _pf in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"/*.mobileprovision; do
    [ -f "$_pf" ] || continue
    # ★PlistBuddy 需要**真文件**（`/dev/stdin` 在管道里读不到——实测 "Error Reading File"）
    _tmp_pl="/tmp/proteus-prov-$$.plist"
    security cms -D -i "$_pf" > "$_tmp_pl" 2>/dev/null || { rm -f "$_tmp_pl"; continue; }
    _exp="$(/usr/libexec/PlistBuddy -c 'Print :ExpirationDate' "$_tmp_pl" 2>/dev/null || true)"
    _appid="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$_tmp_pl" 2>/dev/null || true)"
    rm -f "$_tmp_pl"
    # 过期检查（_exp 形如 "2026-10-08 01:41:55 +0000"；用 date 比较）
    if [ -n "$_appid" ]; then
      _epoch="$(date -j -f "%Y-%m-%d %H:%M:%S %z" "$_exp" +%s 2>/dev/null || echo 0)"
      if [ "$_epoch" -gt "$(date +%s)" ]; then
        _AUTO_ID="${_appid#*.}"      # 去 TEAM. 前缀
        : > /tmp/proteus-ios-autoid-log; echo "auto: $_appid (exp $_exp)" >> /tmp/proteus-ios-autoid-log
        break
      fi
    fi
  done
  if [ -n "$_AUTO_ID" ]; then
    BUNDLE_ID="$_AUTO_ID"
    echo "    [auto] 自动选中可用描述文件的 bundle id：${BUNDLE_ID}"
  else
    BUNDLE_ID="dev.proteus.experiments"   # 兜底（后续签名段会给出明确报错与指引）
    echo "    [auto] ⚠ 未找到有效描述文件——用兜底 ${BUNDLE_ID}（签名段会报错时按提示 provision）"
  fi
else
  BUNDLE_ID="$PROTEUS_BUNDLE_ID"
fi
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/spike/target}"

MODE="selfdraw"
UDID=""
# ★用例过滤（仅 --bench 有效）：`--cases=S5` 只跑 S5* 用例——定向验证不跑全套
#   （效率纪律：bench 46 用例整套数分钟，验证单改动通常只需 2–4 个）
CASE_FILTER=""
# ★--record：炫技场模式额外用 **ReplayKit 录屏**（App 内录真机屏幕，零外部工具）——
#   产物 Documents/showcase.mp4 随报告一起取回；之后由 `make-showcase-video.sh` 转网页格式。
# ★PROTEUS_SHOWCASE_SOAK_MS=<ms>：炫技场**长跑压力测量**（内存泄漏 + 热节流；默认 0 = 不跑）。
#   开启时报告本地另存 `results/showcase-soak.json`（canonical `showcase.json` 保持不变）。
RECORD=0
# ★★批次 44：superapp 模式是否"驱动"（`--drive`）——驱动 = 脚本切 tab + 落报告后自退（可自动化）；
#   不带 = 常驻（真·桌面点开形态）。
DRIVE=0
TAP=""
for a in "$@"; do
  case "$a" in
    --record) RECORD=1 ;;
    --bench) MODE="bench" ;;
    --stress) MODE="stress" ;;
    --host-runtime) MODE="host-runtime" ;;
    --app-stack) MODE="app-stack" ;;
    --showcase) MODE="showcase" ;;
    # ★★★批次 44（2026-10-05）：superapp 真实应用（桌面点开形态）——`--drive` = 验证模式（脚本
    #   驱动切 tab + 落 superapp.json 后自退）；不带 `--drive` = 常驻（真·桌面点开形态，不退出）。
    --superapp) MODE="superapp" ;;
    --drive) DRIVE=1 ;;
    # ★B1 交互判据（2026-10-07）：`--tap=x,y`（内容坐标 vp）——注入合成 tap 走与真触摸同链 → 落报告自退
    --tap=*) TAP="${a#--tap=}" ;;
    # ★★★批 A⑤（2026-10-08 · 决策 #656）：`--screen=<name>` + `--scroll=<dy>`——导航到屏 + 注入滚动
    #   → 截图 → 落报告自退（fixed/sticky 滚动锚定证据；与 Android `--es screen`/`--es scroll` 同语义）
    --screen=*) SCREEN_ARG="${a#--screen=}" ;;
    --scroll=*) SCROLL_ARG="${a#--scroll=}" ;;
    --native-mix) MODE="native-mix" ;;
    --vapor-ab) MODE="vapor-ab" ;;
    # ★★★Vapor 设备端链（2026-10-03 · 三端对齐）：与 Android/鸿蒙**同一份**判据（①–⑫）
    --vapor) MODE="vapor" ;;
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
  -o "$APP/ProteusSelfDraw" $PLATFORM_SRC "$HERE/ProteusHost/runtime/selfdraw-scene.swift" \
  "$HERE/ProteusHost/runtime/host-runtime-bridge.swift" "$HERE/ProteusHost/runtime/superapp-runtime-host.swift" "$HERE/ProteusHost/runtime/proteus-host-controller.swift" "$HERE/ProteusHost/runtime/host-capabilities.swift" \
  "$HERE/ProteusHost/runtime/host-lifecycle-events.swift" "$HERE/ProteusHost/runtime/screen-host.swift" \
  "$HERE/ProteusHost/dev/host-runtime-scene.swift" "$HERE/ProteusHost/dev/app-stack-scene.swift" "$HERE/ProteusHost/dev/showcase-scene.swift" "$HERE/ProteusHost/shell/superapp-scene.swift" "$HERE/ProteusHost/shell/selfdraw-app.swift" "$ABI_LIB" "$LIB"

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
# ★批次 43（superapp 真实应用）：superapp 应用入口 bundle → .app
[ -f "$HERE/bridge/dist/bundle-superapp.js" ] && cp "$HERE/bridge/dist/bundle-superapp.js" "$APP/bundle-superapp.js"
# ★★★App 三端对齐 · 视觉合成（2026-10-04）：App 屏内容产物 → .app（真机真画屏用）
APP_SC="$ROOT/${PROTEUS_APP_PROJECT:-superapp}/dist/app/ios/screen-content.json"
if [ -f "$APP_SC" ]; then
  cp "$APP_SC" "$APP/app-screen-content.json"
  echo "    app-screen-content.json 已入 .app（$(du -h "$APP_SC" | awk '{print $1}')）"
else
  echo "    ⚠ 未见 $APP_SC —— 缺它只影响视觉合成（先跑 examples 的 build:ios）"
fi
# ★★★运行时表现配置 → .app（2026-10-08 · 决策 #594）：宿主据此显隐系统状态栏（缺省 show）
APP_CFG="$ROOT/${PROTEUS_APP_PROJECT:-superapp}/dist/app/ios/app-config.json"
if [ -f "$APP_CFG" ]; then
  cp "$APP_CFG" "$APP/app-config.json"
  echo "    app-config.json 已入 .app"
fi
# ★Morpheus 炫技场 bundle（`--showcase` 模式用）
cp "$HERE/bridge/dist/bundle-showcase.js" "$APP/bundle-showcase.js"
# ★★A/B（矩阵 #14 续）：与 Android **同一份** `bundle-vapor.js` + `vapor-artifacts.json`
#   （零移植——JSVM/JSC 都直接 eval 同一份 IIFE；见 gen-fixtures 的同源复制纪律）。
#   源 = Android assets（那份是构建期由 gen-vapor-fixture.mjs 产出的权威版本）。
cp "$ROOT/hosts/android/bridge/dist/bundle-vapor.js" "$APP/bundle-vapor.js"
cp "$ROOT/hosts/android/app/src/main/assets/vapor-artifacts.json" "$APP/vapor-artifacts.json"
# ★描述文件与 entitlements 从**描述文件原样提取**（本仓 iOS 竖切实测的坑：
#   手工拼装会 0xe8008016 invalid entitlements；免费个人团队还需 team-identifier
#   + keychain-access-groups，少一项即无效）
PROFILE_DIR="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
# ★★2026-10-08：本机签名档优先——档里那份是"被本机证书授权"的描述文件（判据见 lib/ios-signing.mjs），
#   比 `ls -t | head -1`（取最新，可能属别的团队/项目）更准；无档时保持原逻辑。
if [ "${PROTEUS_IOS_PIN_ACTIVE}" = "1" ] && [ -n "${PROTEUS_IOS_PROFILE_PATH:-}" ] && [ -f "${PROTEUS_IOS_PROFILE_PATH}" ]; then
  PROFILE="${PROTEUS_IOS_PROFILE_PATH}"
else
  PROFILE="$(ls -t "$PROFILE_DIR"/*.mobileprovision 2>/dev/null | head -1 || true)"
fi
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
  <key>CFBundleDisplayName</key><string>Morpheus</string>
  <!-- ★缺省场景（无参数启动 = 从桌面点开）：★批次 44（2026-10-05）改为 **superapp**——点图标即进
       superapp 真实应用（可切 tab）；用户原话「手机主屏图标点开 App 就能测完整体验」。
       脚本各模式用显式参数覆盖（--selfdraw/--bench/--host-runtime/--app-stack/--showcase/--superapp）。 -->
  <key>ProteusDefaultScene</key><string>superapp</string>
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
# ★★2026-10-08：本机签名档优先——档里的 SHA-1 是"描述文件授权 ∩ 本机钥匙串"反查出来的
#   （判据见 hosts/ios/lib/ios-signing.mjs），比"取 find-identity 第一张"更准：同名两张/多团队机器上，
#   取第一张必错其一（本机实测：find-identity 第一张是另一个账号的证书）。
IDENTITY=""
if [ "${PROTEUS_IOS_PIN_ACTIVE}" = "1" ] && [ -n "${PROTEUS_IOS_IDENTITY_SHA1:-}" ]; then
  IDENTITY="$PROTEUS_IOS_IDENTITY_SHA1"
fi
# 以下为**无档时的原自动逻辑**：
# ★★按 **SHA-1** 选身份（2026-10-01 修复）：证书被吊销后重签会**同名两张**（同一 Apple ID、CN 相同），
#   按名称选会命中任一张（实测：选到吊销的那张 ⇒ 装机报
#   `0xe8008018 The identity used to sign the executable is no longer valid`）。
#   ⇒ 显式排除带 `CSSMERR`（已吊销）的条目，取第一张有效证书的 SHA-1；回退才用名称。
if [ -z "$IDENTITY" ]; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
    | grep -v CSSMERR | grep -E 'Apple Development|iPhone Developer' \
    | grep -oE '[0-9A-F]{40}' | head -1)"
fi
if [ -z "$IDENTITY" ]; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Apple Development|iPhone Developer/ {print $2; exit}')"
fi
[ -n "$IDENTITY" ] || { echo "✗ 无签名身份"; exit 3; }
# ★从可用的描述文件里挑一个与 BUNDLE_ID 匹配的（本仓 iOS 竖切实测的两条纪律：
#   ① entitlements 必须用 `PlistBuddy -x` 导出为 **XML**（只 Print 会得到"描述"而非 plist
#      → codesign 报 "unrecognized blob type / invalid length"）
#   ② 手工拼装 entitlements 会 0xe8008016；免费个人团队还需 team-identifier + keychain-access-groups）
# ★★2026-10-08：有签名档 ⇒ 直接用档里那份（还要与 BUNDLE_ID 一致，不一致才回退扫描）；
#   一致性（描述文件是否授权所选证书）在选定后由 `verify-pair` 显式校验——装机前的最后一道静默失效闸。
PROFILE=""
PROBE="$BUILD/probe.plist"
_pick_appid() { # $1=描述文件 → 打印 application-identifier（失败非零）
  security cms -D -i "$1" > "$PROBE" 2>/dev/null || return 1
  /usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$PROBE" 2>/dev/null
}
if [ "${PROTEUS_IOS_PIN_ACTIVE}" = "1" ] && [ -n "${PROTEUS_IOS_PROFILE_PATH:-}" ] && [ -f "${PROTEUS_IOS_PROFILE_PATH}" ]; then
  _pin_appid="$(_pick_appid "${PROTEUS_IOS_PROFILE_PATH}")" || _pin_appid=""
  case "$_pin_appid" in
    *".$BUNDLE_ID") PROFILE="${PROTEUS_IOS_PROFILE_PATH}" ;;
    *) echo "    [pin] ⚠ 档里的描述文件（${_pin_appid:-解析失败}）与 BUNDLE_ID=${BUNDLE_ID} 不一致——改用扫描" ;;
  esac
fi
if [ -z "$PROFILE" ]; then
  for pf in "$PROFILE_DIR"/*.mobileprovision; do
    [ -f "$pf" ] || continue
    _cand_appid="$(_pick_appid "$pf")" || continue
    case "$_cand_appid" in *".$BUNDLE_ID") PROFILE="$pf"; break ;; esac
  done
fi
[ -n "$PROFILE" ] || { echo "✗ 无匹配描述文件（BUNDLE_ID=${BUNDLE_ID}；换一个已 provision 的 ID：PROTEUS_BUNDLE_ID=... ）"; exit 3; }
# ★一致性校验（2026-10-08）：所选描述文件必须**授权所选证书**，否则装机必被拒（且错误出现得晚、看似签名问题）。
#   仅在 IDENTITY 是 SHA-1 时校验（回退成名称的极老路径没有可判定的 SHA-1，跳过并留给装机报错）。
if printf '%s' "$IDENTITY" | grep -qE '^[0-9A-Fa-f]{40}$'; then
  if ! node "$HERE/lib/ios-signing.mjs" verify-pair "$PROFILE" "$IDENTITY" >/dev/null 2>&1; then
    echo "    ⚠ 所选描述文件未授权所选证书（装机可能报 identity no longer valid / 0xe8008018）"
    echo "      诊断：bash hosts/ios/signing.sh status（有档时按档走；无档时检查钥匙串与描述文件是否同团队）"
  fi
fi
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
# ★★六端 SFC 压力夹具 · iOS **真机**（2026-10-02）——宿主 `--stress` 驱动器
#   （driveStress：renderStress → 截图 stress-sfc.png → 报告 stress-sfc.json → 自退）。
#   设备上是**独立 app**（dev.proteus.layoutcore 的 Morpheus 包——见下方 BUNDLE_ID 处理），
#   与既有 selfdraw/bench 场景同一宿主二进制、不同场景参数。
if [ "$MODE" = "stress" ]; then REPORT_FILE="stress-sfc.json"; SNAP_FILE="stress-sfc.png"; fi
if [ "$MODE" = "native-mix" ]; then REPORT_FILE="native-mix.json"; SNAP_FILE="native-mix.png"; fi
if [ "$MODE" = "vapor-ab" ]; then REPORT_FILE="vapor-ab.json"; SNAP_FILE="vapor-ab.png"; fi
if [ "$MODE" = "vapor" ]; then REPORT_FILE="vapor.json"; SNAP_FILE="vapor.png"; fi
# ★G-39：宿主运行时模式写独立报告（不污染既有产物命名）
# ★★★App 三端对齐 · 视觉合成（2026-10-04）：合成报告（真画屏 + 真触摸）在 launch 之后的 ⑧ 段取回——
#   ★此前误放在此处（launch **之前**）⇒ 取回的是**设备上上一轮**的报告（陈旧读数冒充新证据）。
#     与"提交≠交付"同族：位置错了就没人报错。移到 ⑧（App 已退出 = 本轮报告已落盘）后取回。

if [ "$MODE" = "host-runtime" ]; then REPORT_FILE="host-runtime.json"; SNAP_FILE="host-shell.json"; fi
# ★M5：执行器场景两份报告（主 + 执行器；判据合并读）
if [ "$MODE" = "app-stack" ]; then REPORT_FILE="app-stack.json"; SNAP_FILE="app-stack-executor.json"; fi
# ★★★批次 44：superapp 真实应用——驱动模式落 `superapp.json`（与 Android SuperappActivity 同名）
if [ "$MODE" = "superapp" ]; then REPORT_FILE="superapp.json"; SNAP_FILE="superapp.json"; fi
# ★Morpheus 炫技场（一份报告 + 一张收尾截图）
if [ "$MODE" = "showcase" ]; then
  REPORT_FILE="showcase.json"; SNAP_FILE="showcase-final.png"
  # ★长跑（压力测量）模式：设备端写的**仍是** showcase.json，本地**另存** showcase-soak.json——
  #   不覆盖「一轮到底」canonical 报告（它是官网视频/数字/截图同源的那一轮；长跑是独立证据）。
  if [ "${PROTEUS_SHOWCASE_SOAK_MS:-0}" != "0" ]; then
    REPORT_FILE="showcase-soak.json"
    DEVICE_REPORT_FILE="showcase.json"
  fi
fi
# ★过滤跑写独立文件（否则会把全量基准报告覆盖掉——历史读数不可再生）
if [ -n "$CASE_FILTER" ]; then
  SLUG="$(printf '%s' "$CASE_FILTER" | tr ',' '_')"
  REPORT_FILE="bench-filtered-${SLUG}.json"
  SNAP_FILE="bench-filtered-${SLUG}.png"
fi
# ★设备侧报告文件名（默认与本地同名；长跑模式本地另存、设备侧仍是 showcase.json——见上）
DEVICE_REPORT_FILE="${DEVICE_REPORT_FILE:-$REPORT_FILE}"

# ★基准 run_ts：launch 前先读设备上**现有**报告的时间戳；launch 返回后取回的报告必须不同
#   （证明"本轮真的写了新报告"；对照设备自己的旧报告 ⇒ 不涉及跨机器时钟）。
BASE_TS="none"
BASEF="$(mktemp)"
if xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" --source "Documents/$DEVICE_REPORT_FILE" \
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
  # ★★Morpheus 炫技场：单段 launch（App 内部：建树 → **整场节目单**（开场语→演出→长跑→谢幕语，
  #   帧循环驱动）→ 逐幕读数 + 内存采样 + 截图 → SHOWCASE_REPORT_READY → 自退）。脚本侧零轮询。
  #   ★长跑时长可由本机环境注入（冒烟用短值）：PROTEUS_SHOWCASE_SOAK_MS=3000 bash … --showcase
  #     默认 0 = 演出一遍到底（≈40 秒）；压力测量按需开启（如 300000 = 5 分钟）。
  #  ★默认 **0 = 不重复**（用户要求"每一幕演示一遍整个节目衔接就行，不用为了时长去一直重复"）；
  #    soak>0 ⇒ 本地另存 showcase-soak.json（canonical 不被覆盖——见报告名段注释）
  SOAK_MS="${PROTEUS_SHOWCASE_SOAK_MS:-0}"
  # ★--record ⇒ 追加 PROTEUS_SHOWCASE_RECORD=1（ReplayKit 录屏；见 showcase-scene.swift 注释）
  REC_ENV=""
  if [ "$RECORD" = "1" ]; then
    REC_ENV=",\"PROTEUS_SHOWCASE_RECORD\":\"1\""
    # ★★必须让用户知道什么时候点（2026-10-01 实测教训）：ReplayKit 的录屏授权是**系统弹窗**，
    #   只能手动点「允许」。App 侧已改为"等首帧到达才开演"（最长 30s）——**请在看到弹窗后点允许**，
    #   否则 30s 到点照常开演（无录屏，产物缺开场段会被对账判据判红）。
    echo "    ★★注意：设备将弹出「录制屏幕」授权窗——请点【允许】（App 会等首帧，最长 30s；不点则无录屏）"
  fi
  xcrun devicectl device process launch --console --terminate-existing \
    --environment-variables "{\"PROTEUS_EXIT_AFTER_REPORT\":\"1\",\"PROTEUS_SHOWCASE_SOAK_MS\":\"$SOAK_MS\"$REC_ENV}" \
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
elif [ "$MODE" = "stress" ]; then
  # ★★六端 SFC 压力夹具 · iOS 真机（2026-10-02）：`--stress` 场景 = 一次挂载 + 截图 + 报告 → 自退。
  #   完成信号与 selfdraw 同款：launch --console 阻塞到退出（零轮询/零 sleep/零 timeout）。
  xcrun devicectl device process launch --console --terminate-existing \
    --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
    --device "$UDID" "$BUNDLE_ID" --stress > "$LAUNCH_LOG" 2>&1 || LAUNCH_RC=$?
elif [ "$MODE" = "vapor-ab" ]; then
  # ★★A/B（矩阵 #14 续）：一次 launch 完成两路 mount + 三轮更新 + 事件对照 → 报告 → 自退。
  xcrun devicectl device process launch --console --terminate-existing \
    --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
    --device "$UDID" "$BUNDLE_ID" --vapor-ab > "$LAUNCH_LOG" 2>&1 || LAUNCH_RC=$?
elif [ "$MODE" = "vapor" ]; then
  # ★★★Vapor 设备端链（三端对齐）：跑 bundle 默认模式（runShort）→ 判据 ①–⑫ → 报告 → 自退。
  xcrun devicectl device process launch --console --terminate-existing \
    --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
    --device "$UDID" "$BUNDLE_ID" --vapor > "$LAUNCH_LOG" 2>&1 || LAUNCH_RC=$?
elif [ "$MODE" = "superapp" ]; then
  # ★★★批次 44/49：superapp 真实应用，两种启动语义——
  #   · `--drive`（自动化验证）：脚本驱动切 tab + 落 superapp.json 后**自退** ⇒ 用 `--console` 阻塞到退出；
  #   · 不带 `--drive`（**常驻给人看**）：App 不退出 ⇒ **绝不能加 `--console`**（本仓实测：加了会一直挂到
  #     App 退出为止 ⇒ 脚本永不返回、AI 侧看不到任何"结果"，而 App 其实早已在设备上跑起来）。
  #     ⇒ 无 `--console` 启动（launch 输出 PID 后**立即返回**），App 留在设备上常驻。
  SA_ARGS=(--superapp)
  if [ "$DRIVE" = "1" ]; then SA_ARGS+=(--drive); fi
  if [ -n "$TAP" ]; then SA_ARGS+=("--tap=$TAP"); fi
  if [ -n "${SCREEN_ARG:-}" ]; then SA_ARGS+=("--screen=$SCREEN_ARG"); fi
  if [ -n "${SCROLL_ARG:-}" ]; then SA_ARGS+=("--scroll=$SCROLL_ARG"); fi
  # ★B1：`--drive` 或 `--tap` 都是**自动化验证**（落报告后自退）⇒ 用 `--console` 阻塞到退出；
  #   两者皆无 = 常驻给人看（App 不退 ⇒ 绝不能加 `--console`，见上注释）。
  if [ "$DRIVE" = "1" ] || [ -n "$TAP" ] || [ -n "${SCROLL_ARG:-}" ]; then
    xcrun devicectl device process launch --console --terminate-existing \
      --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
      --device "$UDID" "$BUNDLE_ID" "${SA_ARGS[@]}" > "$LAUNCH_LOG" 2>&1 || LAUNCH_RC=$?
  else
    xcrun devicectl device process launch --terminate-existing \
      --device "$UDID" "$BUNDLE_ID" "${SA_ARGS[@]}" > "$LAUNCH_LOG" 2>&1 || LAUNCH_RC=$?
    # 常驻模式没有报告可取——取回启动快照（App 启动时自落 Documents/superapp.png）后收工
    if [ "$LAUNCH_RC" = "0" ]; then
      echo "    ✓ superapp 已常驻启动（App 留在设备上；脚本不再阻塞——日志：devicectl --console 才可见）"
      rm -f "$HERE/results/superapp.png"
      xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
        --domain-identifier "$BUNDLE_ID" --source "Documents/superapp.png" \
        --destination "$HERE/results/superapp.png" >/dev/null 2>&1 \
        && echo "    ✓ 启动快照 superapp.png（视觉证据）" || echo "    ⚠ 启动快照未取到"
      rm -f "$LAUNCH_LOG"
      exit 0
    fi
  fi
elif [ "$MODE" = "native-mix" ]; then
  # ★★矩阵 #10：原生组件混用（自绘 + 原生 UIView 共存）——一次挂载 + 建原生视图 + 采样 + 截图 → 自退。
  xcrun devicectl device process launch --console --terminate-existing \
    --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
    --device "$UDID" "$BUNDLE_ID" --native-mix > "$LAUNCH_LOG" 2>&1 || LAUNCH_RC=$?
else
  # ★自绘模式**显式传参**：从桌面点开（无参数）走 Info.plist 的缺省场景 = showcase，
  #   而脚本要的是自绘 ⇒ 必须显式声明（否则脚本跑起来的是演示）
  xcrun devicectl device process launch --console --terminate-existing \
    --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
    --device "$UDID" "$BUNDLE_ID" --selfdraw > "$LAUNCH_LOG" 2>&1 || LAUNCH_RC=$?
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
    --domain-identifier "$BUNDLE_ID" --source "Documents/$DEVICE_REPORT_FILE" \
    --destination "$HERE/results/$REPORT_FILE" > "$FETCH_ERR" 2>&1; then
  echo "✗ 报告未取到：$(tail -1 "$FETCH_ERR")"
  rm -f "$FETCH_ERR"
  exit 7
fi
rm -f "$FETCH_ERR"
# ★★★App 三端对齐 · 视觉合成 + 真触摸（2026-10-04）：取回合成报告 + PNG（真画屏 + 真触摸证据）。
#   ★必须在 launch **之后**（App 已退出 = 本轮报告已落盘）取回——放 launch 之前会取到上一轮的旧件。
if [ "$MODE" = "app-stack" ]; then
  # ★批次 43：取回真实 superapp 运行报告
  rm -f "$HERE/results/superapp.json"
  xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" --source "Documents/superapp.json" \
    --destination "$HERE/results/superapp.json" >/dev/null 2>&1 || echo "  ⚠ superapp 报告未取到"
  rm -f "$HERE/results/app-screen-composite.json"
  xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" --source "Documents/app-screen-composite.json" \
    --destination "$HERE/results/app-screen-composite.json" >/dev/null 2>&1 || echo "  ⚠ 合成报告未取到"
  # 快照名：优先 app-screen-composite.png，回退 selfdraw-final.png（JS 桥快照名可能被静态默认覆盖）
  if ! xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
      --domain-identifier "$BUNDLE_ID" --source "Documents/app-screen-composite.png" \
      --destination "$HERE/results/app-screen-composite.png" >/dev/null 2>&1; then
    xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
      --domain-identifier "$BUNDLE_ID" --source "Documents/selfdraw-final.png" \
      --destination "$HERE/results/app-screen-composite.png" >/dev/null 2>&1 || echo "  ⚠ 合成 PNG 未取到"
  fi
fi
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
elif [ "$MODE" = "app-stack" ] || [ "$MODE" = "native-mix" ] || [ "$MODE" = "vapor-ab" ] || [ "$MODE" = "vapor" ] || [ "$MODE" = "superapp" ]; then
  # ★M5：app-stack 报告是 `__proteusAppStackRun` 的**原样输出**（无 build_id 字段——它不是
  #   编译期注入的 bundle，而是纯逻辑读数）⇒ build_id 断言不适用；新鲜度由 run_ts 断言兜底。
  # ★矩阵 #10：native-mix 报告由 Swift 侧组装（含 run_ts；无 bundle 注入的 build_id）——同处理。
  echo "    （$MODE 模式：跳过 build_id 断言——报告无该字段；run_ts 新鲜度已断言）"
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

# ★★Morpheus 炫技场：取两张截图（谢幕语收尾 + 漩涡中场面）+ 跑专属判据
if [ "$MODE" = "showcase" ]; then
  if [ "$REPORT_FILE" = "showcase-soak.json" ]; then
    # ★长跑模式：截图/录屏**跳过取回**（避免用长跑那轮覆盖 canonical 产物——它们是「一轮到底」
    #   那轮的同一轮证据；长跑的证据 = 报告本身：内存采样 + 热状态 + 帧统计）。
    echo "    （长跑模式：截图/录屏不取回——canonical 产物保持「一轮到底」那轮不被覆盖）"
    echo "==> ⑨ 判据（hosts/ios/check-showcase.py · 长跑报告）"
    python3 "$HERE/check-showcase.py" "$HERE/results/$REPORT_FILE"
    exit $?
  fi
  if xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
      --domain-identifier "$BUNDLE_ID" --source "Documents/showcase-final.png" \
      --destination "$HERE/results/showcase-final.png" >/dev/null 2>&1; then
    echo "    收尾截图：$HERE/results/showcase-final.png"
  else
    echo "    ⚠ 收尾截图未取到（判据会据此判红）"
  fi
  # 中场面（漩涡定格）——缺了不致命（判据对它是"有更好"），但如实报告
  if xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
      --domain-identifier "$BUNDLE_ID" --source "Documents/showcase-spiral.png" \
      --destination "$HERE/results/showcase-spiral.png" >/dev/null 2>&1; then
    echo "    漩涡定格：$HERE/results/showcase-spiral.png"
  else
    echo "    （漩涡定格截图未取到——不影响判据）"
  fi
  # 录屏（--record 时才有；缺了不判红——录屏是展示物，不是判据前提）
  if [ "$RECORD" = "1" ]; then
    if xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
        --domain-identifier "$BUNDLE_ID" --source "Documents/showcase.mp4" \
        --destination "$HERE/results/showcase.mp4" >/dev/null 2>&1; then
      echo "    录屏：$HERE/results/showcase.mp4（$(du -h "$HERE/results/showcase.mp4" | cut -f1)）"
      echo "    ⇒ 转网页格式：bash hosts/ios/make-showcase-video.sh"
    else
      echo "    ⚠ 录屏未取到（showcase.mp4）——检查日志里 SHOWCASE_RECORDING_* 标记"
    fi
  fi
  echo "==> ⑨ 判据（hosts/ios/check-showcase.py）"
  python3 "$HERE/check-showcase.py" "$HERE/results/$REPORT_FILE" "$HERE/results/showcase-final.png" "$HERE/results/showcase-spiral.png"
  exit $?
fi

# ★★矩阵 #10：原生组件混用——跑判据（三件事：位置由核心决定 / 原生真渲染 / z-order 实测）
if [ "$MODE" = "native-mix" ]; then
  # ★判据放**截图取回之后**跑（见下方 ⑩ 段——先设标记；不在此 exit，否则截图步骤被跳过）
  NATIVE_MIX_CHECK=1
fi
if [ "$MODE" = "vapor-ab" ]; then
  # ★★A/B（矩阵 #14 续）：判据与 Android **同一份**（check-vapor-ab.py）——放截图取回之后跑
  VAPOR_AB_CHECK=1
fi
if [ "$MODE" = "vapor" ]; then
  # ★★★Vapor 设备端链（三端对齐）：判据与 Android/鸿蒙**同一份**（check-vapor-device.py）——
  #   放截图取回之后跑（见下方 ⑩ 段）。
  VAPOR_CHECK=1
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

# ★★★批次 44/47：superapp 桌面入口——取回**视觉证据 PNG** + 打印摘要（切 tab 记账 + 宿主建树）
if [ "$MODE" = "superapp" ]; then
  rm -f "$HERE/results/superapp.png"
  if xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
      --domain-identifier "$BUNDLE_ID" --source "Documents/superapp.png" \
      --destination "$HERE/results/superapp.png" >/dev/null 2>&1; then
    echo "    ✓ 截图 superapp.png"
  else
    echo "    ⚠ 截图未取到（superapp.png）"
  fi
  python3 -c "
import json
d=json.load(open('$HERE/results/$REPORT_FILE'))
print('    报告：$HERE/results/$REPORT_FILE')
print('    ok=%s host=%s rendered=%s' % (d.get('ok'), d.get('host_id'), d.get('rendered_page')))
for row in (d.get('switch_log') or []):
    print('      %s tap=%s → current=%s (via %s)' % ('✓' if row.get('ok') else '✗', row.get('tap'), row.get('current'), row.get('via','-')))
print('    host_stats=%s' % (d.get('host_stats'),))
" 2>/dev/null || echo "    （报告未取到——检查设备日志）"
  exit 0
fi

# ★截图 = 软信号（bench 模式本就不产 PNG；报告已在上面硬断言过）
if xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" --source "Documents/$SNAP_FILE" \
    --destination "$HERE/results/$SNAP_FILE" >/dev/null 2>&1; then
  echo "    截图：$HERE/results/$SNAP_FILE"
else
  echo "    （无截图：$SNAP_FILE —— bench 模式属正常）"
fi
if [ "${NATIVE_MIX_CHECK:-0}" = "1" ]; then
  echo "==> ⑩ 判据（scripts/check-native-mix-ios.mjs）"
  node "$ROOT/scripts/check-native-mix-ios.mjs" "$HERE/results/$REPORT_FILE"
  exit $?
fi
if [ "${VAPOR_AB_CHECK:-0}" = "1" ]; then
  echo "==> ⑩ 判据（与 Android **同一份** hosts/android/check-vapor-ab.py）"
  python3 "$ROOT/hosts/android/check-vapor-ab.py" "$HERE/results/$REPORT_FILE"
  exit $?
fi
if [ "${VAPOR_CHECK:-0}" = "1" ]; then
  echo "==> ⑩ 判据（与 Android/鸿蒙 **同一份** hosts/android/check-vapor-device.py——按 host_id 分档）"
  python3 "$ROOT/hosts/android/check-vapor-device.py" "$HERE/results/$REPORT_FILE"
  exit $?
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

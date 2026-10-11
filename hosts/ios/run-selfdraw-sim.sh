#!/usr/bin/env bash
# hosts/ios/run-selfdraw-sim.sh —— ★★在 **iOS 模拟器**上跑自绘链路（零签名/零描述文件/零设备）
#
# 【为什么需要（2026-09-29 的定位）】
#   真机链路由 `run-selfdraw.sh` 承担（走 `devicectl`，**需 Xcode 15+**）。
#   本脚本提供一条**更轻的旁路**：
#     · 不需要签名/描述文件（免费个人账号在设备上最多 3 个 App，常被占满）
#     · 不需要真机在场 ⇒ **改完立刻能验**（几秒级 vs 真机的构建+安装+等待）
#   ★它不是"因为没有真机工具链才退而求其次"——本机 **Xcode 26.5 带 devicectl**，真机链路可用
#     （我最初误判成"本机无可用 Xcode"，是因为解析器按 mdfind 顺序先命中 14.2；
#      已修为"优先真机能力完备的 Xcode"，见 `lib/xcode-env.sh`）。
#   ⇒ 两者的分工：**本脚本验"接线正确 + 判据有区分力"（快、频繁）**；
#     真机验"内存/性能的真实数值"（慢、但权威）。
#
# 【能证明什么 / 不能证明什么（★诚实边界，写进输出）】
#   ✅ 能证明：链路真的通了（适配器发 hint → 宿主读 hint → 层上设了 `contentsFormat`）
#            + 两侧树/层结构一致 + 报告读数非零（"设了没设"可观测）
#   ❌ 不能证明：**内存收益的真实数值**——模拟器与真机的 GPU/内存行为不同
#            （−39% 是**真机**实测值）。⇒ 内存数字仍须真机复测；本脚本只保证"接线正确"。
#   ❌ 不能证明：真机 JIT/性能（模拟器与设备 JSC 策略不同——既有脚本已注明）。
#
# 用法：bash hosts/ios/run-selfdraw-sim.sh [模拟器名] [--bench]
set -uo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/xcode-env.sh"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RUST_CRATE="$ROOT/packages/layout-core-rust"
BUILD="$HERE/build-sim"
APP="$BUILD/ProteusSelfDraw.app"
BUNDLE_ID="dev.proteus.selfdraw.sim"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/spike/target}"

SIM_NAME="iPhone 14 Pro"
MODE="selfdraw"
APP_ARGS=()
for a in "$@"; do
  case "$a" in
    --bench) MODE="bench" ;;
    --showcase) MODE="showcase" ;;
    # ★★★v-pump/跳变驱动动画（本批）：`--superapp`（真实应用壳）+ `--pump=<page>[,<ms>]`/`--drive`/`--tap=x,y`
    #   ——模拟器**无需签名** ⇒ 真机签名不可用时的**接线验证旁路**（本脚本定位：验接线正确、判据有区分力）。
    --superapp) MODE="superapp" ;;
    --pump=*|--drive|--tap=*) APP_ARGS+=("$a") ;;
    *) SIM_NAME="$a" ;;
  esac
done

echo "==> 目标模拟器：$SIM_NAME · 模式：$MODE"
echo "★诚实边界：模拟器可证「接线正确 + 读数非零」；**内存收益数值须真机复测**（−39% 是真机读数）"

echo "==> ① 构建 TS 侧（renderer-app dist）"
(cd "$ROOT" && pnpm --filter @proteus-vue/renderer-app run build 2>&1 | tail -1)

echo "==> ② JS bundle（自绘 + bench + 展示 + superapp 都建）"
for s in build-selfdraw.mjs build-bench.mjs build-showcase.mjs build-app-stack.mjs; do
  if ! out="$( (cd "$ROOT" && node "hosts/ios/bridge/$s") 2>&1 )"; then
    echo "✗ bundle 构建失败：$s"; echo "$out" | tail -5 | sed 's/^/    /'; exit 6
  fi
  echo "$out" | tail -1 | sed 's/^/    /'
done

echo "==> ③ 编译 Rust 核心（★模拟器 target：aarch64-apple-ios-sim）"
export PATH="$HOME/.cargo/bin:$PATH"
if ! cargo build --release --target aarch64-apple-ios-sim --manifest-path "$RUST_CRATE/Cargo.toml" 2>&1 | grep -E "^error|Finished" | tail -2; then
  echo "✗ Rust 编译失败（装 target：rustup target add aarch64-apple-ios-sim）"; exit 3
fi
LIB="$CARGO_TARGET_DIR/aarch64-apple-ios-sim/release/libproteus_layout_core.a"
[ -f "$LIB" ] || { echo "✗ 未生成静态库：$LIB"; exit 3; }
# ★修正（本批）：superapp 壳用 ScreenHost/HostRuntimeBridge ⇒ 同真机口径链接 host-abi 静态库。
(cd "$ROOT/packages/host-abi" && cargo build --release --target aarch64-apple-ios-sim 2>&1 | grep -E "^error" -A 4 || true)
ABI_LIB="$CARGO_TARGET_DIR/aarch64-apple-ios-sim/release/libproteus_host_abi.a"
[ -f "$ABI_LIB" ] || { echo "✗ 未生成 host-abi 静态库：$ABI_LIB"; exit 3; }

echo "==> ④ 编译 Swift 宿主（模拟器 SDK）"
rm -rf "$APP"; mkdir -p "$APP"
# ★修正（本批）：源码列表须与真机 run-selfdraw.sh **对齐**——此前缺 superapp-runtime-host.swift
#   **与 platform/ios 适配层** ⇒ 模拟器编译 superapp-scene 报 "cannot find SuperappRuntimeHost /
#   ProteusTextAdapter"（列表落后于真机的既有缺口）。
PLATFORM_SRC="$(ls "$ROOT"/platform/ios/ProteusPlatform/*.swift 2>/dev/null | tr '\n' ' ')"
[ -n "$PLATFORM_SRC" ] || { echo "✗ 找不到 platform/ios 平台适配源码（HA0.5 抽取后被删？）"; exit 3; }
xcrun --sdk iphonesimulator swiftc -O -target arm64-apple-ios15.0-simulator \
  -framework UIKit -framework CoreText -framework JavaScriptCore -framework AVFoundation -parse-as-library \
  -o "$APP/ProteusSelfDraw" $PLATFORM_SRC "$HERE/ProteusHost/runtime/selfdraw-scene.swift" "$HERE/ProteusHost/runtime/host-runtime-bridge.swift" "$HERE/ProteusHost/runtime/superapp-runtime-host.swift" "$HERE/ProteusHost/runtime/proteus-host-controller.swift" "$HERE/ProteusHost/runtime/host-capabilities.swift" "$HERE/ProteusHost/runtime/host-lifecycle-events.swift" "$HERE/ProteusHost/runtime/screen-host.swift" "$HERE/ProteusHost/dev/host-runtime-scene.swift" "$HERE/ProteusHost/dev/app-stack-scene.swift" "$HERE/ProteusHost/dev/showcase-scene.swift" "$HERE/ProteusHost/shell/superapp-scene.swift" "$HERE/ProteusHost/shell/selfdraw-app.swift" "$ABI_LIB" "$LIB" 2>&1 | grep -E "error:" | head -5
[ -f "$APP/ProteusSelfDraw" ] || { echo "✗ Swift 编译未产出可执行文件"; exit 3; }

echo "==> ⑤ 组装 .app（★无需签名/描述文件——模拟器不校验）"
cp "$HERE/bridge/dist/bundle-selfdraw.js" "$APP/bundle-selfdraw.js"
cp "$HERE/bridge/dist/bundle-bench.js" "$APP/bundle-bench.js"
cp "$HERE/bridge/dist/bundle-showcase.js" "$APP/bundle-showcase.js"
# ★★★superapp 模式（本批）：运行期 bundle + 屏内容产物（与真机 run-selfdraw.sh 同款入包）
if [ "$MODE" = "superapp" ]; then
  cp "$HERE/bridge/dist/bundle-superapp.js" "$APP/bundle-superapp.js"
  APP_SC="$ROOT/${PROTEUS_APP_PROJECT:-superapp}/dist/app/ios/screen-content.json"
  if [ -f "$APP_SC" ]; then cp "$APP_SC" "$APP/app-screen-content.json"
  else echo "    ⚠ 未见 $APP_SC——superapp 壳需要它（先跑 proteus build --target ios 的 bundle 步骤）"; fi
fi
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

echo "==> ⑥ 启动模拟器（事件驱动：bootstatus 阻塞到完成——无轮询 / 无 sleep）"
# ★`simctl bootstatus -b`：需要则先 boot，然后**阻塞**直到启动完成（系统自带的完成事件；
#   替代原先的「for 循环 + sleep 2」探测）。
xcrun simctl bootstatus "$SIM_NAME" -b >/dev/null 2>&1 || { echo "✗ 模拟器未能启动：$SIM_NAME"; exit 4; }
echo "    已启动：$SIM_NAME"

echo "==> ⑦ 安装并启动（事件驱动：App 报告落盘后自退——launch --console 返回即完成）"
# ★★安装会**换容器**（实测踩到）：`simctl install` 之后数据容器路径可能变化
#   ⇒ 容器路径必须在 install **之后**取（先取再装 ⇒ 拿到旧容器 ⇒ 报告永远找不到）。
xcrun simctl uninstall booted "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl install booted "$APP" || { echo "✗ 安装失败"; exit 4; }
CONTAINER="$(xcrun simctl get_app_container booted "$BUNDLE_ID" data 2>/dev/null || true)"
[ -n "$CONTAINER" ] || { echo "✗ 取不到数据容器"; exit 4; }

# ★★事件驱动（2026-09-30 重写；替代原先的「for + sleep 2 × 60」轮询。用户红线：
#   「禁止任何 sleep/timeout——要么 App 主动上报，要么有条件等待」）：
#   宿主 `PROTEUS_EXIT_AFTER_REPORT=1` ⇒ 报告落盘后**进程自退**；
#   `simctl launch --console` **阻塞到进程退出**才返回 ⇒ 返回即完成。零轮询 / 零 sleep。
#   ★环境变量经 `SIMCTL_CHILD_` 前缀传给 App（simctl 的既定机制）。
#   ★原注释保留（它解释了为什么弃用 --console-pty）：--console-pty 把 stdout 绑到 pty，
#     脚本被外部 timeout 杀掉时会连应用一起杀（报告未写就被杀）；现在**不用 timeout**、
#     由 App 自退 ⇒ 用 --console 无此问题。
REPORT="selfdraw-report.json"
[ "$MODE" = "bench" ] && REPORT="logic-bench-report.json"
[ "$MODE" = "showcase" ] && REPORT="showcase.json"
[ "$MODE" = "superapp" ] && REPORT="superapp.json"
# ★★★superapp 模式：显式 `--superapp`（+ `--pump` 等透传）——与真机 run-selfdraw.sh 同参数契约；
#   无参数时也落 superapp 场景（selfdraw-app 的缺省场景已是 superapp）。
if [ "$MODE" = "superapp" ]; then
  SIMCTL_CHILD_PROTEUS_EXIT_AFTER_REPORT=1 xcrun simctl launch --console booted "$BUNDLE_ID" --superapp "${APP_ARGS[@]}" >/dev/null 2>&1 || true
else
  SIMCTL_CHILD_PROTEUS_EXIT_AFTER_REPORT=1 xcrun simctl launch --console booted "$BUNDLE_ID" >/dev/null 2>&1 || true
fi
if [ -f "$CONTAINER/Documents/$REPORT" ]; then
  echo "    报告已生成（App 主动上报；无等待）"
else
  echo "    ✗ 报告未生成——打印最近日志以便归因："
  xcrun simctl spawn booted log show --last 2m --predicate 'process == "ProteusSelfDraw"' 2>/dev/null | grep -iE "proteus|error" | tail -8 | sed 's/^/      /'
  exit 5
fi

echo ""
echo "==> ⑧ 从模拟器容器取报告（★取不到就是取不到，不假装成功）"
if [ -n "$CONTAINER" ] && [ -f "$CONTAINER/Documents/$REPORT" ]; then
  mkdir -p "$HERE/results"
  cp "$CONTAINER/Documents/$REPORT" "$HERE/results/sim-$REPORT"
  echo "    报告：hosts/ios/results/sim-$REPORT"
  # ★★判据分派：showcase 走专属判据（含截图）；superapp 打读 + pump 断言；其余走 I3
  if [ "$MODE" = "showcase" ]; then
    cp "$CONTAINER/Documents/showcase-final.png" "$HERE/results/sim-showcase-final.png" 2>/dev/null || true
    python3 hosts/ios/check-showcase.py "$HERE/results/sim-$REPORT" "$HERE/results/sim-showcase-final.png"
    RC=$?
  elif [ "$MODE" = "superapp" ]; then
    cp "$CONTAINER/Documents/superapp.png" "$HERE/results/sim-superapp.png" 2>/dev/null || true
    # ★★★v-pump 判据（本批）：`pump.calls`/`fire_ticks` > 0 = 周期驱动真跑了且真写进数据源；
    #   `anim_start_calls` > 0 = `v-animate`/`<Transition>` 走到了宿主动画入口（#793 判据纪律：
    #   看内核受理，不看截屏像素）。两项都 0 ⇒ 当场红（接线没生效）。
    python3 - "$HERE/results/sim-$REPORT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print('    报告：ok=%s host=%s rendered=%s' % (d.get('ok'), d.get('host_id'), d.get('rendered_page')))
p = d.get('pump') or {}
print('    pump：running=%s interval_ms=%s calls=%s fire_ticks=%s pumps=%s' % (
    p.get('running'), p.get('interval_ms'), p.get('calls'), p.get('fire_ticks'), p.get('pumps')))
print('    anim：anim_start_calls=%s stopped_total=%s' % (p.get('anim_start_calls'), p.get('anim_started_total')))
calls = int(p.get('calls') or 0); fires = int(p.get('fire_ticks') or 0); anims = int(p.get('anim_start_calls') or 0)
if calls <= 0 or fires <= 0:
    print('✗ 泵周期驱动未生效（calls=%s fire_ticks=%s）——接线失败' % (calls, fires)); sys.exit(7)
if anims <= 0:
    print('✗ v-animate/<Transition> 未走到宿主动画入口（anim_start_calls=0）——接线失败'); sys.exit(7)
print('✅ 泵驱动 + 跳变驱动动画接线通过（calls=%s fire_ticks=%s anim_start_calls=%s）' % (calls, fires, anims))
PY
    RC=$?
  else
    # ★★I3 判据（不是"打印读数"——读数必须能**判红**，否则等于没有门禁）
    python3 hosts/ios/check-paint-hint.py "$HERE/results/sim-$REPORT"
    RC=$?
  fi
  if [ "$RC" != "0" ]; then echo "✗ 判据未通过（见上方）"; exit 7; fi
else
  echo "    ⚠ 未取到报告（容器：${CONTAINER:-未取得}）—— 看上方 console 输出"
fi

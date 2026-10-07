#!/usr/bin/env bash
# hosts/harmony/build-host-app.sh —— Proteus 鸿蒙宿主：构建（离线 CLI，零 IDE 依赖）
#
# 【为什么能纯 CLI 跑（2026-10-02 实测）】DevEco Studio 自带全套构建工具：
#   · hvigor（构建）+ 自带 node 18 + 自带 JDK 21 + SDK（API 24）
#   ⇒ 设置三个环境变量（NODE_HOME / DEVECO_SDK_HOME / JAVA_HOME）即可 `hvigorw assembleHap`。
#   实测：干净工程 7~12 秒构建成功（增量 2.5 秒）。
#
# 【签名（唯一需要 IDE 一次介入的环节）】
#   本设备（华为商业版 HarmonyOS）只信任**华为 CA** 签发的调试证书——实测社区 OpenHarmony
#   调试材料签出的 hap 被设备拒装（`fail to verify pkcs7 file`，本地 verify-app 却通过）。
#   ⇒ 用 DevEco Studio 登录华为账号并勾选 "Automatically generate signature" 一次；
#     生成的签名配置写入 build-profile.json5（machine-local，勿提交）——之后 CLI 全程可用。
#   本脚本会自动检测签名状态并提示（不阻断构建：unsigned hap 也能产出）。
#
# 【★★★CSS 验收独立应用（`--css`，2026-10-08 · 对齐 Android `--css`）】
#   安卓能出「CSS 验收」独立桌面图标（`dev.proteus.cssconf`，与 `dev.proteus.layoutcore` 并存）。
#   鸿蒙**一个 bundleName 只能有一个桌面图标**（launcher 只取单个入口 UIAbility 的 icon/label——
#   SDK `module.json` schema + 官方"配置应用图标和名称"优先级规则）⇒ 要第二图标必须**第二个 bundleName**。
#   机制 = `build-profile.json5` 的**产品维度**（product）：`cssconf` 产品带自己的
#   `bundleName: dev.proteus.cssconf` + `label: $string:app_name_cssconf`（"CSS 验收"）。
#   本脚本 `--css` ⇒ 构建 `-p product=cssconf` + 默认应用工程 css-conformance。
#   ★**唯一前置**：`dev.proteus.cssconf` 的**签名 profile**（bound 到该 bundleName）。
#     生成：DevEco Studio → File → Project Structure → Signing Configs → 勾 "Automatically
#     generate signature"（需登录华为账号）——DevEco 会把新 profile 写进本地 build-profile.json5
#     并（通常）自动挂到 cssconf 产品。★未配置签名时本脚本产出 unsigned hap 并**明确提示**。
#
# 用法：
#   bash hosts/harmony/build-host-app.sh            # 构建默认应用（superapp）
#   bash hosts/harmony/build-host-app.sh --clean    # 清理后重建
#   bash hosts/harmony/build-host-app.sh --css      # 构建「CSS 验收」独立应用（product=cssconf）
#   PROTEUS_APP_PROJECT=xxx bash hosts/harmony/build-host-app.sh   # 换应用工程（默认随 --css 自动为 css-conformance）
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$HERE/host-app"
ROOT="$(cd "$HERE/../.." && pwd)"

# ── 参数解析 ──
CLEAN=0
CSS=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --css)   CSS=1 ;;
    *) echo "✗ 未知参数：${arg}（用法见文件头）"; exit 2 ;;
  esac
done
# --css ⇒ 产品 cssconf，且默认应用工程 = css-conformance（可被显式 PROTEUS_APP_PROJECT 覆盖）
if [ "$CSS" = "1" ]; then
  PRODUCT="cssconf"
  export PROTEUS_APP_PROJECT="${PROTEUS_APP_PROJECT:-css-conformance}"
  echo "    构建模式：CSS 验收独立应用（bundleName=dev.proteus.cssconf · product=cssconf · 应用工程=${PROTEUS_APP_PROJECT}）"
else
  PRODUCT="default"
fi

# ── DevEco 工具链解析（与 hdc.sh 同策略：显式覆盖 > 常见安装位）──
find_deveco() {
  if [ -n "${PROTEUS_DEVECO:-}" ] && [ -d "${PROTEUS_DEVECO}" ]; then echo "$PROTEUS_DEVECO"; return 0; fi
  local candidates=(
    "/Volumes/data1/work/office-applications/DevEco-Studio.app/Contents"
    "$HOME/Applications/DevEco-Studio.app/Contents"
    "/Applications/DevEco-Studio.app/Contents"
  )
  local c
  for c in "${candidates[@]}"; do
    if [ -x "$c/tools/hvigor/bin/hvigorw" ]; then echo "$c"; return 0; fi
  done
  return 1
}
DEVECO="$(find_deveco)" || {
  echo "✗ 找不到 DevEco Studio（或用 PROTEUS_DEVECO 显式指定 Contents 目录）"; exit 2; }

[ -d "$APP_DIR" ] || { echo "✗ 缺工程目录：$APP_DIR"; exit 2; }

# ── build-profile.json5：**本地签名配置**（模板 → 本地，首次构建自动生成）──
#   ★为什么不入库：signingConfigs 含**本机绝对路径 + keyPassword/storePassword**（机器本地状态）。
#   入库形态是 `build-profile.template.json5`（占位、签名空）；真实文件由本行生成 + .gitignore 忽略。
if [ ! -f "$APP_DIR/build-profile.json5" ]; then
  cp "$APP_DIR/build-profile.template.json5" "$APP_DIR/build-profile.json5"
  echo "  ℹ 已从 build-profile.template.json5 生成 build-profile.json5（未配置签名 ⇒ 产出 unsigned hap）"
fi

# ── cssconf 产品存在性检查（--css 时）──
#   ★判据：本地 build-profile.json5 必须声明 `"name": "cssconf"` 产品（模板已含）。
#     旧机器上遗留的本地文件（由更早模板生成）可能没有 ⇒ 明确报错并给修法（不静默降级去建 default）。
if [ "$CSS" = "1" ] && ! grep -q '"name": *"cssconf"' "$APP_DIR/build-profile.json5" 2>/dev/null; then
  echo "✗ build-profile.json5 缺 cssconf 产品（--css 需要）——"
  echo "  本地文件是旧模板生成的。修法（二选一）："
  echo "    ① 删掉本地文件让它按新模板重建（会丢失现有签名配置，需重做一次 DevEco 自动签名）："
  echo "       rm \"$APP_DIR/build-profile.json5\""
  echo "    ② 手动把 build-profile.template.json5 里的 cssconf 产品块 + 两处 applyToProducts 抄进来"
  exit 3
fi

export NODE_HOME="$DEVECO/tools/node"
export PATH="$NODE_HOME/bin:$PATH"
export DEVECO_SDK_HOME="$DEVECO/sdk"
export JAVA_HOME="$DEVECO/jbr/Contents/Home"
HVIGORW="$DEVECO/tools/hvigor/bin/hvigorw"

echo "==> 工具链"
echo "    DevEco : $DEVECO"
echo "    node   : $("$NODE_HOME/bin/node" --version)"
echo "    hvigor : $("$HVIGORW" --version 2>/dev/null | tail -1)"

# ── 签名状态检测（不阻断——只是提示；判定逻辑见文件头注释）──
if [ "$PRODUCT" = "cssconf" ]; then
  # cssconf 产品的签名是**绑定 dev.proteus.cssconf 的另一份 profile**——单独提醒。
  if ! grep -q '"signingConfig": *"cssconf"' "$APP_DIR/build-profile.json5" 2>/dev/null; then
    echo
    echo "  ⚠ cssconf 产品暂无专属签名配置——将产出 **unsigned hap**（不能装机）。"
    echo "    ① 先跑一次本命令（产出 unsigned hap，让 DevEco 能读到 cssconf 产品）"
    echo "    ② DevEco Studio → File → Project Structure → Signing Configs"
    echo "       → 勾 Automatically generate signature（登录华为账号；DevEco 生成 bound 到"
    echo "         dev.proteus.cssconf 的 profile 并写入本地 build-profile.json5）"
    echo "       → 确认 cssconf 产品挂上该 signingConfig（命名为 cssconf）"
    echo "    ③ 再次运行本命令 ⇒ 产出 signed hap（可装机）"
    echo
  fi
elif grep -q '"signingConfigs": \[\]' "$APP_DIR/build-profile.json5" 2>/dev/null; then
  echo
  echo "  ⚠ 未配置签名（signingConfigs 为空）——将产出 **unsigned hap**（不能装机）。"
  echo "    装一次即可：DevEco Studio → File → Project Structure → Signing Configs"
  echo "    → 勾选 Automatically generate signature（需登录华为账号；本设备需注册 UDID）"
  echo "    ★只用 unsigned 验证构建链也行：产物在 entry/build/${PRODUCT}/outputs/default/"
  echo
fi

# ── Rust 核静态库自动重建（★★★2026-10-08 · 真机实测抓出）：改 `packages/layout-core-rust` 后只重打 hap
#   ⇒ 链的是**旧静态库** ⇒ 内核改动在鸿蒙端**静默不生效**（本轮 grid-template-areas：内容 JSON 带了字段，
#   而核是 14:27 旧版 ⇒ 命名区不生效、退化为自动放置）。判据：**核源码新于静态库 ⇒ 自动重建**
#   （whitelist/接线不靠记忆——同 check:host-kernel-keys 的纪律）。
CORE="$APP_DIR/proteus_render/src/main/cpp/thirdparty/libproteus_layout_core.a"
CORE_SRC="$ROOT/packages/layout-core-rust"
if [ ! -f "$CORE" ] || [ -n "$(find "$CORE_SRC/src" "$CORE_SRC/Cargo.toml" -newer "$CORE" 2>/dev/null | head -1)" ]; then
  echo "==> Rust 核静态库缺失或已过期——重建（build-rust-core.sh）"
  bash "$HERE/build-rust-core.sh" 2>&1 | tail -3 || { echo "✗ Rust 核重建失败——中止（否则链旧核、改动静默失效）"; exit 2; }
else
  echo "==> Rust 核静态库是最新（跳过重建）"
fi

# ── 夹具再生成（★唯一事实源 → rawfile，可复现：SFC/订阅表一变，构建即刷新）──
#   由 gen-fixtures.mjs 固化：stress-44（SFC 实例化）+ app-4050-tree（与 Android 同源复制）。
#   ★PROTEUS_APP_PROJECT 由本脚本（--css）或环境决定 ⇒ app-screen-content/bundle 随之切换。
echo "==> 夹具再生成（应用工程=${PROTEUS_APP_PROJECT:-superapp}）"
if command -v npx >/dev/null 2>&1; then
  (cd "$HERE" && npx tsx gen-fixtures.mjs) || { echo "✗ 夹具再生成失败——修正后再构建"; exit 2; }
else
  echo "  ⚠ 无 npx——跳过（rawfile 保持现状）"
fi

cd "$APP_DIR"
if [ "$CLEAN" = "1" ]; then
  echo "==> 清理（hvigor clean）"
  "$HVIGORW" clean --no-daemon >/dev/null 2>&1 || true
fi

echo "==> 构建（assembleHap · product=${PRODUCT}）"
# ★★构建失败必须中止（本仓实测：hvigor 失败经 `| grep | tail` 管道**吞掉退出码** ⇒ 脚本照打
#   "下一步"，让人误用**旧 hap** 验证——"验证了但验的是旧的"。取 PIPESTATUS[0]）。
HV_OUT="$("$HVIGORW" assembleHap --mode module -p product="$PRODUCT" --no-daemon 2>&1)"
HV_RC=$?
printf '%s\n' "$HV_OUT" | grep -vE "^\> hvigor .*Finished|UP-TO-DATE" | tail -15
if [ "$HV_RC" != "0" ]; then
  # ★变量必须用 ${} 包裹：紧跟全角 `）`（U+FF09）时 bash 会把它并入变量名 ⇒ unbound variable
  echo "✗ 构建失败（hvigor 退出码 ${HV_RC}）——修正后再构建（勿用旧 hap 验证）"
  exit 1
fi

OUT="$APP_DIR/entry/build/$PRODUCT/outputs/default"
echo
echo "==> 产物（${OUT}）"
ls -la "$OUT"/*.hap 2>/dev/null || { echo "  ✗ 无 hap 产出"; exit 1; }
if [ "$PRODUCT" = "cssconf" ]; then
  if ls "$OUT"/*-signed.hap >/dev/null 2>&1; then
    echo "  ✓ cssconf 已签名——装机：bash hosts/harmony/run-superapp.sh --css"
  else
    echo "  ⚠ cssconf 未签名（仅 unsigned hap）——按上方提示在 DevEco 生成 dev.proteus.cssconf 签名后再构建"
  fi
else
  echo
  echo "下一步（装机+启动验证）：bash hosts/harmony/run-host-app.sh"
fi

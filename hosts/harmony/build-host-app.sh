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
# 用法：
#   bash hosts/harmony/build-host-app.sh            # 构建（自动检测签名状态）
#   bash hosts/harmony/build-host-app.sh --clean    # 清理后重建
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$HERE/host-app"

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
if grep -q '"signingConfigs": \[\]' "$APP_DIR/build-profile.json5" 2>/dev/null; then
  echo
  echo "  ⚠ 未配置签名（signingConfigs 为空）——将产出 **unsigned hap**（不能装机）。"
  echo "    装一次即可：DevEco Studio → File → Project Structure → Signing Configs"
  echo "    → 勾选 Automatically generate signature（需登录华为账号；本设备需注册 UDID）"
  echo "    ★只用 unsigned 验证构建链也行：产物在 entry/build/default/outputs/default/"
  echo
fi

cd "$APP_DIR"
if [ "${1:-}" = "--clean" ]; then
  echo "==> 清理（hvigor clean）"
  "$HVIGORW" clean --no-daemon >/dev/null 2>&1 || true
fi

echo "==> 构建（assembleHap）"
"$HVIGORW" assembleHap --mode module -p product=default --no-daemon 2>&1 | grep -vE "^\> hvigor .*Finished|UP-TO-DATE" | tail -15

OUT="$APP_DIR/entry/build/default/outputs/default"
echo
echo "==> 产物"
ls -la "$OUT"/*.hap 2>/dev/null || { echo "  ✗ 无 hap 产出"; exit 1; }
echo
echo "下一步（装机+启动验证）：bash hosts/harmony/run-host-app.sh"

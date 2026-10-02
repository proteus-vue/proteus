#!/usr/bin/env bash
# hosts/harmony/hdc.sh —— 鸿蒙真机 HDC 接入包装（★工具链在 DevEco Studio 内，不在 PATH）
#
# 【为什么要包装（2026-10-02 实测踩坑全记录——每一条都花了时间）】
#   ① hdc 不在 PATH：DevEco Studio 6.1.1 自带 SDK 里
#      （Contents/sdk/default/openharmony/toolchains/hdc）。
#      ★旧 SDK 的 1.2.0a 与 HarmonyOS 7 设备**协议不兼容**（枚举为空），必须用 3.2.0d。
#   ② ★★★密钥必须是 **RSA-3072**：设备端按 `RSA_BIT_NUM=3072` 分配验签缓冲、声明
#      `rsa_3072_sha512` 方案；而 `hdc keygen` 生成的是 **4096 位** ⇒ 验签必然失败
#      （现象：设备上反复点「始终信任」都没用，永远 Unauthorized——实测确认）。
#      修法（本包装的 check 会校验）：
#        openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out ~/.harmony/hdckey
#        openssl pkey -in ~/.harmony/hdckey -pubout -out ~/.harmony/hdckey.pub
#   ③ 公钥必须落 **~/.harmony/hdckey.pub 且为 PEM 格式**（hdc 认证路径用 PEM_read_PUBKEY 读它；
#      keygen 旧格式是 base64 blob，会报 "read pubkey ... failed"）。
#   ④ 设备侧：开发者选项 → USB 调试打开 + 弹窗点「允许/始终允许」。
#      ★每换一次主机密钥，设备端授权作废、需重新点一次（排查期反复换密钥 = 反复失效）。
#
# 【用法】
#   bash hosts/harmony/hdc.sh check              # 诊断（工具链/版本/密钥位数/设备状态——只读）
#   bash hosts/harmony/hdc.sh list targets -v    # 透传任意 hdc 命令
#   bash hosts/harmony/hdc.sh shell "echo hi"
#
# 【已知设备（2026-10-02 实测）】HUAWEI KLE-AL00U · OpenHarmony 7.0.0 · **API 26** ·
#   1320x2856 @120Hz（RenderNode 直绘路径要求 API 20+ ⇒ 满足）
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# ── ① 解析 hdc（优先级：显式覆盖 > DevEco 自带 > PATH）──
find_hdc() {
  if [ -n "${PROTEUS_HDC:-}" ] && [ -x "${PROTEUS_HDC}" ]; then echo "$PROTEUS_HDC"; return 0; fi
  local candidates=(
    "/Volumes/data1/work/office-applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc"
    "$HOME/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc"
    "/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc"
  )
  local c
  for c in "${candidates[@]}"; do
    if [ -x "$c" ]; then echo "$c"; return 0; fi
  done
  if command -v hdc >/dev/null 2>&1; then command -v hdc; return 0; fi
  return 1
}

HDC="$(find_hdc)" || {
  echo "✗ 找不到 hdc（DevEco Studio 自带；或用 PROTEUS_HDC 显式指定路径）"
  echo "  候选：/Volumes/data1/work/office-applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc"
  exit 2
}

# ── ② check 子命令：只读诊断（不自动改任何状态）──
if [ "${1:-}" = "check" ]; then
  echo "== hdc 工具链 =="
  echo "  路径：$HDC"
  echo "  版本：$("$HDC" -v 2>&1 | head -1)"
  echo
  echo "== 主机密钥（~/.harmony/hdckey[.pub]）=="
  KEY="$HOME/.harmony/hdckey"
  if [ ! -f "$KEY" ]; then
    echo "  ✗ 缺密钥 —— 先按下方【生成】命令生成 3072 位密钥（★不要用 hdc keygen——那是 4096 位，验签必失败）"
  else
    BITS="$(openssl pkey -in "$KEY" -noout -text 2>/dev/null | head -1)"
    echo "  私钥：$BITS"
    case "$BITS" in
      *"3072 bit"*) echo "  ✓ 位数正确（设备端 rsa_3072_sha512）" ;;
      *"4096 bit"*) echo "  ✗ 位数错误：设备端要求 3072 位（4096 会验签失败——症状=设备反复授权也 Unauthorized）" ;;
      *) echo "  ? 位数未知——请确认是否为 3072 位" ;;
    esac
    if [ -f "$KEY.pub" ]; then
      head -1 "$KEY.pub" | grep -q "BEGIN PUBLIC KEY" \
        && echo "  ✓ 公钥为 PEM 格式（hdckey.pub）" \
        || echo "  ✗ 公钥非 PEM（keygen 旧格式）——用 openssl pkey -pubout 重新导出"
    else
      echo "  ✗ 缺公钥 ~/.harmony/hdckey.pub"
    fi
  fi
  echo
  echo "== 设备 =="
  "$HDC" list targets -v 2>&1 | head -5
  echo
  cat <<'EOS'
【生成正确密钥（3072 位 + PEM 公钥）】
  mkdir -p ~/.harmony
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out ~/.harmony/hdckey
  openssl pkey -in ~/.harmony/hdckey -pubout -out ~/.harmony/hdckey.pub
  chmod 600 ~/.harmony/hdckey ~/.harmony/hdckey.pub
  # 然后重启 hdc 服务并触发握手；设备上点「始终允许」（换密钥后必须重点一次）
EOS
  exit 0
fi

# ── ③ 透传（无参数 = 打印用法）──
if [ $# -eq 0 ]; then
  echo "用法：bash hosts/harmony/hdc.sh <hdc 参数...>（如：list targets -v / shell \"echo hi\"）"
  echo "      bash hosts/harmony/hdc.sh check   # 诊断"
  exit 0
fi
exec "$HDC" "$@"

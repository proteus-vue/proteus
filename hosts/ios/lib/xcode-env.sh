#!/usr/bin/env bash
# hosts/ios/lib/xcode-env.sh —— 解析可用的 **Xcode 工具链**（DEVELOPER_DIR）
#
# 【为什么需要（本机实测踩坑）】`xcode-select -p` 指向 `/Library/Developer/CommandLineTools`，
#   而 `devicectl` / `xcodebuild -downloadPlatform` 等**只在完整 Xcode 里**——
#   不设 `DEVELOPER_DIR` 时，所有 iOS 脚本会直接报 `unable to find utility "devicectl"`。
#   本仓的 Xcode 还装在**非默认位置**（`/Volumes/data1/work/office-applications/Xcode.app`），
#   故不能靠 `xcode-select` 或硬编码单一路径。
#
# 【★★2026-09-29 修一处"版本假设"（本仓自己的判据漂移）】原实现要求 `usr/bin/devicectl`——
#   而 **devicectl 是 Xcode 15+ 才有的工具** ⇒ 在 Xcode 14.x 上会把**完好可用的 Xcode**
#   判成"不可用"并 exit 3（实测：本机 Xcode 14.2 在 /Volumes/data1/applications/，
#   解析器直接判失败，导致我以为"本机没有可用 Xcode"，白绕了一圈）。
#   ⇒ 判据改为「**该 Xcode 能提供 iOS SDK**」（这才是脚本真正需要的能力，与版本无关）：
#     `xcrun --sdk iphoneos --show-sdk-path` 有输出即可用。
#   ★纪律：**判据要对着"我们需要的能力"，不是对着"我记得的工具名"**——
#     工具名会随版本增删，能力不会。
#
# 【★★2026-09-29 再次修正：只判 SDK 仍然不够（本机实测第二个教训）】
#   本机装了**两个** Xcode：
#     · /Volumes/data1/applications/Xcode.app        = 14.2（**无 devicectl** ⇒ 装不了真机）
#     · /Volumes/data1/work/office-applications/Xcode.app = 26.5（**有 devicectl**）
#   `mdfind` 返回顺序让解析器先命中 14.2 ⇒ "能给 SDK"成立 ⇒ 选中它 ⇒
#   **后续真机部署全部不可用**（`devicectl device install` 不存在），
#   现象是"看着有 Xcode 但装不了机"，我一度误判成"本机无法做 iOS 真机验证"。
#   ⇒ 判据改为**两级偏好**：
#     ① 优先"既能给 iOS SDK、又有 devicectl"（真机能力完备）
#     ② 退而求其次："只要能给 iOS SDK"（模拟器/类型检查够用）
#   ★纪律：**多候选环境下要按"能力完备度"排序，不是按枚举顺序**——
#     枚举顺序是环境偶然，能力才是需求。
#   ① `PROTEUS_DEVELOPER_DIR`（显式覆盖，换机/换位时用）
#   ② 已导出的 `DEVELOPER_DIR`
#   ③ `xcode-select -p`（若指向完整 Xcode）
#   ④ Spotlight（mdfind）找到的 Xcode（本机在 /Volumes 上也能找到）
#   ⑤ 常见安装位兜底
#
# 用法（在脚本中）：`source "$(dirname "${BASH_SOURCE[0]}")/lib/xcode-env.sh"` 或按相对路径 source
#   —— 它会 `export DEVELOPER_DIR`，之后 `xcrun devicectl …` 即可用。

proteus_resolve_xcode() {
  # ★能力判据（与版本无关）：该 Developer 目录能否给出 iOS SDK
  _proteus_has_ios_sdk() {
    [ -n "$1" ] && [ -d "$1" ] || return 1
    DEVELOPER_DIR="$1" xcrun --sdk iphoneos --show-sdk-path >/dev/null 2>&1
  }

  # ★★两级偏好（见文件头两条教训）：
  #   ① 优先"真机能力完备"（iOS SDK + devicectl）——真机部署必须它
  #   ② 再退"只要给 iOS SDK"——模拟器 / 类型检查够用
  #   ★显式指定的 PROTEUS_DEVELOPER_DIR 仍**最高优先**（用户表态优先于自动挑选）
  _has_devicectl() { [ -n "$1" ] && [ -x "$1/usr/bin/devicectl" ]; }

  if [ -n "${PROTEUS_DEVELOPER_DIR:-}" ] && _proteus_has_ios_sdk "$PROTEUS_DEVELOPER_DIR"; then
    export DEVELOPER_DIR="$PROTEUS_DEVELOPER_DIR"; return 0
  fi

  # 收集候选（去重；含 mdfind 找到的非默认安装位）
  local -a cands=()
  local c
  for c in "${DEVELOPER_DIR:-}" "$(xcode-select -p 2>/dev/null || true)"; do
    [ -n "$c" ] && cands+=("$c")
  done
  local app
  while IFS= read -r app; do
    [ -n "$app" ] && cands+=("$app/Contents/Developer")
  done < <(mdfind "kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'" 2>/dev/null || true)
  cands+=("/Applications/Xcode.app/Contents/Developer" "$HOME/Applications/Xcode.app/Contents/Developer")

  # ① 真机能力完备
  for c in "${cands[@]}"; do
    if _proteus_has_ios_sdk "$c" && _has_devicectl "$c"; then
      export DEVELOPER_DIR="$c"; return 0
    fi
  done
  # ② 至少能给 iOS SDK
  for c in "${cands[@]}"; do
    if _proteus_has_ios_sdk "$c"; then
      export DEVELOPER_DIR="$c"; return 0
    fi
  done

  return 1
}

if ! proteus_resolve_xcode; then
  echo "✗ 未找到可用的 Xcode（判据：能提供 iOS SDK）" >&2
  echo "  当前 xcode-select：$(xcode-select -p 2>/dev/null || echo 未设置)" >&2
  echo "  若 Xcode 在非默认位置，请显式指定：" >&2
  echo "    PROTEUS_DEVELOPER_DIR=/path/to/Xcode.app/Contents/Developer bash <本脚本>" >&2
  exit 3
fi

#!/usr/bin/env bash
# hosts/ios/lib/xcode-env.sh —— 解析可用的 **Xcode 工具链**（DEVELOPER_DIR）
#
# 【为什么需要（本机实测踩坑）】`xcode-select -p` 指向 `/Library/Developer/CommandLineTools`，
#   而 `devicectl` / `xcodebuild -downloadPlatform` 等**只在完整 Xcode 里**——
#   不设 `DEVELOPER_DIR` 时，所有 iOS 脚本会直接报 `unable to find utility "devicectl"`。
#   本仓的 Xcode 还装在**非默认位置**（`/Volumes/data1/work/office-applications/Xcode.app`），
#   故不能靠 `xcode-select` 或硬编码单一路径。
#
# 【优先级】（先到先得，全部要求 `usr/bin/devicectl` 存在——它能筛掉旧版/残缺 Xcode）
#   ① `PROTEUS_DEVELOPER_DIR`（显式覆盖，换机/换位时用）
#   ② 已导出的 `DEVELOPER_DIR`
#   ③ `xcode-select -p`（若指向完整 Xcode）
#   ④ Spotlight（mdfind）找到的 Xcode（本机在 /Volumes 上也能找到）
#   ⑤ 常见安装位兜底
#
# 用法（在脚本中）：`source "$(dirname "${BASH_SOURCE[0]}")/lib/xcode-env.sh"` 或按相对路径 source
#   —— 它会 `export DEVELOPER_DIR`，之后 `xcrun devicectl …` 即可用。

proteus_resolve_xcode() {
  # 快速路径：环境已给出可用的
  for c in "${PROTEUS_DEVELOPER_DIR:-}" "${DEVELOPER_DIR:-}"; do
    if [ -n "$c" ] && [ -x "$c/usr/bin/devicectl" ]; then
      export DEVELOPER_DIR="$c"; return 0
    fi
  done

  # xcode-select 指向的完整 Xcode
  local sel
  sel="$(xcode-select -p 2>/dev/null || true)"
  if [ -n "$sel" ] && [ -x "$sel/usr/bin/devicectl" ]; then
    export DEVELOPER_DIR="$sel"; return 0
  fi

  # Spotlight 扫描（不依赖固定安装路径；本机实测能找到 /Volumes 下的 Xcode）
  local app
  while IFS= read -r app; do
    [ -n "$app" ] || continue
    if [ -x "$app/Contents/Developer/usr/bin/devicectl" ]; then
      export DEVELOPER_DIR="$app/Contents/Developer"; return 0
    fi
  done < <(mdfind "kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'" 2>/dev/null || true)

  # 常见安装位兜底
  for app in /Applications/Xcode.app "$HOME/Applications/Xcode.app"; do
    if [ -x "$app/Contents/Developer/usr/bin/devicectl" ]; then
      export DEVELOPER_DIR="$app/Contents/Developer"; return 0
    fi
  done

  return 1
}

if ! proteus_resolve_xcode; then
  echo "✗ 未找到可用的 Xcode（需含 usr/bin/devicectl）" >&2
  echo "  当前 xcode-select：$(xcode-select -p 2>/dev/null || echo 未设置)" >&2
  echo "  若 Xcode 在非默认位置，请显式指定：" >&2
  echo "    PROTEUS_DEVELOPER_DIR=/path/to/Xcode.app/Contents/Developer bash <本脚本>" >&2
  exit 3
fi

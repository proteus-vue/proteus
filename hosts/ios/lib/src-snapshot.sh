#!/usr/bin/env bash
# hosts/ios/lib/src-snapshot.sh —— ★★★源码快照守卫（#1118）
#
# 【它解决什么】构建进行中若有人改源文件，swiftc 会报
#   `input file '...' was modified during the build` —— 信息晦涩，容易被当成构建系统问题；
#   更糟的是**真机可能跑到半新半旧的二进制**（部分 TU 编的是旧内容）。
#
# 【本仓真实教训（两次，同一天）】
#   AI 在真机构建跑着的时候做"破坏性验证"（改源文件 → 跑测试 → 还原）——
#   第一次报 `input file was modified during the build`，第二次又踩了一次，各白跑一轮。
#   ⇒ 把"重新跑"这件事变成**机器给结论**，而不是靠人记得。
#
# 【用法】
#   source hosts/ios/lib/src-snapshot.sh
#   snap_before "$HERE/ProteusHost"        # 编译前
#   ... 编译 ...
#   snap_check "$HERE/ProteusHost" || exit 3   # 编译后：不一致即返回 1（已打印原因）
#
# 【为什么放在 lib/ 而不是内联】run-selfdraw.sh 已 1004 行（`check:file-size` 上限 1000）——
#   守卫是**独立职责**且 Android 构建将来也要用，内联会让脚本越线并重复实现。

_PROTEUS_SRC_SNAP=""

# 取一棵源码树的指纹（按相对路径排序后整体 sha256 ⇒ 与遍历顺序无关）
_snap_hash() {
  ( cd "$1" && find . -name '*.swift' -o -name '*.java' -o -name '*.h' -o -name '*.cpp' 2>/dev/null \
      | sort | xargs shasum -a 256 2>/dev/null | shasum -a 256 | awk '{print $1}' )
}

snap_before() {
  _PROTEUS_SRC_SNAP="$(_snap_hash "$1")"
  export _PROTEUS_SRC_SNAP
}

snap_check() {
  local after; after="$(_snap_hash "$1")"
  if [ "$after" != "$_PROTEUS_SRC_SNAP" ]; then
    echo "✗ 构建期间源码被改动（有人在编译进行中改文件）"
    echo "  ★这会让编译器报 'input file was modified during the build'，且产物可能是半新半旧的"
    echo "  ★纪律：破坏性验证 / 改源文件 **不能与真机构建并发**（本仓已踩过两次）"
    echo "  请重跑本脚本。"
    return 1
  fi
  return 0
}

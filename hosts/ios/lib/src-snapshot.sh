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
_PROTEUS_SRC_MTIMES=""

# 取一棵源码树的指纹（按相对路径排序后整体 sha256 ⇒ 与遍历顺序无关）
_snap_hash() {
  ( cd "$1" && find . -name '*.swift' -o -name '*.java' -o -name '*.h' -o -name '*.cpp' 2>/dev/null \
      | sort | xargs shasum -a 256 2>/dev/null | shasum -a 256 | awk '{print $1}' )
}

# 取 mtime 清单（`<epoch> <相对路径>`，按路径排序）。
# ★★为什么内容 hash 之外还要这一份（2026-10-22 实测）：swiftc 判"input file was modified during
#   the build"看的是 **mtime/size**，不是内容。并发会话把同一份内容重写一遍（或 `touch`）时
#   内容 hash **不变** ⇒ 原守卫一声不吭，而 swiftc 照样报错 ⇒ 用户只看到晦涩的编译器错误，
#   根因（并发 touch）完全不可见。有了这份清单就能明确说"内容没变、只是被碰了"。
_snap_mtimes() {
  ( cd "$1" && find . -name '*.swift' -o -name '*.java' -o -name '*.h' -o -name '*.cpp' 2>/dev/null \
      | sort | while IFS= read -r f; do printf '%s %s\n' "$(stat -f '%m' "$f" 2>/dev/null)" "$f"; done )
}

snap_before() {
  _PROTEUS_SRC_SNAP="$(_snap_hash "$1")"
  _PROTEUS_SRC_MTIMES="$(_snap_mtimes "$1")"
  export _PROTEUS_SRC_SNAP _PROTEUS_SRC_MTIMES
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
  # ★内容一致但 mtime 变了：**不阻断**（编译输入相同 ⇒ 产物必然相同），但要明确归因，
  #   否则下次还是只能看到 swiftc 那句晦涩的 "input file was modified during the build"。
  local after_mtimes
  after_mtimes="$(_snap_mtimes "$1")"
  if [ -n "$_PROTEUS_SRC_MTIMES" ] && [ "$after_mtimes" != "$_PROTEUS_SRC_MTIMES" ]; then
    echo "⚠ 构建期间有源码被「碰过」但**内容没变**（并发会话 touch / 重写同内容）——产物仍然可信"
    diff <(printf '%s\n' "$_PROTEUS_SRC_MTIMES") <(printf '%s\n' "$after_mtimes") 2>/dev/null \
      | awk '/^[<>]/{sub(/^[<>] [0-9]+ /,""); print "    " $0}' | sort -u
    echo "  ★若编译器恰好报了 'input file was modified during the build'，根因就是上面这些文件"
    echo "    （swiftc 判 mtime/size，不判内容）⇒ 重跑即可，不用怀疑代码。"
  fi
  return 0
}

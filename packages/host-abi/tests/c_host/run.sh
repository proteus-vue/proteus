#!/usr/bin/env bash
# packages/host-abi/tests/c_host/run.sh —— ★★Host ABI 一致性测试（**真编译 + 真链接 + 真跑**）
#
# 【为什么必须有它（本仓纪律：判据要落在结果上）】Rust 侧单测证明的是"Rust 调用者视角"；
#   而 Host ABI 的**消费者是别的语言**（Swift / Kotlin / 鸿蒙 ArkTS / 甚至纯 C）。
#   ⇒ 只测 Rust 侧会漏掉两类真实缺陷：
#     ① **头文件与实现漂移**（改 Rust 结构体字段而没改 .h ⇒ Swift 侧编译过、运行错位）
#     ② **C ABI 层面的问题**（`repr(C)` 布局、符号导出名、调用约定）
#   本脚本用**纯 C 写一个全新宿主**（headless_host.c），编译它、链接 host-abi 静态库、运行它——
#   这正是"换宿主零改内核"的可执行证明（也顺带是客户接入文档的可运行版本）。
#
# 【诚实边界】链接的是**本机构建**的库（非 iOS/Android 交叉编译产物）；
#   跨平台链接（Xcode / NDK / 鸿蒙工具链）属各端载体的事，本脚本不代劳。
#
# 用法：bash packages/host-abi/tests/c_host/run.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ABI_DIR="$(cd "$HERE/../.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

CC="${CC:-cc}"
command -v "$CC" >/dev/null 2>&1 || { echo "✗ 找不到 C 编译器（$CC）"; exit 2; }

echo "==> ① 构建 host-abi（release：静态库 + rlib）"
(cd "$ABI_DIR" && cargo build --release 2>&1 | grep -E "^(error|warning: unused)" -A 4 || true)
LIB="$(find "$ABI_DIR/target/release" -maxdepth 1 -name 'libproteus_host_abi.a' | head -1)"
[ -f "$LIB" ] || { echo "✗ 未产出静态库：$LIB"; exit 2; }
echo "    静态库：$(basename "$LIB")（$(du -h "$LIB" | cut -f1)）"

echo "==> ② 纯 C 宿主编译（-Wall -Werror：头文件与实现对不上就红）"
"$CC" -std=c11 -Wall -Werror -O1 \
    -I "$ABI_DIR/include" \
    -o "$OUT/headless_host" "$HERE/headless_host.c" "$LIB" \
    2>&1 | head -20
[ -x "$OUT/headless_host" ] || { echo "✗ C 宿主未编译成功"; exit 3; }
echo "    ✓ 编译 + 链接通过（宿主只依赖头文件与静态库）"

echo "==> ③ 运行（零平台依赖）"
"$OUT/headless_host"
rc=$?
if [ $rc -eq 0 ]; then
  echo
  echo "✅ Host ABI 一致性测试通过（C 宿主可编译、可链接、可驱动内核）"
else
  echo
  # ★`${rc}` 必须带花括号：后面紧跟全角括号，bash 3.2 在非 UTF-8 locale 下会把全角字符
  #   的首字节吞进变量名（现象：`rc）: unbound variable`）——本仓已记录的陷阱
  echo "✗ Host ABI 一致性测试失败（退出码 ${rc}）"
fi
exit $rc

#!/usr/bin/env bash
# hosts/android/check-16kb-align.sh —— ★16 KB page size 对齐门禁（Android 15+）
#
# 【背景（用户真机实测反馈）】「真机总是提示我们的 so 库都没做 16 KB 对齐」。
#   实测确认（本仓，2026-09-29）：两个 .so 的所有 LOAD 段 `Align` 都是 **0x1000（4 KB）**，
#   而 **Android 15+ 在 16 KB page size 设备上要求 ELF LOAD 段按 0x4000（16 KB）对齐**
#   —— 动态链接器按 `p_align` 做 mmap 的页对齐，段对齐不足时 **mmap 失败 ⇒ .so 加载不了**。
#
# 【本门禁查什么（两组判据，都是"能变红"的机器判据）】
#   ① **ELF 段对齐**：`llvm-readelf -l` 的每个 LOAD 段 Align 必须为 `0x4000`
#      —— 查对象：`hosts/android/build/` 下全部 `.so`（Rust 核心 + QuickJS + JNI 桥）
#   ② **APK 存储对齐**：APK 内**未压缩**的 `.so` 必须落在 **16 KB 边界**
#      （`zipalign -c -P 16`；若无支持 `-P` 的 build-tools，退化为手工查）
#   ★为什么两类都要：① 是"段能否 mmap"（运行时），② 是"打包是否按 16 KB 存放"（安装时优化）。
#     只做①不做②在某些 loader 上仍会被提示；只做②不做①则 mmap 直接失败。
#
# 【修复指引（判据失败时打印）】
#   · Rust 侧：`packages/layout-core-rust/.cargo/config.toml` 的
#     `[target.aarch64-linux-android] rustflags = ["-C","link-arg=-Wl,-z,max-page-size=16384"]`
#   · QuickJS 侧：`scripts/setup-android-js-engine.sh` 的 `ALIGN_FLAG`
#
# 用法：bash hosts/android/check-16kb-align.sh
# 退出码：0 通过 / 1 判据失败 / 2 环境缺失（工具或产物）
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
NDK="$ROOT/.tools/ndk/toolchains/llvm/prebuilt/darwin-x86_64/bin"
READELF="$NDK/llvm-readelf"
APK="$HERE/build/proteus-layoutcore.apk"

[ -x "$READELF" ] || { echo "✗ 缺 llvm-readelf（${READELF}）"; exit 2; }

fails=0

echo "==> ① ELF LOAD 段对齐（要求每个段 Align = 0x4000）"
shopt -s nullglob
# ★★覆盖面必须跟着"产物落点"走（用户指出「安卓三个 so 库没做 16kb 门禁校验」）：
#   初版只扫 build/lib + build/js-engine ⇒ **漏了 build/wasm/**（wasm3 运行时）⇒ 门禁假绿。
#   ⚠ 别写死目录列表：**新 .so 落点**要一起加（本仓纪律：门禁覆盖面跟形态走）。
sos=("$HERE"/build/lib/arm64-v8a/*.so "$HERE"/build/js-engine/*.so "$HERE"/build/wasm/*.so)
if [ ${#sos[@]} -eq 0 ]; then
  echo "  ✗ 未找到任何 .so 产物 —— 先构建："
  echo "    · Rust 核心：bash hosts/android/build-and-run.sh --no-install"
  echo "    · JS 引擎：  bash scripts/setup-android-js-engine.sh"
  exit 2
fi
# ★去重（同一 .so 可能同时出现在"构建源"与"打包拷贝"两个落点——内容相同）
#   ★★**不能用 `declare -A`**：macOS 自带 bash 3.2 不支持关联数组（本仓已踩过：
#      acceptance-stub.mjs 有静态扫描专防它）。用**换行分隔的字符串**当集合（3.2 兼容）。
_seen=""
_uniq=()
for so in "${sos[@]}"; do
  [ -f "$so" ] || continue
  h="$(shasum -a 256 "$so" 2>/dev/null | awk '{print $1}')"
  case "$_seen" in
    *" $h "*) continue ;;
  esac
  _seen="${_seen} ${h} "
  _uniq+=("$so")
done
sos=("${_uniq[@]}")

for so in "${sos[@]}"; do
  [ -f "$so" ] || continue
  name="$(basename "$so")"
  # 取 LOAD 段最后一列（Align）
  aligns="$("$READELF" -l "$so" 2>/dev/null | awk '/^  LOAD/ { print $NF }')"
  bad="$(printf '%s\n' "$aligns" | grep -v '^0x4000$' | head -2)"
  n="$(printf '%s\n' "$aligns" | grep -c .)"
  if [ -n "$bad" ]; then
    echo "  ✗ ${name}：${n} 个 LOAD 段中有非 0x4000 的：$(printf '%s' "$bad" | tr '\n' ' ')"
    fails=$((fails + 1))
  else
    echo "  ✅ ${name}：${n} 个 LOAD 段全为 0x4000"
  fi
done

echo "==> ② APK 内 .so 的 16 KB 存储对齐"
if [ ! -f "$APK" ]; then
  echo "  ⚠ 未见 APK（${APK}）——跳过（构建后本门禁会查到）"
else
  # ★判据逻辑落独立 py（shell heredoc 嵌套与 set -u/引号交互极易出错——本仓刚实测 parse error）
  if python3 "$HERE/check-apk-align16.py" "$APK"; then
    echo "  ✅ APK 存储对齐通过（Stored + 16 KB 数据起始偏移）"
  else
    echo "  ✗ APK 未通过 16 KB 存储对齐 —— 打包步骤需 zipalign（本仓等价实现：hosts/android/zipalign16.py）"
    fails=$((fails + 1))
  fi
fi

echo ""
if [ "$fails" -gt 0 ]; then
  echo "✗ 16 KB 对齐门禁失败（$fails 项） —— Android 15+ 的 16 KB page size 设备上会加载失败"
  echo "  修复："
  echo "   · Rust 侧：packages/layout-core-rust/.cargo/config.toml（rustflags 含 max-page-size=16384）"
  echo "   · QuickJS 侧：scripts/setup-android-js-engine.sh 的 ALIGN_FLAG（重跑该脚本）"
  echo "   · APK 侧：hosts/android/build-and-run.sh 的打包步骤（zipalign -P 16 / -P 16 需 build-tools 35+）"
  exit 1
fi
echo "✅ 16 KB 对齐门禁通过（ELF 段 + APK 存储）"

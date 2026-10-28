#!/usr/bin/env bash
# scripts/check-harmony-host-compile.sh —— ★★★零设备编译检查：鸿蒙宿主 C++（tear 住"改宿主代码先过编译"纪律）
#
# 【为什么需要】Android 有 `check:android-host-compile`（javac + android.jar）、iOS 有
#   `check:ios-selfdraw-compile`（swiftc -typecheck）——**鸿蒙此前没有**：改 `proteus_host.cpp` /
#   `proteus_render.cpp` 只能等 DevEco `assembleHap`（重）或真机才发现语法错。
#   本脚本用 **DevEco 自带的 OHOS clang** 对两个 .cpp 做 `-fsyntax-only`（零设备、秒级）。
#
# 【诚实边界】只做**语法/类型**检查（`-fsyntax-only`），不链接、不产 so ⇒ 抓得到 C++ 语法/头文件/
#   API 签名类错误，抓不到链接期/运行期问题（那些仍需 `assembleHap` + 真机）。这与 android/ios 的
#   零设备检查同口径（javac / swiftc -typecheck 也不链接）。
#
# 【DevEco 定位】与 hosts/harmony/build-host-app.sh / hdc.sh 同策略：显式覆盖 > 常见安装位。
#   找不到 ⇒ **跳过并退出 0**（CI 上无 DevEco 属正常；本地有则真检查）。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CPP_DIR="$ROOT/hosts/harmony/host-app/proteus_render/src/main/cpp"

find_deveco() {
  if [ -n "${PROTEUS_DEVECO:-}" ] && [ -d "${PROTEUS_DEVECO}" ]; then echo "$PROTEUS_DEVECO"; return 0; fi
  for c in \
    "/Volumes/data1/work/office-applications/DevEco-Studio.app/Contents" \
    "$HOME/Applications/DevEco-Studio.app/Contents" \
    "/Applications/DevEco-Studio.app/Contents"; do
    [ -d "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}

DEVECO="$(find_deveco)" || { echo "ℹ 未找到 DevEco Studio（无 OHOS 工具链）——跳过鸿蒙 C++ 编译检查（CI 正常）"; exit 0; }
SDK="$DEVECO/sdk/default/openharmony/native"
CLANG="$SDK/llvm/bin/clang"
SYSROOT="$SDK/sysroot"

# ★★★#1117（这道门禁自己的洞口）：此前只挂 OpenHarmony sysroot ⇒
#   `__has_include(<RemoteCommunicationKit/rcp.h>)` **恒为 false** ⇒ `proteus_http.h` 的 RCP 分支
#   **从来没被编译过**（改了也全绿——"门禁看着在，实际只覆盖了 unsupported 分支"）。
#   HMS 头在 `sdk/default/hms/native/sysroot/usr/include`（不在 OpenHarmony sysroot 里）⇒ 显式挂上。
#   找不到 ⇒ 仍可编（RCP 分支被裁掉），但**必须打印知道**，不静默当"已覆盖"。
HMS_INC=""
if [ -n "${PROTEUS_HMS_SDK:-}" ] && [ -f "${PROTEUS_HMS_SDK}/native/sysroot/usr/include/RemoteCommunicationKit/rcp.h" ]; then
  HMS_INC="${PROTEUS_HMS_SDK}/native/sysroot/usr/include"
else
  for c in "${DEVECO}/sdk/default/hms" "$HOME/Applications/DevEco-Studio.app/Contents/sdk/default/hms" \
           "/Applications/DevEco-Studio.app/Contents/sdk/default/hms"; do
    if [ -f "${c}/native/sysroot/usr/include/RemoteCommunicationKit/rcp.h" ]; then HMS_INC="${c}/native/sysroot/usr/include"; break; fi
  done
fi
HMS_FLAGS=()
if [ -n "$HMS_INC" ]; then
  HMS_FLAGS=(-I"$HMS_INC")
  echo "    HMS RCP 头：${HMS_INC}（RCP 分支会被真正编译）"
else
  echo "  ⚠ 未找到 HMS RCP 头 ⇒ 本次只编译 unsupported 分支（proteus_http.h 的 RCP 代码**未被检查**）"
fi
[ -x "$CLANG" ] || { echo "ℹ 缺 OHOS clang（${CLANG}）——跳过"; exit 0; }
ARCH_INC="$(ls "$SYSROOT/usr/include" 2>/dev/null | grep -iE 'aarch64|aarch' | head -1)"
[ -n "$ARCH_INC" ] || ARCH_INC="aarch64-linux-ohos"

echo "==> 编译检查鸿蒙宿主 C++（OHOS clang -fsyntax-only，零设备）"
fail=0
# ★T-app-fetch（2026-10-18）：`invoke_wire.h` 只有被某个 TU include 才会被编译到。
#   `proteus_host.cpp` 已 include 它（能力通道 http.request 用）⇒ 上面的循环天然覆盖；
#   这里再单独编一个**最小 TU**，保证"头文件自身可独立编译"（它声明零依赖，应成立）。
if printf '#include "invoke_wire.h"\nint main(){return 0;}\n' > /tmp/proteus_iw_probe.cpp \
   && "$CLANG" --target=aarch64-linux-ohos --sysroot="$SYSROOT" -fsyntax-only -std=c++17 \
      -I"$SYSROOT/usr/include" -I"$SYSROOT/usr/include/$ARCH_INC" -I"$CPP_DIR" "${HMS_FLAGS[@]+"${HMS_FLAGS[@]}"}" \
      /tmp/proteus_iw_probe.cpp 2>/tmp/harmony_cc_invoke_wire.log; then
  echo "  ✅ invoke_wire.h（独立 TU）"
else
  echo "  ✗ invoke_wire.h（独立 TU）"
  grep -E "error:" /tmp/harmony_cc_invoke_wire.log | head -10
  fail=1
fi
# ★★★#1117 第二遍：**不带 HMS 头**再编一次（这是 CI / 外部用户的真实形态）。
#   【为什么必须两遍（本仓刚踩过）】只看"带 HMS 全绿"会把"RCP 类型漏出条件编译块"这类错误放过去——
#   带 HMS 时那些类型有定义、编得过；不带时整份编不过（`unknown type name 'Rcp_Session'`）。
#   ⇒ `#if PROTEUS_HAVE_RCP` 的两条分支**都是发布形态**，两条都必须编。
for f in proteus_host.cpp proteus_render.cpp glass_vk.cpp; do
  if "$CLANG" --target=aarch64-linux-ohos --sysroot="$SYSROOT" -fsyntax-only -std=c++17 \
      -I"$SYSROOT/usr/include" -I"$SYSROOT/usr/include/$ARCH_INC" -I"$CPP_DIR" \
      "$CPP_DIR/$f" 2>/tmp/harmony_cc_nohms_$f.log; then
    echo "  ✅ ${f}（无 HMS · unsupported 分支）"
  else
    echo "  ✗ ${f}（无 HMS · unsupported 分支）"
    grep -E "error:" /tmp/harmony_cc_nohms_$f.log | head -10
    fail=1
  fi
done
for f in proteus_host.cpp proteus_render.cpp glass_vk.cpp; do
  if "$CLANG" --target=aarch64-linux-ohos --sysroot="$SYSROOT" -fsyntax-only -std=c++17 \
      -I"$SYSROOT/usr/include" -I"$SYSROOT/usr/include/$ARCH_INC" -I"$CPP_DIR" "${HMS_FLAGS[@]+"${HMS_FLAGS[@]}"}" \
      "$CPP_DIR/$f" 2>/tmp/harmony_cc_$f.log; then
    echo "  ✅ $f"
  else
    echo "  ✗ $f"
    grep -E "error:" /tmp/harmony_cc_$f.log | head -10
    fail=1
  fi
done

# ══════════════════ ★★★#1344 B-2c：**条件编译宏的"可见性顺序"检查** ══════════════════
# 【为什么必须有这一条（`-fsyntax-only` 结构上看不见的真缺陷）】
#   真机症状：`abort()` 后 JS 侧四项全对，宿主 `cancelStats.calls=0` / `unsupported=1`。
#   根因：`proteus_http_rcpapi.h` 里的 `#if PROTEUS_HAVE_RCP` —— 而该宏由
#   `proteus_http.h` 在本头 **include 之后**才定义 ⇒ 预处理时它还是"未定义"
#   （C 规则：`#if` 里未定义标识符 = 0）⇒ `cancelRcpRequestRaw` 整个函数体被编成
#   `return false`，而 HTTP 请求路径（定义**之后**的 `#if`）完全正常。
#   ★两个分支都能编译 ⇒ `-fsyntax-only` 与单测全绿，只有跑到那条分支才暴露。
# 【判据】预处理展开后，**带 HMS 头**时 `cancelRcpRequestRaw` 的函数体必须真的在代码里
#   （`grep` 到 `loadRcpApi(lib)`）；且各子头**不得引用**由包含者定义的宏
#   （头文件必须自给自足 —— 否则 include 顺序变成隐式契约）。
check_macro_visibility() {
  local probe=/tmp/proteus_rcp_macro_probe.cpp
  # ① 每个子头的宏自给自足：不得出现外部 `PROTEUS_HAVE_RCP`（应各自探测或用自己的 HAVE_H）
  local bad=0 h
  for h in proteus_http_rcpapi.h proteus_http_response.h proteus_http_upload.h \
           proteus_http_guard.h proteus_http_save.h proteus_http_transport.h \
           proteus_http_doh.h proteus_http_diag.h; do
    [ -f "$CPP_DIR/$h" ] || continue
    # 只看**代码**里的 #if/#ifdef（注释行不算；本仓注释会提到该宏做解释）
    if grep -nE '^[[:space:]]*#[[:space:]]*(if|ifdef|ifndef|elif)[[:space:]]+.*PROTEUS_HAVE_RCP' "$CPP_DIR/$h" \
        | grep -v 'PROTEUS_RCPAPI_HAVE_H' | grep -q .; then
      echo "  ✗ ${h}：引用了由包含者定义的 PROTEUS_HAVE_RCP（include 顺序成了隐式契约）"
      grep -nE '^[[:space:]]*#[[:space:]]*(if|ifdef|ifndef|elif)[[:space:]]+.*PROTEUS_HAVE_RCP' "$CPP_DIR/$h" | sed 's/^/      /'
      bad=1
    fi
  done
  # ② 带 HMS 头预处理后，cancel 的实现体必须真的在（不是被编成 return false）
  if [ -n "$HMS_INC" ]; then
    printf '#include "proteus_http_rcpapi.h"\n' > "$probe"
    if "$CLANG" --target=aarch64-linux-ohos --sysroot="$SYSROOT" -E -std=c++17 -P \
        -I"$SYSROOT/usr/include" -I"$SYSROOT/usr/include/$ARCH_INC" -I"$CPP_DIR" "${HMS_FLAGS[@]+"${HMS_FLAGS[@]}"}" \
        "$probe" 2>/dev/null | grep -q 'loadRcpApi(lib)'; then
      echo "  ✅ RCP 取消分支在带 HMS 头时**真的被编进来了**（不是空壳 return false）"
    else
      echo "  ✗ RCP 取消分支被条件编译吃掉了（预处理后看不到 loadRcpApi(lib)）——宏可见性问题"
      bad=1
    fi
  fi
  [ "$bad" = 0 ] && echo "  ✅ 条件编译宏自给自足（无 include 顺序隐式契约）" || fail=1
}
check_macro_visibility

[ "$fail" = 0 ] && { echo "✅ 鸿蒙宿主 C++ 编译检查通过（改动 proteus_host.cpp/proteus_render.cpp 后先跑本脚本，再上真机）"; exit 0; }
echo "✗ 鸿蒙宿主 C++ 编译检查未过"; exit 1

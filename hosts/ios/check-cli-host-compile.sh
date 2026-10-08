#!/usr/bin/env bash
# hosts/ios/check-cli-host-compile.sh —— ★CLI 生成的 iOS 宿主**编译检查**（零设备、零签名、零内核）
#
# 【为什么需要（`check-selfdraw-compile.sh` 的姊妹盲区）】
#   `check-selfdraw-compile.sh` 只检查**框架仓**的 `hosts/ios/ProteusHost/**`（参考宿主）。
#   而 `proteus create host ios` / `dev --target ios` 生成的宿主，其**壳**来自
#   `packages/cli/templates-host/ios/shell/*.swift`（模板）——**没有任何本地判据检查它**。
#   ⇒ 后果：改 CLI 的 iOS 壳模板后，只能靠"真机打包才知道能不能编译"（本轮实测：一处闭包签名
#     写错，`swiftc -typecheck` 秒级就能抓，却要等到 37s 打包才发现）。
#
# 【本脚本做什么】只跑 `swiftc -typecheck`（**不产二进制、不签名、不装机、不需 Rust 静态库**）：
#   把 CLI 模板的壳（shell/）+ 它依赖的 runtime 源集 + platform 适配层一起做类型检查。
#   这三份正是 `createHost` 复制进生成宿主的东西 ⇒ 生成宿主的编译错误本地即暴露。
#
# 【诚实边界】只做**类型检查**，不做链接/打包/签名（那是 `host-package.ts` + 真机的事）。
#
# 用法：bash hosts/ios/check-cli-host-compile.sh
set -uo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/xcode-env.sh"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# 三份源集（与 createHost 的 ios 单元 + 模板壳一致；新增文件必须同步——缺一个即红）
SHELL_SRCS=("$ROOT/packages/cli/templates-host/ios/shell/"*.swift)
RUNTIME_SRCS=("$HERE/ProteusHost/runtime/"*.swift)
PLATFORM_SRCS=("$ROOT/platform/ios/ProteusPlatform/"*.swift)
for f in "${SHELL_SRCS[@]}" "${RUNTIME_SRCS[@]}" "${PLATFORM_SRCS[@]}"; do
  [ -f "$f" ] || { echo "✗ 找不到来源：$f"; exit 2; }
done

echo "==> 类型检查 CLI iOS 宿主模板（swiftc -typecheck · 零设备）"
echo "    壳: ${#SHELL_SRCS[@]} · runtime: ${#RUNTIME_SRCS[@]} · platform: ${#PLATFORM_SRCS[@]}"
# ★与 host-package.ts 的编译参数一致（sdk/target/framework），否则本地绿、设备红
OUT="$(xcrun --sdk iphoneos swiftc -typecheck \
  -target arm64-apple-ios15.0 \
  -framework UIKit -framework CoreText -framework JavaScriptCore -framework AVFoundation \
  -parse-as-library \
  "${SHELL_SRCS[@]}" "${RUNTIME_SRCS[@]}" "${PLATFORM_SRCS[@]}" 2>&1)"
RC=$?
if [ "$RC" -ne 0 ]; then
  printf '%s\n' "$OUT" | grep -E "error:" | head -20
  echo "✗ 类型检查失败（exit ${RC}）"
  exit "$RC"
fi
# ★重复键门禁（与 check-selfdraw-compile.sh 同款）：字典字面量重复键 ⇒ 编译只告警、运行必崩
if printf '%s' "$OUT" | grep -q "duplicate entries for string literal key"; then
  echo "✗ 检测到字典字面量重复键（编译告警 · 运行必崩）——必须先修"
  printf '%s\n' "$OUT" | grep -n "duplicate entries for string literal key" | head
  exit 1
fi
echo "✅ CLI iOS 宿主模板类型检查通过（改 templates-host/ios/** 后先跑本脚本，再上真机）"

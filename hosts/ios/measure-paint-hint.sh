#!/usr/bin/env bash
# hosts/ios/measure-paint-hint.sh —— I3 的真机 A/B 内存复测（hint 开 vs 关）
#
# 【为什么必须是 A/B 配对，而不是"设了 hint 之后的绝对值"】
#   绝对值里混着场景固有占用（节点/层/字体缓存）——那些与 hint 无关。
#   只有同机、同场景、同轨迹下的两个变体配对，差值才是 hint 的净贡献。
#   （本仓纪律：没有对照的"达标/不达标"同样不可信。）
#
# 【变体怎么切】宿主读环境变量 PROTEUS_PAINT_HINT：
#   · 默认（不设）= 按判据设 contentsFormat（生产行为）
#   · off = 完全不设（系统默认格式，即"优化前"的形态）
#
# 【★★事件驱动（2026-09-30 重写；用户红线：「禁止任何情况下的 sleep / timeout——
#   要么让 App 主动报告，要么有条件等待」）】
#   原实现 = 启动后**轮询 copy + sleep 2 × 60**。当日实测两个装置缺陷：
#     ① 轮询只查「paint_hint 字段存在」⇒ 设备上**上一轮残留报告**同样满足
#        ⇒ 两个变体在同一份旧数据上比（差值恒 0），还曾被误归因为"环境变量未生效"；
#     ② 宿主报告字典里 `paint_hint_env` 曾被插两组**相同键** ⇒ Swift 字典字面量
#        重复键是**运行期 fatalError**（编译只出告警 ⇒ 门禁也没拦住；已修 + 编译门禁补判据）。
#   新机制：宿主 `PROTEUS_EXIT_AFTER_REPORT=1` ⇒ 报告落盘后**进程即退出**；
#     `devicectl ... launch --console` **等 App 退出才返回** ⇒ 命令返回 = 完成信号。
#     零轮询 / 零 sleep / 零超时；每轮仍有装置自证（判据见下）。
#
# 【判据（每轮断言，失败即标 INVALID/STALE 且不计入统计）】
#   ⓪ 预检：本地二进制含 run_ts / PROTEUS_EXIT_AFTER_REPORT 痕迹（旧产物直接拒跑）
#   ① 装置自证：报告为**本轮**写出（run_ts ≠ 基线）+ disabled 与变体一致
#   ② 开启态紧凑层数 > 0（接线真的生效）
#   ③ 汇总报出中位差值（不预设方向）
#
# 【诚实边界】只测进程物理占用峰值；含系统缓存波动 ⇒ 多轮取中位 + 附全部原始值。
# 用法：bash hosts/ios/measure-paint-hint.sh [轮数=5]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$HERE/lib/xcode-env.sh"

ROOT="$(cd "$HERE/../.." && pwd)"
ROUNDS="${1:-5}"
# ★★两台电脑签名切换（2026-10-08）：bundle 按**本机签名档**取（无档时回退原默认值）。
#   本脚本只做**安装已构建产物 + 度量**，不重签名，故只需要正确的 bundle id。
PROTEUS_IOS_PIN_ACTIVE=0
if _PIN_OUT="$(node "$HERE/lib/ios-signing.mjs" resolve --shell 2>/dev/null)"; then
  eval "$_PIN_OUT"
fi
_PIN_BUNDLE="cn.shxuxi.proteus.experiments"
if [ "${PROTEUS_IOS_PIN_ACTIVE}" = "1" ] && [ -n "${PROTEUS_IOS_BUNDLE_ID:-}" ]; then
  _PIN_BUNDLE="${PROTEUS_IOS_BUNDLE_ID}"
fi
BUNDLE_ID="${PROTEUS_BUNDLE_ID:-$_PIN_BUNDLE}"
RESULTS="$HERE/results"
mkdir -p "$RESULTS"

UDID="$(xcrun devicectl list devices 2>/dev/null | grep -v simulated | sed -n 's/.*\([0-9A-F]\{8\}-[0-9A-F]\{4\}-[0-9A-F]\{4\}-[0-9A-F]\{4\}-[0-9A-F]\{12\}\).*/\1/p' | head -1)"
if [ -z "$UDID" ]; then
  echo "未发现真机"; exit 2
fi
echo "==> 设备 ${UDID} · 每变体 ${ROUNDS} 轮（事件驱动：App 报告落盘后自退，命令返回即完成）"
echo "==> 诚实边界：读数是进程物理占用峰值（含系统缓存波动）⇒ 取中位并附原始值；不预设方向"

APP="$HERE/build-selfdraw/ProteusSelfDraw.app"
BIN="$APP/ProteusSelfDraw"
if [ ! -f "$BIN" ]; then
  echo "缺二进制（先跑 bash hosts/ios/run-selfdraw.sh）"; exit 2
fi
if [ -n "$(find "$HERE/ProteusHost" -name '*.swift' -newer "$BIN" 2>/dev/null | head -1)" ]; then
  echo "宿主源码比二进制新（产物陈旧）⇒ 先跑 bash hosts/ios/run-selfdraw.sh"; exit 3
fi
# ⓪ 预检：产物必须含事件驱动 + 上报标记痕迹（旧二进制会静默出假数据 / 无法判完成）
#   ★探针选长字符串：Swift 对 ≤15 字节的字面量做**小字符串优化**（内联进指令流，
#     不进数据段）⇒ `strings` 搜不到短键名（实测 `run_ts`/`paint_hint_env` 均为 0 命中，
#     而长字符串 `PROTEUS_EXIT_AFTER_REPORT` 可命中）。消息里的字段靠报告内容断言，不靠这里。
#   ★★匹配方式 = **先落变量再 case**（不是 `strings | grep -q`）：
#     `set -o pipefail` 下 `grep -q` 找到即退 → `strings` 收 SIGPIPE → 管道状态 141
#     ⇒ `! …` 判成"missing"——**假红**（本仓 pipefail 陷阱第三次；前两次见
#     hosts/android/run-js-batch.sh:38 与 build-and-run.sh:214 的注释）。
STR="$(strings "$BIN" 2>/dev/null || true)"
for needle in PROTEUS_EXIT_AFTER_REPORT SELFDRAW_REPORT_READY; do
  case "$STR" in
    *"$needle"*) : ;;
    *) echo "二进制不含 ${needle}（旧产物）⇒ 先跑 bash hosts/ios/run-selfdraw.sh 重建"; exit 3 ;;
  esac
done
if ! xcrun devicectl device install app --device "$UDID" "$APP" >/dev/null 2>&1; then
  echo "安装失败"; exit 4
fi

FAILED=0

run_variant() {
  local variant="$1"
  local round="$2"
  local out="$RESULTS/paint-hint-$variant-r$round.json"
  rm -f "$out"

  # ① 基线：设备上**现在**的报告（上一轮留下的）——只取 run_ts 作对照。
  #    ※对照设备自己的旧报告、不对照"本机时刻"：Mac 与 iPhone 的墙钟未取证前
  #      不得假定一致（跨机器时钟比较是自找的假判据）。
  local base="none"
  local basef="$RESULTS/.baseline-$variant-r$round.json"
  if xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
      --domain-identifier "$BUNDLE_ID" --source "Documents/selfdraw-report.json" \
      --destination "$basef" >/dev/null 2>&1; then
    base="$(node "$HERE/lib/read-run-ts.mjs" "$basef")"
  fi
  rm -f "$basef"

  # ② 启动（**阻塞到 App 退出** = 报告已落盘）；off 变体注入 PROTEUS_PAINT_HINT=off。
  #    宿主把**实际读到的**环境变量写进报告（paint_hint_env）⇒ 注入是否生效有读数可查。
  local envjson='{"PROTEUS_EXIT_AFTER_REPORT":"1"}'
  if [ "$variant" = "off" ]; then
    envjson='{"PROTEUS_EXIT_AFTER_REPORT":"1","PROTEUS_PAINT_HINT":"off"}'
  fi
  local log="$RESULTS/paint-hint-$variant-r$round.log"
  xcrun devicectl device process launch --console --terminate-existing \
    --environment-variables "$envjson" --device "$UDID" "$BUNDLE_ID" > "$log" 2>&1 || true
  if grep -qiE "not been explicitly trusted|invalid code signature" "$log"; then
    echo "    ✗ 第 $round 轮启动被拦：需在设备上手动信任开发者证书（设置 → 通用 → VPN与设备管理）"
    return 1
  fi

  # ③ 取一次报告（App 已退出 ⇒ 文件已在；取不到 = 硬失败，不重试不等待）
  if ! xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer \
      --domain-identifier "$BUNDLE_ID" --source "Documents/selfdraw-report.json" \
      --destination "$out" >/dev/null 2>&1; then
    echo "    ✗ 第 $round 轮报告未取到（日志尾：$(tail -1 "$log")）"
    return 1
  fi

  # ④ 装置自证（每轮）：新鲜（run_ts ≠ 基线）+ disabled 与变体一致
  local fmsg fresh_rc
  fmsg="$(node "$HERE/lib/check-report-freshness.mjs" "$out" "$base" 2>&1)"; fresh_rc=$?
  if [ "$fresh_rc" -ne 0 ]; then
    echo "    ✗ 第 $round 轮报告不是本轮写出（${fmsg}）"
    mv "$out" "${out%.json}.STALE.json"
    return 1
  fi
  local want="false"
  [ "$variant" = "off" ] && want="true"
  if ! node "$HERE/lib/read-paint-hint-round.mjs" "$out" "$round" "$want"; then
    echo "    ✗ 装置自证失败：disabled ≠ ${want}（环境变量没生效？看报告 paint_hint_env 与上方日志）"
    mv "$out" "${out%.json}.INVALID.json"
    return 1
  fi
  return 0
}

for v in on off; do
  echo "── 变体 $v ──"
  i=1
  while [ "$i" -le "$ROUNDS" ]; do
    run_variant "$v" "$i" || FAILED=$((FAILED + 1))
    i=$((i + 1))
  done
done

echo ""
echo "==> 汇总"
python3 "$HERE/lib/summarize-paint-hint.py" "$RESULTS" "$ROUNDS" > "$RESULTS/paint-hint-summary.txt" 2>&1
SUM_RC=$?
cat "$RESULTS/paint-hint-summary.txt"
if [ "$FAILED" -gt 0 ]; then
  echo "✗ 有 $FAILED 轮未通过装置自证（见上方 INVALID/STALE）——该结果不可用"
  exit 6
fi
exit "$SUM_RC"

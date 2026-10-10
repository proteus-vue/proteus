#!/usr/bin/env bash
# hosts/android/acceptance.sh
# ★★§9.2 **正式验收**：4050 元素性能与内存，严格按方案 §9.2 的测试环境要求执行。
#
# 【§9.2 的每一条要求 → 本脚本的对应动作】
#   ① 必须 release 包            → 调用 build-and-run.sh --release（非 debuggable）
#   ② 每次测试前杀进程重进        → force-stop 后再 start，每轮独立冷启动
#   ③ 重复 5 次取均值             → 默认 5 轮（--runs N 可调）
#   ④ Perfetto 确认跑在普大核     → 采样主线程 CPU，并按**实测核心频率**分档
#                                   （★不写死核号：不同设备拓扑不同——Redmi 是
#                                    cpu0-5 普大核 + cpu6/7 超大核；honor10/Kirin970 是
#                                    cpu0-3 A53 + cpu4-7 A73 两档。落在最快档时按设备档数判定）
#   ⑤ 监控设备温度避免降频        → 每轮前后读 thermal_zone，温差超阈值即告警
#   ⑥ 普通包名、不预载、不预触发 JIT → 包名 dev.proteus.layoutcore；测试由**按钮点击**触发
#                                   （§9.2「起点 = click 事件触发」），不在 onCreate 自动跑
#   ⑦ 区分「初次安装」与「闲时优化」→ 首轮单独标记为 first-install；后续为 steady
#   ⑧ 计时口径：click → 渲染指令送达 → 由 app 内 SystemClock 测量并落盘
#
# 【两条通路分两次冷启动】`--es path proteus|native` —— 隔离内存（同进程先后建树会互相污染）
#
# 用法：bash hosts/android/acceptance.sh [--runs 5] [--skip-build] [--fresh-install]
#   --quick      ★快速冒烟（≈90 秒）：只跑 1 条通路 + 1 轮 A/B，用于**确认装置可用**。
#                跑全量（~4 分钟）前先跑它 —— 装置有问题就在 90 秒内暴露，而不是 4 分钟后。
#   --preflight  ★跑前预检（零成本，≈5 秒）：产物契约 + 解析装置自测 + 屏幕/电源状态。
#                **验收会先自动跑它**——把「5 分钟后才发现装置错」变成「开跑前就发现」
#                （2026-09-29 实测：同一天因装置缺陷白跑 3 次全流程，每次 ~5 分钟）
#   --fresh-install  ★破坏性：卸载后重装（仅用于「初次安装 vs 闲时优化」对照；默认增量安装）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
ACTIVITY="$PKG/.MainActivity"
# ★★可注入（2026-09-29，与 `PROTEUS_APK` 同一根因的第二次修复）：
#   桩测用假 adb 跑真流程 ⇒ 它会在**生产结果目录**里造出 run 目录；旧实现靠"跑完删掉"清理，
#   而**被中断时清理不执行**（实测：verify 被取消 ⇒ 留下 `results/acceptance/20260929-190222/`
#   这种"看起来像验收证据"的垃圾目录——比 APK 残留更危险：**它可能被当作真数据引用**）。
#   ⇒ 正解：结果目录也可注入 —— 桩测让它写进临时目录，**生产目录零接触**。
#   纪律与 `PROTEUS_APK` 同款：**能靠隔离消除的副作用，不要靠"记得清理"来管理**。
OUT="${PROTEUS_RESULTS_DIR:-$HERE/results/acceptance}"
RUNS=5

# ★★gfxinfo 文本 → "Janky p50 frames"（**唯一解析实现**：自测与实测共用同一份，
#   避免"自测验的是另一段代码"——本仓「验证了但验的是别的」纪律）。
#   ★字段位置是按 `dumpsys gfxinfo` 实际输出核定的（不是猜的）：
#     `Total frames rendered: 603` → Total|frames|rendered|603 ⇒ $4
#     `Janky frames: 387 (64.18%)` → Janky|frames|387|64.18  ⇒ $3
#     `50th percentile: 17ms`      → 50th|percentile|17ms     ⇒ **$3**（曾是 $4 ⇒ 恒 0）
gfx_parse() {
  awk -F'[():% ]+' '
    /Total frames rendered/{t=$4}
    /Janky frames:/{j=$3}
    /50th percentile:/{p=$3+0}
    END{printf "%s %s %s", j+0, p+0, t+0}'
}

# ★★阶段计时（2026-09-29）：本脚本单次 ~5 分钟，此前**没有任何耗时归因**——
#   用户反馈「测试时间太长」时只能靠猜（"大概是 sleep 太多"）。实测证明那个猜测**是错的**：
#   固定 sleep 静态合计仅 71 秒，而单次总耗时 ~300 秒 ⇒ 大头在别处。
#   ⇒ 先量再优化：每阶段结束时打印本段耗时与累计，跑完给出**按耗时排序**的表。
PHASE_T0=$SECONDS
PHASE_LAST=$SECONDS
declare -a PHASE_LOG=()
phase() {
  local now=$SECONDS
  local dur=$((now - PHASE_LAST))
  PHASE_LOG+=("$dur|$1")
  printf '    ⏱ %-32s 本段 %3ds · 累计 %3ds\n' "$1" "$dur" "$((now - PHASE_T0))"
  PHASE_LAST=$now
}
phase_summary() {
  echo
  echo "═══ 耗时归因（本次运行）═══"
  printf '%s\n' "${PHASE_LOG[@]}" | sort -t'|' -k1 -nr | head -8 | while IFS='|' read -r d n; do
    printf '  %4ds  %s\n' "$d" "$n"
  done
  printf '  ----\n  %4ds  合计（含未标注段）\n' "$((SECONDS - PHASE_T0))"
}

# ★★等「完成信号」代替固定盲等（本仓纪律：等待必须有条件）
#
# 【为什么改】2026-09-29 实测：单次全流程 ~5 分钟，其中**固定 sleep 静态合计 71 秒**；
#   A/B 对照段最重（3 轮 × 2 通路 × sleep 16 = **96 秒**盲等）。
#   而 app 在每条通路跑完时会**写报告文件**——那就是天然的完成信号。
#   ⇒ 改为「轮询该文件出现」：正常 ~11 秒完成（比 16 秒少 5 秒），
#     且**异常时不会静默**（超时才继续，并报出等待了多久）。
#
# 【与「禁止固定 sleep 盲等」的关系】本 helper 是**条件探测 + 总超时上限**（不是盲等），
#   符合 AGENTS.md 红线；超时值是该通路的**观测上限**（不是预期耗时）。
# 用法：wait_report <文件名> <超时秒>；成功回 0 并打印实际耗时，超时回 1
wait_report() {
  local f="$1" timeout="${2:-30}" t=0
  while [ "$t" -lt "$timeout" ]; do
    if "$ADB" shell "test -f /sdcard/Android/data/$PKG/files/$f" >/dev/null 2>&1; then
      echo "      （完成信号：$f 已写出，用时 ${t}s）"
      return 0
    fi
    sleep 1; t=$((t + 1))
  done
  echo "      ⚠ 等待 $f 超时（${timeout}s）——该通路可能未完成，读数可能不全"
  return 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --runs) RUNS="$2"; RUNS_EXPLICIT=1; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --fresh-install) FRESH_INSTALL=1; shift ;;
    --selftest) SELFTEST=1; shift ;;
    --preflight) PREFLIGHT=1; shift ;;
    --quick) QUICK=1; shift ;;
    *) echo "未知参数：$1"; exit 2 ;;
  esac
done

# ══════════════════════════════════════════════════════════════════════════════
# ★★★ 硬门禁：**改过脚本/宿主源码就必须先过桩测**（2026-09-29 用户明确要求）
#
# 【用户原话】「又是反复修改测试脚本又是四十多分钟过去了!!!!! …… 掉效率自动化测试的问题
#   我都说了不止十次了啊，以后**禁止这样低效测试验证的方式**！！！！！！」
# 【实测账】当天 acceptance.sh 改了 8 轮，为验证**自己的脚本改动**跑了 7 次真机全流程
#   （每次 4–6 分钟）⇒ 40 分钟里绝大多数不是在测框架，是在测这个脚本。
# 【根因】脚本没有"不接设备的自测" ⇒ bash 逻辑 bug（`declare -A` 在 bash 3.2 崩、
#   删文件写在广播之后、变量展开、标签错位）只能用一次真机全流程去发现。
# 【本门禁】真机验收启动前校验指纹（脚本/宿主源码 vs 上次桩测通过时）——
#   不一致 ⇒ **拒绝启动真机** 并指向 `acceptance-stub.mjs`（45 秒，零设备）。
#   绕过方式（需显式表态，用于"我已经知道风险"的少数情形）：`SKIP_STUB_GATE=1`。
# ══════════════════════════════════════════════════════════════════════════════
if [ -z "${SKIP_STUB_GATE:-}" ] && [ -z "${SELFTEST:-}" ]; then
  if ! node "$HERE/acceptance-stub.mjs" --check-fresh 2>&1 | sed 's/^/  /'; then
    cat <<'GATE'
  ✗ 已中止真机验收（脚本/宿主源码改动后未过桩测）。

  ⇒ 先跑设备无关的桩测（约 45 秒，零设备）：
        node hosts/android/acceptance-stub.mjs
    它会在假设备上跑完整流程，断言：退出码/shell 错误/命令顺序/产物齐备/跑后自检/bash 3.2 兼容。

  ⇒ 确认要跳过（例如只改了注释）：SKIP_STUB_GATE=1 bash hosts/android/acceptance.sh ...
GATE
    exit 4
  fi
fi

# ── ★★测量装置自测（本仓纪律：**装置必须先自测**，否则读数错得静默）──────────────
# 【为什么需要】2026-09-29 实测发现 gfxinfo 解析取错字段：`50th percentile: 5ms` 按
#   `[():% ]+` 切分后字段是 `50th|percentile|5ms`（**$3**），而代码取的是 `$4`
#   ⇒ **p50 恒为 0**。它不会报错、不会变红，只会让「交替 N 轮取中位」这条通路
#   静默产出 0ms，进而让 A/B 判定（差值方向）完全失真。
#   ⇒ 同「像素采样器 R/B 互换」同源：**读数恒为 0 不是"还没做"，而是"读数恒假"**。
#   本自测用**固定样本**断言解析结果——装置自身可被证伪，不依赖设备。
if [ -n "${SELFTEST:-}" ]; then
  echo "== 测量装置自测（gfxinfo 解析）=="
  SAMPLE='Total frames rendered: 603
Janky frames: 387 (64.18%)
Janky frames (legacy): 400 (66.33%)
50th percentile: 17ms
90th percentile: 20ms
95th percentile: 21ms
99th percentile: 23ms'
  got="$(printf '%s\n' "$SAMPLE" | gfx_parse)"
  want="387 17 603"
  echo "  样本解析：${got}（期望：${want}）"
  if [ "$got" = "$want" ]; then
    echo "  ✅ 解析正确（Janky / p50 / frames 三项）"
  else
    echo "  ❌ 解析错误——装置不可用，先修 gfx_parse 再跑验收"
    exit 1
  fi
  # 反向断言：坏样本必须能被识破（防「恒返回期望值」的假自测）
  bad="$(printf 'Janky frames: 0 (0.00%%)\n50th percentile: 0ms\nTotal frames rendered: 0\n' | gfx_parse)"
  if [ "$bad" = "0 0 0" ]; then
    echo "  ✅ 零值样本可区分（${bad}）——自测非恒真"
  else
    echo "  ❌ 零值样本解析异常：${bad}"
    exit 1
  fi
  if [ -z "${PREFLIGHT:-}" ]; then exit 0; fi   # 不带 --preflight 时，--selftest 到此为止
fi

# ★★跑前预检（--preflight）：把装置问题挡在 5 分钟的全流程之前 ────────────────
#   三类检查（都是本次实测踩过的）：
#     ① 产物契约（静态）：谁写/谁读/谁拉是否自洽 —— 曾出现「汇总在读一个从来没人生成的文件」
#        与「两个场景写同一个文件名」（后者让 run 目录里拿到另一种数据，静默）
#     ② 解析装置自测：gfxinfo 字段位置（曾把 p50 取成 $4 ⇒ 恒 0，中位永远是 0）
#     ③ 设备状态：屏幕必须亮着 —— 灭屏时 app 只渲染个位数帧（实测 3 帧），
#        跑完会得到一堆无意义的「低帧数」读数（本次用户锁屏就是这个坑）
preflight() {
  local bad=0
  echo "══ 跑前预检（零成本）══"

  echo "── ① 产物契约（静态·零设备）──"
  if node "$HERE/check-artifact-contract.mjs"; then
    echo "  ✅ 契约成立"
  else
    echo "  ❌ 产物契约不成立 —— 先修再跑（否则跑完才发现拿不到证据）"
    bad=1
  fi

  echo "── ② 解析装置自测 ──"
  local sample='Total frames rendered: 603
Janky frames: 387 (64.18%)
50th percentile: 17ms'
  local got; got="$(printf '%s\n' "$sample" | gfx_parse)"
  if [ "$got" = "387 17 603" ]; then
    echo "  ✅ gfxinfo 解析正确（${got}）"
  else
    echo "  ❌ gfxinfo 解析错误（得到 ${got}，期望 387 17 603）"
    bad=1
  fi

  echo "── ③ 设备状态 ──"
  if ! "$ADB" get-state >/dev/null 2>&1; then
    echo "  ❌ 设备未连接（adb get-state 失败）"; bad=1
  else
    local model; model="$("$ADB" shell getprop ro.product.model | tr -d '\r')"
    # ★屏幕：灭屏时 onDraw 不跑 ⇒ 帧数会掉到个位数（实测 3 帧），读数全部无意义
    "$ADB" shell svc power stayon true >/dev/null 2>&1 || true
    "$ADB" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
    "$ADB" shell wm dismiss-keyguard >/dev/null 2>&1 || true
    sleep 2
    local wake; wake="$("$ADB" shell dumpsys power 2>/dev/null | tr -d '\r' | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2)"
    local usb; usb="$("$ADB" shell dumpsys battery 2>/dev/null | tr -d '\r' | grep -m1 -o 'USB powered: [a-z]*' | awk '{print $3}')"
    local batt; batt="$("$ADB" shell dumpsys battery 2>/dev/null | tr -d '\r' | grep -m1 -o 'level: [0-9]*' | awk '{print $2}')"
    echo "  设备：${model} · 屏幕：${wake} · USB：${usb} · 电量：${batt}%"
    if [ "$wake" != "Awake" ]; then
      echo "  ❌ 屏幕未点亮（mWakefulness=${wake}）——灭屏时 app 只渲染个位数帧，读数无意义"
      bad=1
    else
      echo "  ✅ 屏幕已点亮"
    fi
    if [ "$usb" != "true" ]; then
      echo "  ⚠ 未接 USB 供电：\`svc power stayon true\` 只在插电时生效 —— 长跑可能中途锁屏"
    fi
    if [ -n "$batt" ] && [ "$batt" -lt 50 ] 2>/dev/null; then
      echo "  ⚠ 电量 ${batt}% 偏低（§9.2 要求 ≥90%）"
    fi
    if ! "$ADB" shell pm list packages 2>/dev/null | grep -q "$PKG"; then
      echo "  ⚠ 设备上未安装 ${PKG}（首次安装会自动装）"
    fi
  fi

  echo
  if [ "$bad" = "1" ]; then
    echo "✗ 预检未通过 —— 先修上面❌项再跑验收"
    return 1
  fi
  echo "✅ 预检通过 —— 可以跑验收"
  return 0
}

if [ -n "${PREFLIGHT:-}" ]; then
  preflight || exit 1
  exit 0
fi

# ★--quick：内存对照轮数降为 1（默认 5 轮 × 2 通路 ≈ **124 秒**，单次验收最大的一项）。
#   用途是"确认装置可用"，不需要统计样本；真正验收按 §9.2 跑 5 轮。
if [ -n "${QUICK:-}" ] && [ "${RUNS_EXPLICIT:-0}" = "0" ]; then RUNS=1; fi

mkdir -p "$OUT"

if [ -z "${SKIP_BUILD:-}" ]; then
  echo "==> 构建 release 包（§9.2 要求）"
  bash "$HERE/build-and-run.sh" --no-install --release 2>&1 | grep -E "构建模式|class 文件|✗" | head -5
fi
# ★★可注入（2026-09-29，S5 途中实测的产物污染缺陷）：桩测（acceptance-stub.mjs）
#   要用一个**占位 APK** 走完整控制流，但它当时只能覆盖这个生产路径
#   ⇒ 一旦桩测被中断（实测：`pnpm verify` 被我取消），占位就**留在生产路径上**，
#   而后续桩测又把占位当"真实包"备份回去 ⇒ 真包被永久毁掉（排查了一轮）。
#   ⇒ 正解：路径可注入 —— 桩测传 `PROTEUS_APK=<自己的独立目录>`，**生产产物零接触**。
#   纪律：**测试装置与被测产物在文件系统上也要隔离**，不能靠"跑完记得还原"。
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
[ -f "$APK" ] || { echo "✗ APK 不存在：$APK"; exit 2; }

# ★★验收**自动先跑预检**（可 SKIP_PREFLIGHT=1 跳过）：装置问题在 5 秒内暴露，
#   而不是等 5 分钟全流程跑完后才发现（2026-09-29 实测教训）
if [ -z "${SKIP_PREFLIGHT:-}" ]; then
  preflight || { echo "✗ 预检未通过 —— 已中止（设 SKIP_PREFLIGHT=1 可强制继续）"; exit 1; }
  echo
fi

phase "构建 + 跑前预检"
echo "==> 安装 release 包"
"$ADB" wait-for-device

# ★★「卸载」是**破坏性动作**，默认不做（本仓实测教训）：
#   初版无条件 `uninstall` → 某次因 MIUI 的「USB 安装」开关关闭，卸载成功但重装被拒
#   （INSTALL_FAILED_USER_RESTRICTED）→ 设备上变成**无 app 状态**，后续所有验收都跑不了。
#   现在：默认**增量安装**（`-r`）；仅当显式传 `--fresh-install` 才卸载重装。
INSTALL_OK=0
if [ "${FRESH_INSTALL:-0}" = "1" ]; then
  echo "    （--fresh-install：先卸载，用于「初次安装」组数据）"
  "$ADB" uninstall "$PKG" >/dev/null 2>&1 || true
  if "$ADB" install "$APK" 2>&1 | tail -2 | grep -q Success; then INSTALL_OK=1; fi
else
  if "$ADB" install -r -t "$APK" 2>&1 | tail -2 | grep -q Success; then INSTALL_OK=1; fi
fi

# ★安装失败必须**立即中止**（否则后面所有"测量"都跑在空设备上，产出假数据/空报告）
if [ "$INSTALL_OK" != "1" ]; then
  cat <<'MSG'
✗ 安装失败——已中止（不继续跑验收，避免产出空数据）。

  常见原因（MIUI / 部分国产 ROM）：
    · 设置 → 更多设置 → 开发者选项 → 打开「USB 安装」（独立于「USB 调试」）
    · 或设备上弹出了安装确认框但未点允许

  提示：不要用「卸载再装」的方式绕过——卸载成功但重装失败会让设备变成无 app 状态。
MSG
  exit 3
fi
echo "    ✓ 安装成功"

# ── 工具函数 ─────────────────────────────────────────────────────────

# 主线程当前 CPU（/proc/<pid>/task/<pid>/stat 第 39 字段）——用于「是否跑在超大核」判定
main_thread_cpu() {
  local pid="$1"
  "$ADB" shell "awk '{print \$39}' /proc/$pid/task/$pid/stat 2>/dev/null" 2>/dev/null | tr -d '\r\n'
}

# 各核最大频率 —— ★**全部核心**（原来只采 cpu6/cpu0 ⇒ 把设备拓扑写死了）
#
# 【为什么必须采全部（本仓实测的设备移植缺陷）】原实现写死 `for c in 6 0`，
#   而下游 `cpu_class` 又写死 "n >= 6 ⇒ 超大核"——两者合起来 = 假定「8 核、cpu6/7 最快」。
#   换到 honor10（**Kirin 970：cpu0-3 = A53@1.844GHz · cpu4-7 = A73@2.362GHz**）就错了：
#   cpu4/5 会被归成"普大核"（它们其实是本机最快档），cpu6/7 被叫"超大核"（本机根本没有第三档）。
#   ⇒ 正解：采**全部**核心频率，由下游**按频率分档**（几档、哪档最快都是测出来的，不是假设的）。
core_max_freq() {
  "$ADB" shell 'for d in /sys/devices/system/cpu/cpu[0-9]*; do c=$(basename $d); f=$(cat $d/cpufreq/cpuinfo_max_freq 2>/dev/null); [ -n "$f" ] && echo -n "$c=$f "; done' 2>/dev/null | tr -d '\r'
}

# 温度（m°C）—— ★**多源回退**（本仓实测的设备差异）
#
# 【为什么必须回退（honor10 实测）】原实现只读 /sys/class/thermal/thermal_zone*/temp。
#   honor10（Android 10 / Kirin 970）上该目录对 **shell 也不可读**（SELinux）⇒ 恒空
#   ⇒ 脚本侧温度读数**一直是空的**（而调用方不检查，会被读成"温度未变化"）。
#   ⇒ 回退链：① thermal_zone（多数设备）→ ② dumpsys thermalservice 的 Cached temperatures
#     （honor10 实测可用：cluster0/cluster1/gpu/battery）→ ③ 空（明确标注，不假装有读数）。
#   ★从 dumpsys 的浮点摄氏度转成与 ① 一致的 m°C（×1000）。
max_temp() {
  local v
  v=$("$ADB" shell 'cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | sort -n | tail -1' 2>/dev/null | tr -d '\r\n')
  if [ -n "$v" ]; then echo "$v"; return; fi
  # ② dumpsys thermalservice：取所有 Cached temperatures 的**最大值**（含 cluster0/1、gpu）
  v=$("$ADB" shell 'dumpsys thermalservice 2>/dev/null | grep -oE "mValue=[0-9]+(\.[0-9]+)?" | cut -d= -f2 | sort -n | tail -1' 2>/dev/null | tr -d '\r\n')
  if [ -n "$v" ]; then
    # 浮点 → m°C（整数）
    awk -v x="$v" 'BEGIN{printf "%d", x*1000}'
    return
  fi
  echo ""    # ③ 取不到：返回空（调用方须能处理）
}

# 内存（PSS）★注意：Android 的 toybox grep **不支持 `\s`**（本仓实测：含 `\s` 的模式匹配不到，
# 导致 PSS 恒为空）→ 改用 POSIX 字符类 `[[:space:]]`
pss_of() {
  local pid="$1"
  "$ADB" shell "dumpsys meminfo $pid 2>/dev/null | grep -E '^[[:space:]]+TOTAL' | head -1" 2>/dev/null \
    | tr -d '\r' | awk '{print $2}'
}

# 跑一轮（给定通路），返回：采集的 PSS / CPU / 温度，报告落盘
# 通路 → 完成信号（该通路独有的报告文件）：run_one 用它判断"这一条跑完了"
# ★用 case 而不是关联数组：macOS 自带 bash 3.2 **不支持 `declare -A`**，
#   而 `set -u` 会把未定义变量当错误 ⇒ 直接 `unbound variable` 中断（实测踩到）。
report_of() {
  case "$1" in
    proteus)           echo "layout-compare-native.json" ;;
    native)            echo "layout-native-only.json" ;;
    proteus-mem)       echo "layout-proteus-only.json" ;;
    proteus-noflatten) echo "layout-noflatten.json" ;;
    flat-redraw)       echo "layout-flat-redraw.json" ;;
    app-4050)          echo "layout-app-4050.json" ;;
    app-4050-native)   echo "layout-app-4050-native.json" ;;
    recycle)           echo "layout-recycle.json" ;;
    *)                 echo "" ;;
  esac
}

run_one() {
  local path="$1" label="$2" idx="$3"
  local _t0=$SECONDS
  "$ADB" shell am force-stop "$PKG" || true
  sleep 1                       # 让进程完全退出（§9.2「杀进程重进」）
  "$ADB" shell am start -n "$ACTIVITY" --es path "$path" >/dev/null 2>&1
  sleep 3                       # 等冷启动稳定（不预触发测试）

  local t_before; t_before="$(max_temp)"
  local pid; pid="$("$ADB" shell pidof "$PKG" 2>/dev/null | tr -d '\r\n')"
  [ -n "$pid" ] || { echo "  ✗ 未取到 pid"; return 1; }

  local pss_before; pss_before="$(pss_of "$pid")"

  # ★§9.2「起点 = click 事件触发」：用广播触发（语义等同外部点击；`input tap` 在
  #   Android 新版本需 INJECT_EVENTS 权限，本仓实测被拒）
  # ★★删除**本次**通路的旧报告必须在**广播之前**（否则会误删本次产物）
  local _rep; _rep="$(report_of "$path")"
  if [ -n "$_rep" ]; then
    "$ADB" shell "rm -f /sdcard/Android/data/$PKG/files/$_rep" >/dev/null 2>&1 || true
  fi
  "$ADB" shell am broadcast -a dev.proteus.RUN --es path "$path" -p "$PKG" >/dev/null 2>&1
  # ★核判定以 **app 自报**为准（脚本侧读别的进程 /proc 受限，本仓实测恒得同一值）；
  #   脚本侧仅作粗采样参考
  local cpus=""
  for _ in 1 2 3; do
    cpus="$cpus $(main_thread_cpu "$pid")"
    sleep 0.3
  done
  # ★等「该通路的报告写出」代替固定 sleep 2（本仓纪律：等待必须有条件）——
  #   app 在通路跑完时写报告，那是天然完成信号；固定等待既可能偏早（读数不全）也可能白等。
  if [ -n "$_rep" ]; then
    wait_report "$_rep" 30 >/dev/null 2>&1 || true
  else
    sleep 2
  fi
  local pss_after; pss_after="$(pss_of "$pid")"
  local t_after; t_after="$(max_temp)"

  echo "  轮次 ${idx}（${label}）：PSS ${pss_before}→${pss_after} KB · CPU采样:${cpus} · 温度 ${t_before}→${t_after}"
  # 记录原始数据（供汇总）
  echo "$idx|$label|$pss_before|$pss_after|$(echo $cpus | tr ' ' ',')|$t_before|$t_after" >> "$OUT/raw.txt"
  echo "      ⏱ 通路 $path 用时 $((SECONDS - _t0))s"
}

echo
echo "═══ 正式验收开始（runs=${RUNS}）═══"
echo "核心频率：$(core_max_freq)"
echo "（★核心档位**按实测频率分档**，不写死核号——见 core_max_freq 注释。§9.2：主线程落在**最快档且存在更快档**时数据作废）"
echo

rm -f "$OUT/raw.txt"

# ★★本次运行的产物目录——**必须在最前面建**：多条通路（app-4050 多轮）在取回报告段之前
#   就要往里写逐轮读数（本仓实测踩到：原定义在"取回报告"段，其前的 `$DEST` 是 unbound variable）
DEST="$OUT/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

# ★§9.2 的两类指标用**不同通路**测量，避免测量装置互相污染：
#   · 性能/一致性 → proteus：含完整归因测量（会分配测量位图）
#   · 增量内存     → proteus-mem / native：**只建结构**（同口径，不含测量位图）
for path in proteus-mem native; do
  echo "── 通路：$path ──"
  for i in $(seq 1 "$RUNS"); do
    label="$path"
    [ "$i" = "1" ] && label="${path}-first-install" || label="${path}-steady"
    run_one "$path" "$label" "$i"
  done
done

echo "── 通路：proteus（性能与一致性，单轮）──"
run_one "proteus" "proteus-perf" 1

# ★★对标 uni-app x「创建元素」场景（应用级口径）——**对标主指标**，--quick 也跑它
#   两侧分两次冷启动（同进程会互相污染内存）
# ★★对标基准：**每组 N 轮 + 逐轮原始值**（基准 §1.3.3 明确要求"同时报平均值与 5 个原始值"，
#   只报平均会被质疑"挑了最好的一次"）。默认 N = RUNS（正规验收 5 轮；--quick 为 1 轮）。
APP4050_ROUNDS="$RUNS"
echo "── 对标基准 · 创建元素 4050（应用级口径）· 两侧各 ${APP4050_ROUNDS} 轮 ──"
# ★逐轮读数**每轮单独落盘**（基准要求给原始值；本仓纪律：证据必须可复算）
APP4050_P=""; APP4050_N=""
for i in $(seq 1 "$APP4050_ROUNDS"); do
  run_one "app-4050" "app-4050" "$i"
  "$ADB" pull "/sdcard/Android/data/$PKG/files/layout-app-4050.json" "$DEST/app-4050-r$i.json" >/dev/null 2>&1 || true
done
for i in $(seq 1 "$APP4050_ROUNDS"); do
  run_one "app-4050-native" "app-4050-native" "$i"
  "$ADB" pull "/sdcard/Android/data/$PKG/files/layout-app-4050-native.json" "$DEST/app-4050-native-r$i.json" >/dev/null 2>&1 || true
done
# ★两侧对照汇总（均值 + 逐轮原始值 + 倍率）——基准 §5.1 要求"只比基于各自原生基线的倍率"
python3 - "$DEST" <<'PYAGG' | tee "$DEST/app-4050-ab.txt" | sed 's/^/  /'
import json, os, sys, statistics
dest = sys.argv[1]
def rounds(pat, key):
    xs = []
    for i in range(1, 50):
        f = os.path.join(dest, pat.format(i))
        if not os.path.exists(f): break
        try: xs.append(float(json.load(open(f))[key]))
        except Exception: pass
    return xs
# ★★两侧都给**冷 / 稳态**两组（2026-09-29：实测冷读效应，见报告"为什么倍率差这么多"）
#   稳态 = 进程内第 2 次完整运行（类加载/JIT 已就绪）；冷读 = 第 1 次（更接近"用户刚开 app 就点"）
#   判定以**冷/冷**为主口径（保守：与"新进程里的首次交互"一致），稳态作次口径一并列出。
p_warm = rounds('app-4050-r{}.json', 'scope_ms')
n_warm = rounds('app-4050-native-r{}.json', 'scope_ms')
p_cold = rounds('app-4050-r{}.json', 'scope_cold_ms')
n_cold = rounds('app-4050-native-r{}.json', 'scope_cold_ms')
if not p_warm or not n_warm:
    print(f'⚠ 对照不完整（Proteus {len(p_warm)} 轮 / 原生 {len(n_warm)} 轮）——无法出倍率'); raise SystemExit(0)
def line(name, ps, ns):
    if not ps or not ns: return
    pm, nm = statistics.mean(ps), statistics.mean(ns)
    print(f'{name}')
    print(f'   Proteus 逐轮 {[round(x,1) for x in ps]} ms · 均值 {pm:.1f} ms')
    print(f'   原生    逐轮 {[round(x,1) for x in ns]} ms · 均值 {nm:.1f} ms')
    print(f'   ★倍率 = {pm/nm:.3f}（<1 = 更快）')
line('【冷读】进程内首次完整运行（= 新进程里用户第一次点）', p_cold, n_cold)
print()
line('【稳态】进程内第二次完整运行（类加载/JIT 已就绪）', p_warm, n_warm)
print()
print('★判定口径：基准比的是「vs 各自设备原生基线」的倍率（§5.1），不跨设备比绝对值')
print('★基准侧 5 轮取平均（§1.3.3）——本表已给逐轮值，可自行复算')
PYAGG

if [ -n "${QUICK:-}" ]; then
  # ★--quick：只跑这两条通路就跳到滚动对照（1 轮 A/B），用于快速确认装置可用
  echo
  echo "══ --quick 模式：跳过 noflatten / flat-redraw / recycle 三条通路 ══"
  echo "   （它们是能力覆盖项；装置可用性由 proteus 通路 + 1 轮 A/B 已足以确认）"
fi

if [ -z "${QUICK:-}" ]; then
# ★§9.2 第二行指标：不拍平时的耗时（拍平只对静态子树生效，动态内容走这条路径）
echo "── 通路：proteus-noflatten（§9.2「不拍平」指标）──"
run_one "proteus-noflatten" "proteus-noflatten" 1

# ★★绘制常数开销对照（2026-09-29）：行级显示列表复用 vs 全量重放
#   回答开项「绘制常数开销的根因 = 每次全量重放 2000 条指令」是否成立、机制收益多大
echo "── 通路：flat-redraw（绘制常数开销：行级显示列表复用）──"
run_one "flat-redraw" "flat-redraw" 1

# ★§9.3 长列表验收：4000 行滚到底再回滚（复用池 + 内存收敛）
echo "── 通路：recycle（§9.3 长列表）──"
run_one "recycle" "recycle" 1
fi   # ← 结束「非 --quick」的通路块

echo
phase "安装 + 通路 run_one"
echo "==> 取回报告"
# （DEST 已在本次验收开始时定义——见上方注释）
for f in layout-report.txt layout-conformance.json layout-bench.json layout-compare-native.json layout-native-only.json layout-proteus-only.json layout-noflatten.json layout-flat-redraw.json layout-app-4050.json layout-app-4050-native.json layout-recycle.json layout-memory.json layout-env.json layout-hit.json layout-scroll.json layout-scroll-core.json layout-scroll-native.json; do
  "$ADB" shell "run-as $PKG cat files/$f" >/dev/null 2>&1 && continue   # debug 包兼容
  # ★release 包：从外置存储拉（getExternalFilesDir）
  "$ADB" pull "/sdcard/Android/data/$PKG/files/$f" "$DEST/$f" >/dev/null 2>&1 || true
done
cp "$OUT/raw.txt" "$DEST/raw.txt"
echo "    报告目录：$DEST"
ls -1 "$DEST" | head -10

echo
phase "取回报告"
echo "==> 跨端命中一致性（M3 事件系统：同一份探针 → 两端逐位相同）"
# ★★先在本机**采集命中报告**（原来只找文件、从不生成 ⇒ 必然缺失）
#
# 【故障链（honor10 实测，本轮抓到）】原实现直接 `cross-device-hit.py $DEST/layout-hit.json ...`，
#   而**本次验收流程从未跑过 `hit` 通路** ⇒ 该文件必然不存在 ⇒ 脚本报"报告不存在"并非零退出；
#   配合 `set -o pipefail`（本脚本第 23 行）⇒ **整条验收在此中断**：
#   Perfetto、gfxinfo、核心驱动滚动、汇总**全都没跑**（首跑日志正好停在这一点，38 行处）。
#   ★纪律：**辅助检查不得杀掉主流程**——跨端比对是"附加证据"，它的失败不该让主测量消失。
#   ⇒ 修：① 先跑 `hit` 通路生成报告 ② 比对失败**不中断**（`|| true` + 如实打印）。
"$ADB" shell "rm -f /sdcard/Android/data/$PKG/files/layout-hit.json" >/dev/null 2>&1 || true
"$ADB" shell am force-stop "$PKG" >/dev/null 2>&1; sleep 1
"$ADB" shell am start -n "$ACTIVITY" --es path hit >/dev/null 2>&1; sleep 3
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path hit -p $PKG" >/dev/null 2>&1
HT=0
while [ "$HT" -lt 45 ]; do
  if "$ADB" shell "test -f /sdcard/Android/data/$PKG/files/layout-hit.json" >/dev/null 2>&1; then break; fi
  sleep 3; HT=$((HT + 3))
done
"$ADB" pull "/sdcard/Android/data/$PKG/files/layout-hit.json" "$DEST/layout-hit.json" >/dev/null 2>&1 || true
# ★需要 iOS 的报告（hosts/ios/results/layout-core-bench-ios.json）；缺失时脚本会如实说明并跳过比对
if [ -f "$DEST/layout-hit.json" ] && [ -f "$ROOT/hosts/ios/results/layout-core-bench-ios.json" ]; then
  python3 "$ROOT/hosts/cross-device-hit.py" "$DEST/layout-hit.json" "$ROOT/hosts/ios/results/layout-core-bench-ios.json" 2>&1 | tail -12 | sed 's/^/    /' || true
else
  echo "    ⚠ 缺报告（Android：$([ -f "$DEST/layout-hit.json" ] && echo 有 || echo 无)；iOS：$([ -f "$ROOT/hosts/ios/results/layout-core-bench-ios.json" ] && echo 有 || echo 无)）——跳过跨端比对（不影响主流程）"
fi

phase "跨端命中一致性"
echo "==> 采集 Perfetto trace（§9.2 权威核判定）"
# ★★**可写路径探测 + 失败如实标注**（本仓实测的设备差异，honor10 暴露）
#
# 【故障链】原实现固定写 `/data/misc/perfetto-traces/`——该目录在 honor10 上**根本不存在**
#   （`ls: No such file or directory`），而 `/data/local/tmp` 又是 `errno 13 Permission denied`
#   ⇒ perfetto **静默失败**，脚本继续往下跑，**Perfetto 段一个字都没输出**
#   （现象：日志里只有 "==> 采集 Perfetto trace"，然后直接跳到下一节 —— 极易被当成"跑过了"）。
#   ★纪律：**辅助工具不可用必须显式报出**（本仓 #35 同族：没有输出的"成功"最危险）。
CFG="$(dirname "$0")/perfetto-config.txt"
TRACE=""
for cand in /data/misc/perfetto-traces/acceptance.pftrace /data/local/tmp/acceptance.pftrace; do
  d="$(dirname "$cand")"
  if "$ADB" shell "[ -d $d ] && touch $cand 2>/dev/null && echo ok" 2>/dev/null | grep -q ok; then
    TRACE="$cand"; break
  fi
done
if [ -z "$TRACE" ]; then
  echo "    ⚠ 无可用 trace 路径（已试 /data/misc/perfetto-traces 与 /data/local/tmp）——"
  echo "      honor10 实测：前者不存在、后者 Permission denied（SELinux）"
  echo "      ⇒ **跳过 Perfetto**（辅助证据缺失，不影响主测量；核判定改用 app 自报的 layout-env.json）"
fi
"$ADB" shell am force-stop "$PKG" >/dev/null 2>&1; sleep 1
"$ADB" shell am start -n "$ACTIVITY" --es path scroll >/dev/null 2>&1; sleep 4
# ★★Perfetto 按需启用（2026-09-29）：**分析器不可用时不再采集**
#   实测：本机 trace_processor prebuilt 未缓存 ⇒ 分析段 106s 全白费（含 75s 下载超时）。
#   采集本身也要 25s（duration_ms=25000）⇒ 分析不可能成功时，采集同样应跳过。
#   探测方式：分析器的 `--check-available`（零网络、秒级）。可用时行为与原先完全一致。
PERFETTO_OK=0
if python3 "$(dirname "$0")/perfetto-analyze.py" --check-available >/dev/null 2>&1; then PERFETTO_OK=1; fi
if [ -z "$TRACE" ] || [ "$PERFETTO_OK" = "0" ]; then
  if [ "$PERFETTO_OK" = "0" ]; then
    echo "    ⚠ 跳过 Perfetto **采集**：分析器不可用（trace_processor 未缓存）——采集了也分析不了"
    echo "      · 本仓实测：该段曾白花 106 秒（含 75s 下载超时）、历史产物 0 个"
    echo "      · 核判定改用 app 自报的 layout-env.json（汇总段已有，判据等效）"
  fi
fi
if [ -n "$TRACE" ] && [ "$PERFETTO_OK" = "1" ]; then
cat "$CFG" | "$ADB" shell "perfetto --txt -c - -o $TRACE" >/dev/null 2>&1 &
PF_PID=$!
sleep 6                      # 让 trace 先跑起来（覆盖触发前的一段）
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path scroll -p $PKG" >/dev/null 2>&1
wait $PF_PID 2>/dev/null || true
"$ADB" pull "$TRACE" "$DEST/acceptance.pftrace" >/dev/null 2>&1 || true
if [ -f "$DEST/acceptance.pftrace" ]; then
  PY="$ROOT/.tools/py"
  PYTHONPATH="$PY" python3 "$(dirname "$0")/perfetto-analyze.py" "$DEST/acceptance.pftrace" "$PKG" 2>&1 | tail -16 | sed 's/^/    /' || true
fi
fi   # ← 结束 `if [ -n "$TRACE" ] && [ "$PERFETTO_OK" = "1" ]`（路径不可用或分析器不可用时整段跳过）

phase "Perfetto"
echo "==> 采集系统帧率读数（§9.3 权威口径：dumpsys gfxinfo）"
GFX="$DEST/gfxinfo.txt"
# ★必须先 reset，否则 gfxinfo 是**进程生命周期累计**（含冷启动画面），与滚动无关
"$ADB" shell "dumpsys gfxinfo $PKG reset" >/dev/null 2>&1
echo "    → gfxinfo 已 reset；触发滚动验收…"
"$ADB" shell am force-stop "$PKG" >/dev/null 2>&1; sleep 1
"$ADB" shell am start -n "$ACTIVITY" --es path scroll >/dev/null 2>&1; sleep 3
"$ADB" shell "rm -f /sdcard/Android/data/$PKG/files/layout-scroll.json" >/dev/null 2>&1 || true
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path scroll -p $PKG" >/dev/null 2>&1
# ★条件等待（完成信号 = layout-scroll.json 写出）代替固定 sleep 16
wait_report "layout-scroll.json" 40 >/dev/null 2>&1 || true
sleep 1
"$ADB" shell "dumpsys gfxinfo $PKG" 2>/dev/null | tr -d '\r' > "$GFX"
# ★S6（输入延迟专项 #767）：gfxinfo → 结构化输入延迟报告（hosts/android/results/input-latency.json），
#   供 check:input-latency 门禁消费；失败不阻断验收（报告缺失门禁如实 ◐ 跳过）
node "$ROOT/scripts/gen-input-latency.mjs" --gfxinfo "$GFX" --out "$ROOT/hosts/android/results/input-latency.json" >/dev/null 2>&1 || true
echo "    ── Proteus（虚拟化滚动）──"
grep -E "Total frames rendered|Janky frames \(|50th percentile|90th percentile|95th percentile|99th percentile|Slow UI thread|Slow issue draw commands|Slow bitmap uploads" "$GFX" | sed 's/^/      /'

# ★★**交替 N 轮 + 取中位**（本仓实测：单次读数在 honor10 上**不可信**）
#
# 【为什么不能只跑一轮（honor10 实测的双峰分布）】同一路径连跑 6 次，p50 落在
#   **两个离散状态**：11ms（Janky 0.5–1.0%）与 18ms（Janky 99%）。
#   单次配对会随机得到"Proteus 慢 6ms"或"Proteus 快 2ms"**两个相反结论**
#   （本档第一轮就撞上：19 vs 13 ⇒ 误判"框架慢 6ms"）。
#   ⇒ 正解：**交替跑 N 轮取中位**（本仓既有纪律：同轮 A/B + 多轮中位）。
#   ★诚实边界：**双峰成因未查明**（疑与设备电源/窗口焦点状态有关，未做仪器级确认）
#     —— 故本档只报**中位数**并显式标注分布，不报单轮值。
SCROLL_ROUNDS="${SCROLL_ROUNDS:-${QUICK:+1}}"
SCROLL_ROUNDS="${SCROLL_ROUNDS:-3}"
gfx_one() {
  local path="$1" round="${2:-1}"
  "$ADB" shell "dumpsys gfxinfo $PKG reset" >/dev/null 2>&1
  "$ADB" shell am force-stop "$PKG" >/dev/null 2>&1; sleep 1
  "$ADB" shell am start -n "$ACTIVITY" --es path "$path" >/dev/null 2>&1; sleep 3
  # ★先删旧报告，使「文件出现」成为**本次**的完成信号（否则读到上一轮残留）
  "$ADB" shell "rm -f /sdcard/Android/data/$PKG/files/layout-scroll-core.json" >/dev/null 2>&1 || true
  "$ADB" shell "rm -f /sdcard/Android/data/$PKG/files/layout-scroll-native.json" >/dev/null 2>&1 || true
  "$ADB" shell "am broadcast -a dev.proteus.RUN --es path $path -p $PKG" >/dev/null 2>&1
  # ★条件等待（完成信号 = 报告文件写出）代替原来的固定 `sleep 16`
  wait_report "layout-scroll-$([ "$path" = scroll-core ] && echo core || echo native).json" 40 >/dev/null 2>&1 || true
  sleep 1                      # 让 gfxinfo 的最后一帧落账（帧计数在同帧末更新）
  # ★解析走唯一实现 gfx_parse（与 --selftest 共用）——不在此处再写一份 awk
  local raw; raw="$("$ADB" shell "dumpsys gfxinfo $PKG" 2>/dev/null | tr -d '\r')"
  # ★★逐轮原始 dump 落盘（2026-09-29 补）：此前**只有中位值**进 scroll-ab.txt，
  #   逐轮读数一份都不留 ⇒ 报告里的「6 轮中位表」**无法被第三方从产物复算**
  #   （本仓纪律：证据必须可复算）。现在每轮每通路各存一份，与中位并列。
  printf '%s\n' "$raw" > "$DEST/gfxinfo-$path-r$round.txt" 2>/dev/null || true
  local parsed; parsed="$(printf '%s\n' "$raw" | gfx_parse)"
  # ★装置自检（每次调用都断言）：p50 与 frames 同时为 0 只可能是解析失败或 app 未渲染
  #   ——绝不能静默进入中位计算（恒 0 的中位会让 A/B 差值方向失真）
  local j p t; j="${parsed%% *}"; t="${parsed##* }"; p="$(echo "$parsed" | cut -d' ' -f2)"
  if [ "${t:-0}" -eq 0 ]; then
    echo "    ⚠ gfx_one(${path})：frames=0（app 未渲染或解析失败）——该轮作废" >&2
  elif [ "${p:-0}" -eq 0 ]; then
    echo "    ⚠ gfx_one(${path})：p50=0 但 frames=${t}——解析可疑，请跑 --selftest" >&2
  fi
  printf '%s %s' "$j" "$p"
}
echo "    ── 交替 ${SCROLL_ROUNDS} 轮（取中位——单轮读数在本机不可信，见脚本注释）──"
CORE_P=""; NAT_P=""; CORE_J=""; NAT_J=""
for r in $(seq 1 "$SCROLL_ROUNDS"); do
  read -r cj cp <<< "$(gfx_one scroll-core "$r")"
  read -r nj np <<< "$(gfx_one scroll-native "$r")"
  echo "      轮$r  Proteus p50=${cp}ms/Janky=${cj}%   原生 p50=${np}ms/Janky=${nj}%"
  CORE_P="$CORE_P $cp"; NAT_P="$NAT_P $np"; CORE_J="$CORE_J $cj"; NAT_J="$NAT_J $nj"
done
python3 - "$CORE_P" "$NAT_P" "$CORE_J" "$NAT_J" <<'PYAB' | tee "$DEST/scroll-ab.txt" | sed 's/^/      /'
import statistics, sys
def med(s):
    xs = [float(x) for x in s.split() if x]
    return statistics.median(xs) if xs else -1.0
cp, np_, cj, nj = med(sys.argv[1]), med(sys.argv[2]), med(sys.argv[3]), med(sys.argv[4])
d = cp - np_
print(f"★ 中位：Proteus p50={cp:.0f}ms / Janky={cj:.2f}%   原生 p50={np_:.0f}ms / Janky={nj:.2f}%")
print(f"★ 差值：{'Proteus 更快' if d < 0 else '原生更快'} {abs(d):.0f}ms")
print("★ 双峰说明：本机单次读数落在两个离散状态（约 11/18ms 与 13/23ms）⇒ 只有中位可比")
PYAB
# ★★A/B 之后**必须再拉一次**按通路命名的产物（2026-09-29 修）：
#   取回报告的循环在第 253 行（run_one 段之后），而原生滚动对照（scroll-native）在**本段之后**才跑
#   ⇒ 原实现下 run 目录里的 layout-scroll-native.json 是**上一次运行**的残留
#     （本仓实测：拉到的是更早一次手动 shot-scroll-native 的数据——两者内容完全不同）。
#   同时取回滚动辅助观测。
for f in layout-scroll.json layout-scroll-core.json layout-scroll-native.json; do
  "$ADB" pull "/sdcard/Android/data/$PKG/files/$f" "$DEST/$f" >/dev/null 2>&1 || true
done

phase "gfxinfo 主滚动 + A/B 对照"
echo "==> 采集「核心驱动滚动」读数（复用池决策来自 Rust；与 iOS V12 同一条路）"
# ★与上面那条路径的差别：上面宿主自己算窗口（已收敛到核心，但报告字段是 §9.3 口径）；
#   本条是 scroll-core 专用路径，直接输出**核心决策 ↔ 平台执行**的对账读数。
"$ADB" shell "rm -f /sdcard/Android/data/$PKG/files/layout-scroll-core.json" >/dev/null 2>&1 || true
"$ADB" shell am force-stop "$PKG" >/dev/null 2>&1; sleep 1
"$ADB" shell am start -n "$ACTIVITY" --es path scroll-core >/dev/null 2>&1; sleep 3
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path scroll-core -p $PKG" >/dev/null 2>&1
# ★条件探测（不固定 sleep 盲等）：600 帧 ≈ 10s，给 60s 上限
SC_T=0
while [ "$SC_T" -lt 60 ]; do
  if "$ADB" shell "test -f /sdcard/Android/data/$PKG/files/layout-scroll-core.json" >/dev/null 2>&1; then break; fi
  sleep 3; SC_T=$((SC_T + 3))
done
"$ADB" pull "/sdcard/Android/data/$PKG/files/layout-scroll-core.json" "$DEST/layout-scroll-core.json" >/dev/null 2>&1 || true
if [ -f "$DEST/layout-scroll-core.json" ]; then
  python3 - "$DEST/layout-scroll-core.json" <<'PYSC'
import json, sys
d = json.load(open(sys.argv[1]))
core_acq = (d.get('core_stats') or {}).get('acquire_events', -1)
plat = d.get('rn_created', -1) + d.get('rn_reused', -1)
print(f"    预载区交换 {d.get('preload_swapped')}（forward 上{d.get('fwd_kept_above')}/下{d.get('fwd_kept_below')}"
      f" · backward 上{d.get('back_kept_above')}/下{d.get('back_kept_below')}）")
print(f"    层数恒定 {d.get('rn_max_active')} · 复用率 {d.get('rn_reuse_ratio')} · 每帧有界 {d.get('max_per_frame')}")
print(f"    ★账目对账：核心 acquire_events {core_acq} vs 平台 created+reused {plat}"
      f" → {'✅ 一致' if core_acq == plat else '❌ 不一致（宿主重判了？）'}")
print(f"    ★可见区缺行 {d.get('max_missing_in_visible')}（>0 ⇒ 核心认为存在的行宿主没建）")
PYSC
else
  echo "    ⚠ 未取回 layout-scroll-core.json（滚动未跑完？）"
fi

phase "scroll-core 通路"
echo "==> 汇总"
python3 - "$DEST" <<'PY'
import json, sys, glob, os, statistics
dest = sys.argv[1]
raw = open(os.path.join(dest, 'raw.txt')).read().strip().splitlines()
rows = [l.split('|') for l in raw if l.strip()]

def cpu_class(c):
    """cpu6/7 = 4.6GHz 超大核；其余 = 普大核"""
    try: n = int(c)
    except: return '?'
    return 'prime' if n >= 6 else 'normal'

print(f"{'轮次':<6}{'通路':<28}{'PSS增量(KB)':<14}{'CPU分类':<28}{'温度变化'}")
print('-' * 92)
prime_warn = []
for r in rows:
    idx, label, pb, pa, cpus, tb, ta = r[0], r[1], r[2], r[3], r[4], r[5], r[6]
    delta = (int(pa) - int(pb)) if pb.isdigit() and pa.isdigit() else -1
    cls = [cpu_class(c) for c in cpus.split(',') if c.strip()]
    primen = cls.count('prime')
    tag = f"prime×{primen}/{len(cls)}" if cls else '?'
    if primen > len(cls) / 2: prime_warn.append(label)
    print(f"{idx:<6}{label:<28}{delta:<14}{tag:<28}{tb}→{ta}")

# ★★内存读数以 **app 自报的 pss_delta_kb** 为准（自包含窗口），
#   不再用脚本侧 before/after（那个窗口里串了 conformance + bench，读数会虚涨）
import collections, glob
agg = collections.defaultdict(list)
for f in glob.glob(os.path.join(dest, 'layout-*-only.json')) + glob.glob(os.path.join(dest, 'layout-proteus-only.json')):
    try:
        j = json.load(open(f))
        path = j.get('path', '')
        if 'pss_delta_kb' in j:
            agg[path].append(j['pss_delta_kb'])
    except Exception:
        pass
# 兜底：若 app 自报不可用，回落到脚本侧（并标注口径）
if not agg:
    for r in rows:
        if 'first-install' in r[1] or not (r[2].isdigit() and r[3].isdigit()):
            continue
        agg['(脚本侧口径) ' + r[1].split('-')[0]].append(int(r[3]) - int(r[2]))

print()
print("═══ 增量内存汇总（§9.2 · **app 自报的自包含窗口**）═══")
for k, v in agg.items():
    print(f"  {k}: 均值 {int(statistics.mean(v))} KB（{v}）")
pm = agg.get('proteus-mem', []) or agg.get('proteus', [])
nv = agg.get('native', [])
if pm and nv:
    p_, n_ = statistics.mean(pm), statistics.mean(nv)
    ratio = p_ / n_ if n_ else -1
    verdict = '✓ 达标（≤原生×0.8）' if ratio <= 0.8 else ('△ 合格（≤原生）' if ratio <= 1.0 else '✗ 不达标')
    print(f"  → 比值 proteus/native = {ratio:.3f}  {verdict}")
    print(f"     绝对值：Proteus {int(p_)} KB ({p_/1024:.1f} MB) · 原生 {int(n_)} KB ({n_/1024:.1f} MB)")

# ★§9.3 帧率判读（以系统 gfxinfo 为准）
print()
print("═══ §9.3 帧率（系统 dumpsys gfxinfo）═══")
gfx_path = os.path.join(dest, 'gfxinfo.txt')
if os.path.exists(gfx_path):
    gfx = open(gfx_path).read()
    import re
    for pat, label in [(r'Total frames rendered: (\d+)', '总帧数'),
                       (r'Janky frames: (\d+) \(([\d.]+)%\)', '掉帧'),
                       (r'50th percentile: (\d+)ms', 'p50 绘制'),
                       (r'95th percentile: (\d+)ms', 'p95 绘制'),
                       (r'Slow UI thread: (\d+)', 'UI 线程慢')]:
        m = re.search(pat, gfx)
        if m:
            print(f"  {label}: {' '.join(m.groups())}")
    print("  （系统以 60Hz 为基准判定 Janky；本机为 120Hz 屏，故该比例偏保守）")
else:
    print("  ⚠ 未采集到 gfxinfo")

# ★最终核判定以 **app 自报的 layout-env.json** 为准（脚本侧采样只能代表瞬时）
print()
print("═══ §9.3 滚动对照（★权威口径 dumpsys gfxinfo，各自 reset 后单独跑）═══")
def gfx(path):
    if not os.path.exists(path):
        return None
    out = {}
    for line in open(path, encoding='utf-8', errors='replace'):
        line = line.strip()
        if line.startswith('Total frames rendered'):
            out['frames'] = line.split(':')[1].strip()
        elif line.startswith('Janky frames:'):   # ★实测格式是 `Janky frames: 387 (64.18%)`
            out['janky'] = line.split(':', 1)[1].strip()
        elif 'percentile' in line and ':' in line:
            k, v = line.split(':', 1)
            out[k.replace('th percentile', '').strip()] = v.strip()
        elif line.startswith('Number Slow issue draw commands'):
            out['slow_draw'] = line.split(':')[1].strip()
    return out
gp = gfx(os.path.join(dest, 'gfxinfo.txt'))
# ★原生 gfxinfo：以前这里读 `gfxinfo-native.txt`——**该文件从来没有任何代码写它**
#   ⇒ 对照永远走 else 分支报「缺 gfxinfo」。现从 A/B 逐轮产物取最后一轮的真实 dump。
nat_cands = sorted(glob.glob(os.path.join(dest, 'gfxinfo-scroll-native-r*.txt')))
gn = gfx(nat_cands[-1]) if nat_cands else None
if gp and gn:
    print(f"  {'指标':<22}{'Proteus':<20}{'原生 View':<20}判读")
    print('  ' + '-' * 78)
    for key, label in [('frames','总帧数'), ('janky','Janky'), ('50','p50 绘制'),
                       ('90','p90'), ('95','p95'), ('99','p99'), ('slow_draw','Slow issue draw')]:
        a, b = gp.get(key, '-'), gn.get(key, '-')
        print(f"  {label:<22}{str(a):<20}{str(b):<20}")
    print("  ★判读：p50 越低越好；Janky 比例是**掉帧占全部渲染帧**的比重")
    print("  ★若 Proteus 的 p50 明显高于原生 ⇒ 差值**是本框架引入的**（不是设备上限）")
else:
    print("  ⚠ 缺 gfxinfo（Proteus 或原生）——对照不完整")

print()
print("═══ §9.2 核判定（以 app 自报为准）═══")
import glob
env_files = sorted(glob.glob(os.path.join(dest, 'layout-env.json')))
if not env_files:
    print("  ⚠ 未取到 app 自报的 env 报告（layout-env.json）——核判定无法确认")
else:
    for ef in env_files:
        try:
            e = json.load(open(ef))
            p_, n_ = e.get('prime_count', 0), e.get('normal_count', 0)
            tiers = e.get('tiers', 0)
            fastest = e.get('fastest_khz', 0)
            # ★★判定口径更正（honor10 实测）：**按本机档数解读**，不写死"含最快档=作废"
            #
            # 【为什么原判据在 honor10 上误报】原判据是"prime_count > 0 ⇒ 作废"，
            #   那是为 Redmi（**三档**：小核/普大核/超大核）写的——落在"超大核"说明作弊。
            #   而 honor10 是**两档**（A53 + A73）：cpu4-7 就是它**唯一的快档**，
            #   主线程落在那儿是**正常的**（没有第三档可落）⇒ 报"作废"是误判。
            #   ⇒ 正解：判据重述为「**主线程只落在最快档，且本机存在多档**」
            #     ——两档设备上这就是合规；三档设备上落在"最快档"仍需人工判读（见 §9.2 原意）。
            if tiers == 0:
                tag = '? 档数未知（读不到频率）'
            elif tiers == 1:
                tag = '✓ 单档设备（无快慢之分）'
            elif p_ == len([c for c in (e.get('observed_cpus') or []) if c >= 0]):
                tag = f'○ 全部落在**最快档**（本机 {tiers} 档 · 最快 {fastest}kHz）——须人工判读是否为"唯一快档"'
            else:
                tag = f'✓ 落在非最快档（本机 {tiers} 档）—— 无作弊嫌疑'
            print(f"  {e.get('path','?'):<14} cpus={e.get('observed_cpus')} → {tag}")
        except Exception as ex:
            print(f"  ✗ 解析 {os.path.basename(ef)} 失败：{ex}")
PY
phase "汇总与报告"

# ★★跑后产物自检（2026-09-29，用户反馈「每次跑完才发现装置有问题」）：
#   把「人工翻产物判断这次能不能用」变成**机器断言**——帧数是否为 0、p50 是否可疑、
#   A/B 两侧是否齐备、对照是否真跑了…当场给出「本次运行可不可信」。
echo
node "$HERE/check-run-artifacts.mjs" "$DEST" || {
  echo "  ⚠ 自检发现硬伤（见上 ❌）——**这份数据不要当结论**，修掉后重跑"
}
phase_summary

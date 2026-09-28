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
#   --fresh-install  ★破坏性：卸载后重装（仅用于「初次安装 vs 闲时优化」对照；默认增量安装）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
ACTIVITY="$PKG/.MainActivity"
OUT="$HERE/results/acceptance"
RUNS=5

while [ $# -gt 0 ]; do
  case "$1" in
    --runs) RUNS="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --fresh-install) FRESH_INSTALL=1; shift ;;
    *) echo "未知参数：$1"; exit 2 ;;
  esac
done

mkdir -p "$OUT"

if [ -z "${SKIP_BUILD:-}" ]; then
  echo "==> 构建 release 包（§9.2 要求）"
  bash "$HERE/build-and-run.sh" --no-install --release 2>&1 | grep -E "构建模式|class 文件|✗" | head -5
fi
APK="$HERE/build/proteus-layoutcore.apk"
[ -f "$APK" ] || { echo "✗ APK 不存在：$APK"; exit 2; }

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
run_one() {
  local path="$1" label="$2" idx="$3"
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
  "$ADB" shell am broadcast -a dev.proteus.RUN --es path "$path" -p "$PKG" >/dev/null 2>&1
  # ★核判定以 **app 自报**为准（脚本侧读别的进程 /proc 受限，本仓实测恒得同一值）；
  #   脚本侧仅作粗采样参考
  local cpus=""
  for _ in 1 2 3; do
    cpus="$cpus $(main_thread_cpu "$pid")"
    sleep 0.3
  done
  sleep 2
  local pss_after; pss_after="$(pss_of "$pid")"
  local t_after; t_after="$(max_temp)"

  echo "  轮次 ${idx}（${label}）：PSS ${pss_before}→${pss_after} KB · CPU采样:${cpus} · 温度 ${t_before}→${t_after}"
  # 记录原始数据（供汇总）
  echo "$idx|$label|$pss_before|$pss_after|$(echo $cpus | tr ' ' ',')|$t_before|$t_after" >> "$OUT/raw.txt"
}

echo
echo "═══ 正式验收开始（runs=${RUNS}）═══"
echo "核心频率：$(core_max_freq)"
echo "（★核心档位**按实测频率分档**，不写死核号——见 core_max_freq 注释。§9.2：主线程落在**最快档且存在更快档**时数据作废）"
echo

rm -f "$OUT/raw.txt"

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

# ★§9.2 第二行指标：不拍平时的耗时（拍平只对静态子树生效，动态内容走这条路径）
echo "── 通路：proteus-noflatten（§9.2「不拍平」指标）──"
run_one "proteus-noflatten" "proteus-noflatten" 1

# ★§9.3 长列表验收：4000 行滚到底再回滚（复用池 + 内存收敛）
echo "── 通路：recycle（§9.3 长列表）──"
run_one "recycle" "recycle" 1

echo
echo "==> 取回报告"
DEST="$OUT/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"
for f in layout-report.txt layout-conformance.json layout-bench.json layout-compare-native.json layout-native-only.json layout-proteus-only.json layout-noflatten.json layout-recycle.json layout-memory.json layout-env.json layout-hit.json; do
  "$ADB" shell "run-as $PKG cat files/$f" >/dev/null 2>&1 && continue   # debug 包兼容
  # ★release 包：从外置存储拉（getExternalFilesDir）
  "$ADB" pull "/sdcard/Android/data/$PKG/files/$f" "$DEST/$f" >/dev/null 2>&1 || true
done
cp "$OUT/raw.txt" "$DEST/raw.txt"
echo "    报告目录：$DEST"
ls -1 "$DEST" | head -10

echo
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
if [ -n "$TRACE" ]; then
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
fi   # ← 结束 `if [ -n "$TRACE" ]`（无可用路径时整段跳过）

echo "==> 采集系统帧率读数（§9.3 权威口径：dumpsys gfxinfo）"
GFX="$DEST/gfxinfo.txt"
# ★必须先 reset，否则 gfxinfo 是**进程生命周期累计**（含冷启动画面），与滚动无关
"$ADB" shell "dumpsys gfxinfo $PKG reset" >/dev/null 2>&1
echo "    → gfxinfo 已 reset；触发滚动验收…"
"$ADB" shell am force-stop "$PKG" >/dev/null 2>&1; sleep 1
"$ADB" shell am start -n "$ACTIVITY" --es path scroll >/dev/null 2>&1; sleep 3
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path scroll -p $PKG" >/dev/null 2>&1
sleep 16
"$ADB" shell "dumpsys gfxinfo $PKG" 2>/dev/null | tr -d '\r' > "$GFX"
grep -E "Total frames rendered|Janky frames \(|50th percentile|90th percentile|95th percentile|99th percentile|Slow UI thread|Slow issue draw commands|Slow bitmap uploads" "$GFX" | sed 's/^/    /'
# 同时取回滚动辅助观测
"$ADB" pull "/sdcard/Android/data/$PKG/files/layout-scroll.json" "$DEST/layout-scroll.json" >/dev/null 2>&1 || true

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

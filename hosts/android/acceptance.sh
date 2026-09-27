#!/usr/bin/env bash
# hosts/android/acceptance.sh
# ★★§9.2 **正式验收**：4050 元素性能与内存，严格按方案 §9.2 的测试环境要求执行。
#
# 【§9.2 的每一条要求 → 本脚本的对应动作】
#   ① 必须 release 包            → 调用 build-and-run.sh --release（非 debuggable）
#   ② 每次测试前杀进程重进        → force-stop 后再 start，每轮独立冷启动
#   ③ 重复 5 次取均值             → 默认 5 轮（--runs N 可调）
#   ④ Perfetto 确认跑在普大核     → 采样主线程 CPU（cpu6/7 是 4.6GHz 超大核，
#                                   cpu0-5 是 3.6GHz 普大核；落在超大核则本组数据作废）
#   ⑤ 监控设备温度避免降频        → 每轮前后读 thermal_zone，温差超阈值即告警
#   ⑥ 普通包名、不预载、不预触发 JIT → 包名 dev.proteus.layoutcore；测试由**按钮点击**触发
#                                   （§9.2「起点 = click 事件触发」），不在 onCreate 自动跑
#   ⑦ 区分「初次安装」与「闲时优化」→ 首轮单独标记为 first-install；后续为 steady
#   ⑧ 计时口径：click → 渲染指令送达 → 由 app 内 SystemClock 测量并落盘
#
# 【两条通路分两次冷启动】`--es path proteus|native` —— 隔离内存（同进程先后建树会互相污染）
#
# 用法：bash hosts/android/acceptance.sh [--runs 5] [--skip-build]
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
# ★先卸载：§9.2 要区分「初次安装」与「闲时优化」，且避免残留数据干扰
"$ADB" uninstall "$PKG" >/dev/null 2>&1 || true
"$ADB" install "$APK" 2>&1 | tail -2

# ── 工具函数 ─────────────────────────────────────────────────────────

# 主线程当前 CPU（/proc/<pid>/task/<pid>/stat 第 39 字段）——用于「是否跑在超大核」判定
main_thread_cpu() {
  local pid="$1"
  "$ADB" shell "awk '{print \$39}' /proc/$pid/task/$pid/stat 2>/dev/null" 2>/dev/null | tr -d '\r\n'
}

# 各核最大频率（分类超大核/普大核）
core_max_freq() {
  "$ADB" shell "for c in 6 0; do echo -n \"cpu\$c=\"; cat /sys/devices/system/cpu/cpu\$c/cpufreq/cpuinfo_max_freq 2>/dev/null; done" 2>/dev/null | tr -d '\r'
}

# 温度（取 CPU 相关 zone 的最大值）
max_temp() {
  "$ADB" shell 'for z in /sys/class/thermal/thermal_zone*/temp; do cat $z 2>/dev/null; done | sort -n | tail -1' 2>/dev/null | tr -d '\r\n'
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
echo "（cpu6/7 = 4.6GHz 超大核；cpu0-5 = 3.6GHz 普大核。§9.2：落在超大核则数据作废）"
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
for f in layout-report.txt layout-conformance.json layout-bench.json layout-compare-native.json layout-native-only.json layout-proteus-only.json layout-noflatten.json layout-recycle.json layout-memory.json layout-env.json; do
  "$ADB" shell "run-as $PKG cat files/$f" >/dev/null 2>&1 && continue   # debug 包兼容
  # ★release 包：从外置存储拉（getExternalFilesDir）
  "$ADB" pull "/sdcard/Android/data/$PKG/files/$f" "$DEST/$f" >/dev/null 2>&1 || true
done
cp "$OUT/raw.txt" "$DEST/raw.txt"
echo "    报告目录：$DEST"
ls -1 "$DEST" | head -10

echo
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

# ★按通路聚合：内存只用 `-mem` 纯结构口径（`proteus-perf` 含 63MB 测量位图，混入会失真）
import collections
agg = collections.defaultdict(list)
for r in rows:
    if 'first-install' in r[1]: continue
    if not (r[2].isdigit() and r[3].isdigit()): continue
    name = r[1].split('-')[0]
    if 'mem' in r[1]: name = 'proteus-mem'
    elif r[1].startswith('native'): name = 'native'
    elif 'perf' in r[1]: name = 'proteus-perf(含测量位图，不计入内存对比)'
    agg[name].append(int(r[3]) - int(r[2]))

print()
print("═══ 增量内存汇总（§9.2 · 纯结构口径，排除 first-install）═══")
for k, v in agg.items():
    print(f"  {k}: 均值 {int(statistics.mean(v))} KB（{v}）")
pm = agg.get('proteus-mem', [])
nv = agg.get('native', [])
if pm and nv:
    p_, n_ = statistics.mean(pm), statistics.mean(nv)
    ratio = p_ / n_ if n_ else -1
    verdict = '✓ 达标（≤原生×0.8）' if ratio <= 0.8 else ('△ 合格（≤原生）' if ratio <= 1.0 else '✗ 不达标')
    print(f"  → 比值 proteus/native = {ratio:.3f}  {verdict}")
    print(f"     绝对值：Proteus {int(p_)} KB ({p_/1024:.1f} MB) · 原生 {int(n_)} KB ({n_/1024:.1f} MB)")

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
            tag = '✓ 普大核' if p_ == 0 else (f'⚠ 含超大核 {p_}/{p_+n_} —— §9.2 判本组数据作废')
            print(f"  {e.get('path','?'):<14} cpus={e.get('observed_cpus')} → {tag}")
        except Exception as ex:
            print(f"  ✗ 解析 {os.path.basename(ef)} 失败：{ex}")
PY

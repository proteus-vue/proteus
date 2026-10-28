#!/usr/bin/env bash
# hosts/harmony/run-vm-probe.sh —— ★★★#1342-A：**#540 决策门**，持久 VM 真机取证
#
# 【它回答什么（一个变量）】
#   跨 napi 调用复用同一个 JSVM，在当前 SDK（API 24 / HarmonyOS 6.1.1）到底还崩不崩？
#   `host_app_runtime_impl.h:19-21` 断言"必崩（决策 #540）"，但同 HAR 的持久壳 VM
#   （`proteus_host.cpp:23-28`，跨事件存活不销毁）真机已跑通 ⇒ 结论可能已过期。
#   这个探针严格复刻 HostAppBoot 的 VM 建立顺序，但**不销毁 VM**，每轮只开/关内层 HandleScope。
#
# 【三种结局（判定必须能区分——这是本脚本最要紧的地方）】
#   1. 有报告 + `ok:true`          ⇒ **持久 VM 可用** ⇒ 可以走 B（会话式 VM）
#   2. 有报告 + `ok:false`         ⇒ 探针某步失败（`firstFailureRound/Why` 指出来）
#   3. **无报告 + 进程消失**        ⇒ **持久 VM 崩溃**（SIGSEGV）⇒ #540 仍成立
#      ★必须查 hilog/cppcrash 才能得出这个结论：只看"没有报告"会误判成"脚本没跑起来"。
#
# 用法：
#   bash hosts/harmony/run-vm-probe.sh                 # 默认 plain · 1000 轮
#   bash hosts/harmony/run-vm-probe.sh --mode=ref --rounds=2000
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
HDC="$HERE/hdc.sh"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
BUNDLE="dev.proteus.host"
FILES_DEV="/data/storage/el2/base/haps/entry/files"
RESULTS="$HERE/results"

MODE="plain"
ROUNDS=1000
for arg in "$@"; do
  case "$arg" in
    --mode=*) MODE="${arg#--mode=}" ;;
    --rounds=*) ROUNDS="${arg#--rounds=}" ;;
    *) echo "未知参数：$arg（支持 --mode=plain|nav|ref · --rounds=N）"; exit 2 ;;
  esac
done

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$RESULTS"

HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(bash "$HDC" list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（${STATE}）"; exit 2 ;; esac
echo "==> hap=${HAP##*/}  设备=${STATE}  mode=${MODE}  rounds=${ROUNDS}"

echo "==> ① 安装 + 清场 + 删旧报告"
bash "$HDC" install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
bash "$HDC" shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
bash "$HDC" shell "hilog -r" >/dev/null 2>&1 || true
bash "$HDC" shell "rm -f $FILES_DEV/vm-probe.json" >/dev/null 2>&1 || true
if bash "$HDC" shell "test -f $FILES_DEV/vm-probe.json && echo STILL_EXISTS" 2>/dev/null | grep -q STILL_EXISTS; then
  echo "✗ 旧报告删不掉——等待信号会命中陈旧文件，拒绝继续"; exit 1
fi

echo "==> ② 启动（scene=superapp-vmprobe · mode=${MODE} · rounds=${ROUNDS}）"
# ★设备锁屏会导致启动失败（实测：Error 10106102「screen is locked」）⇒ 先唤醒，失败即给指引
if ! bash "$HDC" shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-vmprobe --ps vmRounds ${ROUNDS} --ps vmMode ${MODE}" 2>&1 | grep -qi "successfully"; then
  echo "✗ 启动失败。常见原因：屏幕锁定（本机实测过）⇒ 请解锁设备后重跑。"
  bash "$HDC" shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-vmprobe" 2>&1 | tail -3 | sed 's/^/  /'
  exit 1
fi

echo "==> ③ 等报告落盘（完成信号 = 文件存在；零盲等）"
if ! bash "$WAIT" --cmd "bash '$HDC' shell 'test -f $FILES_DEV/vm-probe.json && echo VM_PROBE_READY' | grep -q VM_PROBE_READY" --timeout 120 --interval 3; then
  echo "✗ 120s 内未见 vm-probe.json" >&2
  echo "  ★这不必然是失败——**持久 VM 崩溃时报告根本写不出来**（进程 SIGSEGV 直接死）。" >&2
  echo "  查崩溃证据：" >&2
  bash "$HDC" shell "hilog -x | grep -iE 'VM_PROBE|cppcrash|SIGSEGV|HandleScope|ProteusVmProbe' | tail -20" 2>&1 | sed 's/^/    /' >&2
  echo "  若上面出现 cppcrash/SIGSEGV ⇒ **#540 仍成立**（持久 VM 在当前 SDK 仍崩）。" >&2
  echo "  若什么都没有 ⇒ 先确认设备已解锁、hap 已装成功。" >&2
  exit 3
fi

echo "==> ④ 取回报告 + 判定"
rm -f "$RESULTS/vm-probe.json"
bash "$HDC" file recv "$FILES_DEV/vm-probe.json" "$RESULTS/vm-probe.json" >/dev/null 2>&1 \
  || { echo "✗ file recv 失败"; exit 1; }
[ -s "$RESULTS/vm-probe.json" ] || { echo "✗ 报告为空"; exit 1; }
echo "    vm-probe.json $(wc -c < "$RESULTS/vm-probe.json" | tr -d ' ') 字节"

python3 - "$RESULTS/vm-probe.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
ok = True
mode = d.get("mode"); rounds = d.get("rounds", 0); roundsOk = d.get("roundsOk", 0)
first = d.get("firstFailureRound", -1); why = d.get("firstFailureWhy") or ""
hb = d.get("heapBeforeKB", 0); ha = d.get("heapAfterKB", 0); grow = d.get("heapGrowthPct", 0)

print(f"  mode={mode} rounds={rounds} roundsOk={roundsOk}")
print(f"  heap: {hb:.1f}KB → {ha:.1f}KB（峰值 {d.get('heapPeakKB', 0):.1f}KB，增长 {grow:.1f}%）")
if first >= 0:
    print(f"  ✗ 第 {first} 轮失败：{why}")
    ok = False

# 判定 1：全部轮通过
if d.get("ok") is not True:
    print(f"  ✗ 探针 ok=false（error={d.get('error')}）"); ok = False
# 判定 2：轮数必须真跑满（防"跑 0 轮也报 ok"）
if roundsOk != rounds or rounds <= 0:
    print(f"  ✗ 未跑满：roundsOk={roundsOk} != rounds={rounds}"); ok = False
# 判定 3：堆增长 < 20%（否则是泄漏，即使没崩也不能持久化）
if grow is not None and grow > 20.0:
    print(f"  ✗ 堆增长 {grow:.1f}% > 20% ⇒ 有泄漏（持久 VM 会 OOM）"); ok = False
if ok:
    print(f"\n  ✅ **持久 VM 可行**：{rounds} 轮无崩溃、堆增长 {grow:.1f}%")
    print("  ⇒ #540 的结论在当前 SDK 已不成立（或已被后续纪律规避）⇒ 可以走 B（会话式 VM）")
    print("  ★但这只证明**本探针负载**下可行；接入完整 App runtime 前仍须再验一轮。")
sys.exit(0 if ok else 1)
PY
RC=$?
if [ "$RC" != "0" ]; then
  echo ""
  echo "  ⚠ 探针未通过 —— 按预定方案**停下来**评估，不要继续改 VM 调度模型。"
  echo "  三条候选路线（成本从低到高）："
  echo "    a) 维持一次性 VM + 策略层补偿（鸿蒙 cancel/stream/WS 长期如实不可用）"
  echo "    b) Worker 方案（拆 .so 为'纯 JSVM 运行时' + 'UI/渲染桥'，JS 跑 Worker 线程）"
  echo "    c) 换 JS 引擎（成本最高，动摇 G-29 编译器后端抽象）"
fi
exit "$RC"

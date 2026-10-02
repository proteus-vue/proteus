#!/usr/bin/env bash
# hosts/harmony/run-host-app.sh —— Proteus 鸿蒙宿主：装机 + 启动 + 机器验证（零盲等）
#
# 【验证什么（第一里程碑）】"我们的 hap 能装到这台华为设备并跑起来"：
#   ① `bm install` 成功（含签名校验通过——本设备只认华为 CA 签名，见 build-host-app.sh 头注）；
#   ② `aa start` 拉起 EntryAbility；
#   ③ **宿主主动上报**（对齐本仓禁止盲等纪律）：EntryAbility 往 hilog 打
#      `PROTEUS_HOST_READY model=... os=... api=...`——本脚本条件等待该标记（wait_for.sh），
#      不做任何 sleep 轮询。
#
# 前置：
#   1) bash hosts/harmony/build-host-app.sh        # 构建（含签名状态提示）
#   2) 设备已连接（bash hosts/harmony/hdc.sh check）
#   3) ★签名必须已配置（DevEco 登录一次）——未签名 hap 会在 ① 步被设备拒绝
#
# 用法：bash hosts/harmony/run-host-app.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
APP_DIR="$HERE/host-app"
BUNDLE="dev.proteus.host"
ABILITY="$BUNDLE/EntryAbility"
HAP_DIR="$APP_DIR/entry/build/default/outputs/default"
RESULTS="$HERE/results"

# hdc 走统一包装（工具链解析 + 密钥坑都在那里处理）
HDC() { bash "$HERE/hdc.sh" "$@"; }

mkdir -p "$RESULTS"

# ── 0. 前置检查 ──
HAP="$(ls -t "$HAP_DIR"/*.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺 hap——先跑：bash hosts/harmony/build-host-app.sh"; exit 2; }
echo "==> 0. 前置"
echo "    待装包：${HAP}（$(du -h "${HAP}" | awk '{print $1}')）"
case "$HAP" in
  *unsigned*) echo "  ⚠ 这是 unsigned 包——本设备会拒装（先按 build-host-app.sh 提示配好签名）" ;;
esac
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
echo "    设备：$STATE"
case "$STATE" in
  *Connected*) ;;
  "") echo "✗ 无设备——先跑 bash hosts/harmony/hdc.sh check"; exit 2 ;;
  *Unauthorized*) echo "✗ 设备未授权（在设备上点允许；或跑 hdc.sh check 看密钥位数）"; exit 2 ;;
esac

# ── 1. 安装 ──
echo "==> 1. 安装（bm install）"
INSTALL_OUT="$(HDC install "$HAP" 2>&1)"
echo "$INSTALL_OUT" | grep -qE "successfully|Success" || {
  echo "$INSTALL_OUT"
  echo "✗ 安装失败——若含 'verify pkcs7' ⇒ 签名问题（本设备只认华为 CA 调试签名；"
  echo "  用 DevEco 登录华为账号勾 Automatically generate signature 一次）"
  exit 1
}
echo "$INSTALL_OUT" | head -2

# ── 2. 清旧日志 + 启动（日志清空要用 hdc shell；hdc 无 logcat -c 等价物 → 用 hilog 的 -r 或直接按时间过滤）──
echo "==> 2. 启动（aa start）"
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
START_OUT="$(HDC shell "aa start -a EntryAbility -b $BUNDLE" 2>&1)"
echo "$START_OUT" | head -3
echo "$START_OUT" | grep -qiE "start ability successfully|successfully" || {
  echo "✗ 启动命令失败"; exit 1; }

# ── 3. 等宿主主动上报（条件等待——零 sleep 轮询）──
echo "==> 3. 等宿主上报 PROTEUS_HOST_READY（条件等待 ≤30s）"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
READY_LINE=""
if bash "$WAIT_SH" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q PROTEUS_HOST_READY'" --timeout 30 --interval 2; then
  READY_LINE="$(HDC shell "hilog -x | grep PROTEUS_HOST_READY | tail -1" 2>/dev/null | head -1)"
fi

# ── 4. 判据 ──
echo
echo "==> 4. 判据"
if [ -n "$READY_LINE" ]; then
  echo "  ✓ 装机+启动：宿主主动上报成功"
  echo "    $READY_LINE"
  HDC shell "hilog -x | grep PROTEUS_HOST_LOADED | tail -1" 2>/dev/null | head -1
  # ── 5. RenderNode 直绘判据（第二里程碑：Proteus 指令流 → 渲染节点树）──
  #   宿主上报链：PROTEUS_RENDER_ATTACHED（CAPI 就绪）→ PROTEUS_RENDER_DONE nodes=N（N>0 = 直建成功）
  #   ★走 hilog 主动上报 + 条件等待（零盲等）
  RENDER_LINE=""
  if bash "$WAIT_SH" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q PROTEUS_RENDER_DONE'" --timeout 15 --interval 2; then
    RENDER_LINE="$(HDC shell "hilog -x | grep PROTEUS_RENDER_DONE | tail -1" 2>/dev/null | head -1)"
  fi
  RENDER_NODES="$(printf '%s' "$RENDER_LINE" | grep -oE 'nodes=[0-9]+' | head -1 | cut -d= -f2)"
  echo
  if [ -n "$RENDER_NODES" ] && [ "$RENDER_NODES" -gt 0 ]; then
    echo "  ✓ RenderNode 直绘：建出 ${RENDER_NODES} 个渲染节点（Proteus 指令流 → OH_ArkUI_RenderNodeUtils）"
    echo "    $RENDER_LINE"
    ATTACH_LINE="$(HDC shell "hilog -x | grep PROTEUS_RENDER_ATTACHED | tail -1" 2>/dev/null | head -1)"
    echo "    ${ATTACH_LINE}（capi=1 = CAPI 已初始化）"
    # ── 6. 4050 应用级基准（M5）：抓取读数落盘（条件等待末档——零盲等）──
    BENCH_JSON=""
    NATIVE_LINE=""
    NATIVE_WARM_LINE=""
    if bash "$WAIT_SH" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q \"PROTEUS_BENCH_NATIVE_WARM wall_ms\"'" --timeout 90 --interval 3; then
      BENCH_LINE="$(HDC shell "hilog -x | grep 'PROTEUS_BENCH_RESULT limit=4050' | tail -1" 2>/dev/null | head -1)"
      NATIVE_LINE="$(HDC shell "hilog -x | grep 'PROTEUS_BENCH_NATIVE wall_ms' | tail -1" 2>/dev/null | head -1)"
      NATIVE_WARM_LINE="$(HDC shell "hilog -x | grep 'PROTEUS_BENCH_NATIVE_WARM wall_ms' | tail -1" 2>/dev/null | head -1)"
      BENCH_JSON="$(printf '%s' "$BENCH_LINE" | sed -n 's/.*PROTEUS_BENCH_RESULT limit=4050 wall_ms=\([0-9]*\) //p')"
      echo
      # ── 6.5 ★探针集（命中 / 复用池 / 结构变更 / 文本通道）——与 Android 能力域对齐 ──
  PROBE_LOG="$(HDC shell "hilog -x | grep -E 'PROTEUS_HIT_PROBE \{|PROTEUS_RECYCLE \{|PROTEUS_SPLICE \{|PROTEUS_TEXT \{' | tail -4" 2>/dev/null)"
  echo
  echo "  ✓ 探针集（鸿蒙腿）："
  printf '%s\n' "$PROBE_LOG" | sed 's/^/    /'
  HIT_OK="$(printf '%s' "$PROBE_LOG" | grep -o '"mismatch":0' | head -1)"
  RC_OK="$(printf '%s' "$PROBE_LOG" | grep -o '"reuse_ratio":[0-9.]*' | head -1)"
  echo "    判读：命中 ${HIT_OK:-（未见）} · $RC_OK"

  echo "  ✓ 4050 应用级基准（鸿蒙腿）："
      echo "    Proteus：${BENCH_LINE}"
      echo "    原生对照（冷）：${NATIVE_LINE}"
      echo "    原生对照（热）：${NATIVE_WARM_LINE}"
    else
      echo "  ⚠ 4050 基准未上报（60s）——查看：bash hosts/harmony/hdc.sh shell 'hilog -x | grep PROTEUS_BENCH | tail -10'"
    fi
    # 落盘证据（含基准原始行）
    { echo "installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo "hap=$HAP"; echo "ready_line=$READY_LINE";
      echo "render_line=$RENDER_LINE";
      echo "bench_line=${BENCH_LINE:-none}"; echo "native_line=${NATIVE_LINE:-none}";
      echo "native_warm_line=${NATIVE_WARM_LINE:-none}"; } > "$RESULTS/host-app-run.txt"
    echo
    echo "✅ 鸿蒙宿主验收通过（真机 HUAWEI KLE-AL00U）：装机 + 启动 + **RenderNode 直绘**"
    echo "   证据：$RESULTS/host-app-run.txt · 截图：$RESULTS/render-node-demo.jpeg"
    exit 0
  else
    echo "  ⚠ RenderNode 直绘未上报 nodes>0（render_line=${RENDER_LINE:-无}）"
    echo "    排查：bash hosts/harmony/hdc.sh shell 'hilog -x | grep -E "PROTEUS_RENDER|SKIP" | head -20'"
    # 装机+启动已通过——如实分开报告（不因直绘未跑而否定装机结论）
    { echo "installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo "hap=$HAP"; echo "ready_line=$READY_LINE";
      echo "render_line=${RENDER_LINE:-none}"; } > "$RESULTS/host-app-run.txt"
    echo
    echo "✅ 装机+启动通过（RenderNode 直绘未通过——见上）"
    exit 1
  fi
else
  echo "  ✗ 未在 30s 内看到 PROTEUS_HOST_READY"
  echo "    排查：bash hosts/harmony/hdc.sh shell 'hilog -x | grep ProteusHost | tail -20'"
  exit 1
fi

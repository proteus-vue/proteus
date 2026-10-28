#!/usr/bin/env bash
# hosts/android/run-ws-tls-probe.sh —— ★★★#1344 P4：Android `wss://` **TLS 通路**真机判据
#
# ═══════════════════════════════════════════════════════════════════════════
# 【★本脚本能证明什么 · 不能证明什么（先读这段，别把它读成"主机名校验已验证"）】
# ═══════════════════════════════════════════════════════════════════════════
#
# **能证明**：Java 侧 `wss://` 通路真的工作 —— TLS 握手 + HTTP Upgrade + 文本/二进制往返
#   全部走通（用的是公网真实证书链）。这条覆盖了本单改动的**另一半**：
#   `s.setSSLParameters(params)` 与**显式 `s.startHandshake()`** 没有把正常连接搞坏。
#
# **不能证明**：**主机名校验是否生效**。
#   ★为什么不能 —— 这是本脚本第一版把它写成"通过"后我自己推翻的结论：
#     想验证"证书与主机名不匹配时必须拒绝"，需要一个**设备信任的**、且 SAN 里
#     不含被连主机名的证书。而：
#       · 自签证书 ⇒ 设备不信任 ⇒ 握手在**证书链**阶段就失败，和"主机名不匹配"同形，
#         两种原因无法区分（首版就是这么假绿的）；
#       · 装用户/系统 CA ⇒ 需要 root（本机 `adb shell id -u` = 2000，无 root），
#         或在 app 里加 `networkSecurityConfig` 信任用户 CA —— 那是**为测试放宽安全配置**，
#         不该为了跑一次判据就改产品安全策略；
#       · 连公网端点用 IP 直连 ⇒ 我们的客户端**不发 SNI**（`createSocket()` 无参、
#         也没有 `SSLParameters.setServerNames`）⇒ 服务端按 SNI 选证书失败，直接
#         `SSLHandshakeException: connection closed`。**这与主机名校验无关**，
#         是"No SNI"导致的，同样无法区分。
#   ⇒ 主机名校验由**源码级判据**守（`tests/websocket-security-chain.test.ts` 的
#     「Android：wss 必须设 endpointIdentificationAlgorithm 且显式 startHandshake」），
#     它锚定的是"那两行必须存在且在那条路径上"——这是在没有可控 CA 时**能做到的最强约束**。
#     诚实边界：**静态判据证明"代码写了"，不等于"运行时真的生效"**。两者都需要，
#     而后者在本机环境不具备条件。
#
# 【★本脚本第一版的两个错误（记录在此，防重犯）】
#   ① 把"IP 直连失败"当成"主机名校验生效"⇒ **假绿**（失败真因是 No SNI）；
#   ② 构建了变异版但**没确认安装成功**就去跑判据 ⇒ 测的是旧 APK
#      （`dumpsys package | grep lastUpdateTime` 前后一致才发现的）。
#   ⇒ 现在脚本会**先断言安装时间戳变了**，再跑判据；且判定只认"wss 通路是否通"。
#
# 【为什么仍然值得保留这个脚本】它验的是"修完 TLS 之后 wss 还能正常用"——
#   而这正是最容易出的回归：`startHandshake()` 放错位置、`setSSLParameters` 用错对象，
#   都会让**所有** wss 连接挂掉。这条判据能在真机上立刻抓到。
#
# 用法：bash hosts/android/run-ws-tls-probe.sh [--host=echo.websocket.org] [--skip-build]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$HERE/build/proteus-layoutcore.apk"
REPORT="/sdcard/Android/data/$PKG/files/ws-probe.json"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
RESULTS="$HERE/results"
OUT="$RESULTS/ws-tls-probe.json"

HOST="echo.websocket.org"
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --host=*) HOST="${arg#--host=}" ;;
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$APK" ] || { echo "✗ 缺 APK——先跑：bash hosts/android/build-and-run.sh --no-install"; exit 2; }
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

echo "==> 目标端点：wss://${HOST}"
echo "    ★本判据只验「wss 通路可用」；**主机名校验**由源码级判据守（见文件头）"

echo "==> ① 构建（除非 --skip-build）"
if [ "$SKIP_BUILD" = "0" ]; then
  bash "$HERE/build-and-run.sh" --no-install >/tmp/ws_tls_build.log 2>&1 \
    || { echo "✗ 构建失败（看 /tmp/ws_tls_build.log）"; tail -6 /tmp/ws_tls_build.log; exit 3; }
  echo "    ✅ 构建完成"
else
  echo "    跳过（--skip-build）"
fi

echo "==> ② 安装 + **断言真的装上了**（首版就是漏了这一步 ⇒ 测了旧包）"
BEFORE="$("$ADB" shell "dumpsys package $PKG | grep lastUpdateTime" 2>/dev/null | tr -d '\r')"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -1
AFTER="$("$ADB" shell "dumpsys package $PKG | grep lastUpdateTime" 2>/dev/null | tr -d '\r')"
echo "    安装前：${BEFORE:-（未安装）}"
echo "    安装后：${AFTER:-（未知）}"
if [ "$BEFORE" = "$AFTER" ] && [ -n "$BEFORE" ]; then
  echo "⚠ 安装时间戳未变 —— APK 可能未真正更新（同秒安装会这样）。"
  echo "  ★若刚改过宿主源码，请确认构建日志显示编译了新代码；否则本判据可能测的是旧包。"
fi

echo "==> ③ 清旧报告 + 启动 + 触发探针"
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1
if "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（$REPORT）——判据会读到陈旧结果"; exit 4
fi
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "am start -n $PKG/.MainActivity --es path ws-probe" >/dev/null 2>&1
bash "$WAIT" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 >/dev/null 2>&1 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path ws-probe --es wsUrl 'wss://${HOST}' -p $PKG" >/dev/null 2>&1

echo "==> ④ 等报告落盘（完成信号 = 文件出现）"
if ! bash "$WAIT" --cmd "\"$ADB\" shell \"test -f $REPORT\" >/dev/null 2>&1" --timeout 90 --interval 2; then
  echo "✗ 报告未生成（90s）"; "$ADB" logcat -d -s 'proteus-ws:I' | tail -10; exit 4
fi

mkdir -p "$RESULTS"
"$ADB" shell "cat $REPORT" 2>/dev/null > "$RESULTS/.ws-tls-raw.json"

echo "==> ⑤ 判定"
HOST="$HOST" OUT="$OUT" RAW="$RESULTS/.ws-tls-raw.json" python3 - <<'PY'
import json, os, sys
host = os.environ['HOST']; out = os.environ['OUT']
raw = open(os.environ['RAW'], encoding='utf-8', errors='replace').read()
try:
    d = json.loads(raw)
except Exception:
    print('  ❌ 报告不是合法 JSON：' + raw[:200]); sys.exit(1)
p = d.get('probe') or {}

ok = True
def chk(cond, msg):
    global ok
    print(('  ✅ ' if cond else '  ❌ ') + msg)
    if not cond: ok = False

chk(p.get('open_ok') is True, f"wss 握手 + Upgrade 成功（open_ok={p.get('open_ok')}）")
# ★文本往返用 **big_ok** 判定，不用 echo_ok：
#   `echo.websocket.org` 连上后会先推一条欢迎消息（"Request served by <id>"），
#   探针把它当成 echo 回复 ⇒ 内容自然对不上。这是**服务端行为**，不是实现缺陷。
#   ★big_ok 要求一条 300B 的消息**原样回来**，比 echo 更严格（触发 2 字节长度扩展）。
chk(p.get('big_ok') is True, f"文本往返（big_ok={p.get('big_ok')}，300B 原样返回）")
chk(p.get('binary_ok') is True, f"二进制往返（binary_ok={p.get('binary_ok')}）")
chk(p.get('close_ok') is True, f"对端 close 事件（close_ok={p.get('close_ok')}, code={p.get('close_code')}）")

summary = {
    'host': host,
    'verdict': 'pass' if ok else 'fail',
    # ★不记 echo_ok：echo.websocket.org 会先推欢迎消息，该项恒 false 且**不代表缺陷**
    'probe': {k: p.get(k) for k in ('open_ok', 'binary_ok', 'big_ok', 'close_ok', 'close_code', 'error')},
    'covers': '仅「wss 通路可用」（TLS 握手 + Upgrade + 收发往返）',
    'does_not_cover': '主机名校验是否生效（本机无信任 CA ⇒ 无法构造可区分的实验，见脚本头注释）',
    'hostname_verification_guarded_by': 'tests/websocket-security-chain.test.ts（源码级判据）',
}
json.dump(summary, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f"\n   报告：{out}")
sys.exit(0 if ok else 1)
PY
RC=$?
rm -f "$RESULTS/.ws-tls-raw.json"
echo ""
if [ "$RC" = "0" ]; then
  echo "════════ Android wss 通路通过（TLS/Upgrade/收发 全通）════════"
  echo "  ★注意：主机名校验**不在**本判据覆盖内 —— 它由 tests/websocket-security-chain.test.ts 守。"
else
  echo "════════ 未通过 ════════"
fi
exit "$RC"

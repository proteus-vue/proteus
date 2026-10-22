#!/usr/bin/env bash
# hosts/android/run-body-probe.sh —— ★★★决策 #1160：**POST/PUT 带请求体**的真机判据（Android）
#
# 【它证明什么（缺一即红）】整包路径（`perform`）真的把请求体发出去了：
#   ① POST 的体**逐字节**到达（服务端回 length / sha / 首末字节）
#   ② 体**不是空**（空体 ⇒ length=0 ≠ 期望 ⇒ 红）——这正是 #1160 第一版的 P0
#   ③ `Content-Type` 按调用方给的落地
#   ④ GET（无体）仍成功（体被错挂到 GET 会让 OkHttp 抛 IllegalArgumentException）
#   ⑤ PUT 同样带体成功（防"只对 POST 特判"）
#
# 【为什么需要这条（用例空白）】换栈第一版漏了整包路径的 `cfg.body` ⇒ Android 所有带 `data`
#   的 POST/PUT 静默变空体，而当时四条真机探针全是 GET/上传 ⇒ 9 组回归全绿、功能已坏。
#   ⇒ 本脚本填的就是这个覆盖洞。
#
# 【装置】本地 HTTP 服务（`transfer-echo-server.mjs` 的 /body-echo 端点）+ adb reverse
#   ——全走 127.0.0.1，不经公网（公网限流会与"宿主腿有 bug"混淆）。
#
# 用法：bash hosts/android/run-body-probe.sh [port]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PORT="${1:-}"
PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
REPORT="/sdcard/Android/data/$PKG/files/body-probe.json"
LOCAL_REPORT="$HERE/results/body-probe.json"
SERVER_LOG="$HERE/results/body-probe-server.log"
mkdir -p "$HERE/results"

[ -f "$APK" ] || { echo "✗ 找不到 APK：${APK}（先 build，或用 PROTEUS_APK= 指路径）"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

# ★端口不写死（写死会撞别的进程/上次残留）——与 run-transport-probe.sh 同口径
pick_free_port() {
  local p="$1"
  while [ "$p" -lt $(( $1 + 100 )) ]; do
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 || { printf '%s' "$p"; return 0; }
    p=$((p + 1))
  done
  return 1
}
if [ -z "$PORT" ]; then PORT="$(pick_free_port 8795)" || { echo "✗ 找不到空闲端口"; exit 3; }; fi

echo "==> ① 起本地服务（port ${PORT}）"
node "$HERE/tools/transfer-echo-server.mjs" "$PORT" 0.0.0.0 > "$SERVER_LOG" 2>&1 &
SRV=$!
cleanup() {
  kill "$SRV" 2>/dev/null || true
  "$ADB" reverse --remove "tcp:${PORT}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务未就绪（见 ${SERVER_LOG}）"; exit 3
fi
echo "    服务已就绪"

echo "==> ② adb reverse（设备 127.0.0.1:${PORT} → 本机 ${PORT}）"
"$ADB" reverse "tcp:${PORT}" "tcp:${PORT}" >/dev/null 2>&1 || { echo "✗ adb reverse 失败"; exit 3; }

echo "==> ③ 安装 + 触发 body-probe"
# ★`|| true` 必须有：`set -euo pipefail` 下 `grep` 无匹配会终止脚本
#   （本仓踩过同族：iOS 安装失败原因被 `grep|head` 在 pipefail 下静默吞掉）
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（${REPORT}）——判据会读到陈旧结果"; exit 4
fi
# ★★参数必须走 `am start --es`（进**启动 intent**）——广播的 extra 不会进 getIntent()
"$ADB" shell "am start -n $PKG/.MainActivity --es path body-probe --es base 'http://127.0.0.1:${PORT}'" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path body-probe -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 180 --interval 1 --max-interval 3; then
  echo "✗ 报告未生成——看 logcat / 服务日志"
  tail -20 "$SERVER_LOG" || true
  exit 4
fi

"$ADB" pull "$REPORT" "$LOCAL_REPORT" >/dev/null 2>&1 || { echo "✗ 拉取报告失败"; exit 4; }

echo "==> ④ 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const p = r.probe || {}
const checks = [
  ['探针已启动', String(r.probe_kick || '').includes('started')],
  ['★★POST 体长 = 期望（空体 ⇒ 这条红）', p.post_len_ok === true && Number(p.post_len_server) === Number(p.post_len_expected)],
  ['★★POST 体非空', p.post_not_empty === true],
  ['POST Content-Type 按调用方落地', p.post_ct_ok === true],
  ['GET（无体）仍成功', p.get_ok === true],
  ['PUT 带体成功', p.put_len_ok === true],
  ['整体 ok', p.ok === true],
]
let bad = 0
for (const [name, ok] of checks) { console.log(`  ${ok ? '✅' : '✗'} ${name}`); if (!ok) bad++ }
const stats = {
  post: { status: p.post_status, server: p.post_len_server, expected: p.post_len_expected, ct: p.post_content_type },
  get: { status: p.get_status, server: p.get_len_server },
  put: { status: p.put_status, ok: p.put_len_ok },
}
console.log(`\n  读数：${JSON.stringify(stats)}`)
if (bad) {
  console.log('\n  报告原文：')
  console.log(JSON.stringify(r, null, 2).slice(0, 2000))
  console.log('\n  ★诊断提示：post_len_server=0 ⇒ 请求体没发出去（整包路径漏装配 body）；')
  console.log('    post_error 含 "must not have a request body" ⇒ 体被错挂到 GET；')
  console.log('    post_ct_ok=false ⇒ 内容类型没按调用方落地；probe 为空 ⇒ 装置问题')
  process.exit(1)
}
console.log('\n✅ 请求体真机生效（POST/PUT 逐字节到达 + GET 无体 + Content-Type 正确）')
NODE

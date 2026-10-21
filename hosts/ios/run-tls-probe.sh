#!/usr/bin/env bash
# hosts/ios/run-tls-probe.sh —— ★★★#1153：**TLS 证书 pinning** 真机判据（iOS）
#
# 【与 Android 同判据、同装置】
#   ① 对 A + pinA + pinOnly ⇒ 成功 ② 对 A + pinB + pinOnly ⇒ `fetch.tlsError`
#   ③ 对 A + pinA（不开 pinOnly）⇒ 失败（叠加模式真的叠加）④ 对 A 无 pin ⇒ 失败 ⑤ 对 B + pinB ⇒ 成功
#
# 【★iOS 侧为什么尤其必须实测】证书校验在 `URLSession` 的 challenge 回调里；
#   而"pin 未命中时连接真的被拒"与"URLSession 自己拒绝了自签"在客户端看起来**都是失败**
#   ⇒ 必须用 ① （pin 命中要**成功**）反证"我们的 pin 分支真的在起作用"。
#
# 【差异】无 adb reverse ⇒ 服务绑 0.0.0.0，设备经局域网 IP 访问。
#
# 用法：bash hosts/ios/run-tls-probe.sh [portA] [portB]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib/xcode-env.sh"

# ★★#1153：**每条用例必须用不同端口**（真机实测：iOS 的 URLSession 会复用已建立的 TLS 连接
#   ⇒ 同 host:port 的连续请求只触发一次 challenge ⇒ "无 pin 也成功"是复用，不是 pinning 失效）。
#   ★端口必须**先探活**再分配（写死一段会撞上别的进程，实测 8823 被占）。
pick_free_ports() {
  local want="$1" start="$2" out="" p count
  p="$start"
  while :; do
    # ★★计数必须按**逗号个数 + 非空**算：首版用 `printf '%s' "$out" | grep -c .`，
    #   而 `$out` 为空时输出一个空行 ⇒ `grep -c .` 返回 **1** ⇒ 第一个端口就被当成"凑够了"
    #   ⇒ 只挑到 1 个端口 ⇒ 探针 5 条用例共用它 ⇒ TLS 连接被复用 ⇒ challenge 只触发一次
    #   （真机实测：bases_a 只有 1 个、host_tls_stats.challenges 远低于请求数）。
    if [ -z "$out" ]; then count=0; else count=$(( $(printf '%s' "$out" | tr -cd '+' | wc -c) + 1 )); fi
    [ "$count" -ge "$want" ] && break
    [ "$p" -ge $((start + 100)) ] && break
    if ! lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      # ★用 `+` 拼端口（不是 `,`）：整个探针参数是逗号分隔的多实参，base 内部再用逗号会被切碎
      out="${out:+$out+}$p"
    fi
    p=$((p + 1))
  done
  printf '%s' "$out"
}
PORTS_A="$(pick_free_ports 4 8900)"
PORTS_B="$(pick_free_ports 2 9000)"
[ -n "$PORTS_A" ] && [ -n "$PORTS_B" ] || { echo "✗ 找不到空闲端口"; exit 3; }
PORT_A="${PORTS_A%%+*}"
PORT_B="${PORTS_B%%+*}"
LOCAL_REPORT="$HERE/results/tls-probe.json"
SUPERAPP_REPORT="$HERE/results/superapp.json"
GEN_DIR="$HERE/results/tls-certs"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
mkdir -p "$HERE/results" "$GEN_DIR"

[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then echo "✗ 取不到本机局域网 IP"; exit 2; fi
# ★传给探针的是**端口列表**（探针按用例取不同端口 ⇒ 每条都新建 TLS 连接）
BASE_A="https://${LAN_IP}:${PORTS_A}"
BASE_B="https://${LAN_IP}:${PORTS_B}"
echo "==> 服务基址（设备侧）：A=$BASE_A B=$BASE_B"

rm -f "$LOCAL_REPORT" "$SUPERAPP_REPORT"
# ★★必须清掉旧证书：证书生成有 "存在即复用" 逻辑，而不带 SAN 的旧证书会让判据永远失败
#   （真机实测：SAN 只有 127.0.0.1 而设备访问局域网 IP ⇒ 主机名不匹配 ⇒ pin 从未命中）。
#   ⇒ 每次跑都重新生成、并把**本机局域网 IP** 写进 SAN。
rm -f "$GEN_DIR"/*.crt "$GEN_DIR"/*.key 2>/dev/null || true
SAN="DNS:localhost,IP:127.0.0.1,IP:${LAN_IP}"

node "$ROOT/hosts/android/tools/tls-echo-server.mjs" "$PORTS_A" "--gen-dir=$GEN_DIR" "--san=$SAN" > "$HERE/results/tls-server-a-ios.log" 2>&1 &
SRV_A=$!
node "$ROOT/hosts/android/tools/tls-echo-server.mjs" "$PORTS_B" "--gen-dir=$GEN_DIR" "--san=$SAN" > "$HERE/results/tls-server-b-ios.log" 2>&1 &
SRV_B=$!
cleanup() { kill "$SRV_A" "$SRV_B" 2>/dev/null || true; }
trap cleanup EXIT

if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT_A}" --timeout 20 --interval 1 --max-interval 2; then
  echo "✗ 服务 A 未就绪"; exit 3
fi
if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT_B}" --timeout 20 --interval 1 --max-interval 2; then
  echo "✗ 服务 B 未就绪"; exit 3
fi

# ★单行 node -e（多行会让末尾的 `)` 拼进输出 —— Android 侧实测踩过）
PIN_A="$(curl -sk "https://127.0.0.1:${PORT_A}/__pin" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).spki||''))}catch{}})" | tr -d '\r\n')"
PIN_B="$(curl -sk "https://127.0.0.1:${PORT_B}/__pin" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).spki||''))}catch{}})" | tr -d '\r\n')"
[ -n "$PIN_A" ] && [ -n "$PIN_B" ] && [ "$PIN_A" != "$PIN_B" ] || { echo "✗ 指纹异常（A=$PIN_A B=$PIN_B）"; exit 3; }
echo "    A pin = ${PIN_A}"
echo "    B pin = ${PIN_B}"

echo "==> 构建 + 安装 + 启动（superapp --tls-probe）"
bash "$HERE/run-selfdraw.sh" --superapp "--tls-probe=${BASE_A},${BASE_B},${PIN_A},${PIN_B}" 2>&1 \
  | grep -viE "^warning|unused variable" | tail -10

[ -f "$SUPERAPP_REPORT" ] || { echo "✗ 报告未取回（${SUPERAPP_REPORT}）"; exit 4; }
cp -f "$SUPERAPP_REPORT" "$LOCAL_REPORT"
echo "    证据已落盘：$LOCAL_REPORT"

echo "==> 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
let p = r.tls_probe
if (typeof p === 'string') { try { p = JSON.parse(p) } catch { p = null } }
if (!p) { console.log('✗ 报告里没有 tls_probe 读数：' + JSON.stringify(r).slice(0, 900)); process.exit(1) }

const chk = []
const add = (ok, msg) => chk.push([ok, msg])
add(p.ok === true, '整体 ok（tls_probe.ok）')
add(p.hit_secure === true, '装置确实用了 https（明文测不了 pinning）')
add(p.hit_ok === true, `★★pin **命中** ⇒ 请求成功（pinOnly 模式，自签证书）〔code=${p.hit_code || '-'}〕`)
add(p.mismatch_failed === true, '★★pin **未命中** ⇒ 请求失败（拿 B 的指纹连 A）')
add(p.mismatch_is_tls_error === true, `★★★失败码是 **fetch.tlsError**（实得 ${p.mismatch_code || '-'}）`)
add(p.stacked_failed === true, `★★★**叠加模式真的叠加**：pin 对但不开 pinOnly ⇒ 自签被系统信任拒〔code=${p.stacked_code || '-'}〕`)
add(p.nopin_failed === true, `★无 pin ⇒ 自签被拒（基线，实得 ${p.nopin_code || '-'}）`)
add(p.b_ok === true, `★B 服务本身可达（pinB 命中）⇒ ②不是"连不上"的假通过〔code=${p.b_code || '-'}〕`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：${JSON.stringify({
  hit: { ok: p.hit_ok, code: p.hit_code },
  mismatch: { failed: p.mismatch_failed, code: p.mismatch_code },
  stacked: { failed: p.stacked_failed, code: p.stacked_code },
  nopin: { failed: p.nopin_failed, code: p.nopin_code },
  b: { ok: p.b_ok, code: p.b_code },
})}`)
if (bad) {
  console.log('\n  ★诊断提示（iOS 特有）：')
  console.log('    hit_ok=false ⇒ pin 分支没生效 或 SPKI 头部拼错（SecKeyCopyExternalRepresentation 是裸公钥）')
  console.log('    mismatch 不是 tlsError ⇒ didCompleteWithError 里没识别 -999 + tlsPins 组合')
  console.log('    stacked_failed=false ⇒ 叠加模式没做（evaluate 跳过了 SecTrustEvaluateWithError）')
  console.log('  报告原文：' + JSON.stringify(p).slice(0, 1800))
  process.exit(1)
}
console.log('\n✅ TLS pinning（iOS：命中/未命中/叠加/基线 四条全部到位）')
NODE

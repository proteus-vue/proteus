#!/usr/bin/env bash
# hosts/android/run-httpdns-probe.sh —— ★★★#1169：**HTTPDNS 端到端真机判据**（Android / iOS 共用）
#
# 【它证明什么（三件，缺一不可）】
#   ① **基线成功**：目标域名、**不传** `httpDns` ⇒ 请求成功（证明网络本身通）；
#   ② **表生效**：传 `httpDns: { <域名>: ['203.0.113.1'] }`（TEST-NET-3 不可达）⇒ 请求**必失败**；
#      若仍成功 ⇒ 宿主忽略了表（假绿）；
#   ③ **不静默忽略**：iOS 无自定义 DNS 钩子 ⇒ 传表必须 `fetch.unsupported`。
#
# 【★为什么用公网域名而不是 IP】`httpDns` 的键是**域名**；URL 用 IP 字面量时
#   OkHttp/URLSession 都**不走 DNS**（直接连 IP）⇒ 探针会测不到任何东西。
#   ⇒ 必须用一个真实域名（缺省 `example.com`，可用 `--host` 换）。
#
# 【诚实边界】"注入不可达 IP ⇒ 失败"证明**表被采用**，不证明"HTTPDNS 给的 IP 优质"（那是业务侧）。
#   本探针用固定公网域名（`example.com`）而非自建服务，是因为自建需要域名解析配合，
#   会把"HTTPDNS 是否生效"与"自建服务是否可达"两件事混在一起。
#
# 用法：bash hosts/android/run-httpdns-probe.sh [--host example.com] [--apk PATH]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

HOST="example.com"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
for arg in "$@"; do
  case "$arg" in
    --host=*) HOST="${arg#--host=}" ;;
    --apk=*) APK="${arg#--apk=}" ;;
  esac
done
PKG="dev.proteus.layoutcore"
ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
REPORT="/sdcard/Android/data/$PKG/files/httpdns-probe.json"
LOCAL="$HERE/results/httpdns-probe.json"
mkdir -p "$HERE/results"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：${APK}"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

echo "==> ① 安装 + 清场"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1 || true
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（会读到陈旧结果）"; exit 4
fi

echo "==> ② 触发 httpdns-probe（host=${HOST}）"
# ★★★#1183：`reachableIp` 由**本机**解析后传入 —— 探针跑在主线程，
#   `InetAddress.getAllByName` 会抛 NetworkOnMainThreadException（被 catch 吞成空串，
#   真机实测踩过：`reachable_ip:""` 而设备 `ping` 明明能解析）。
REACHABLE_IP="$(dig +short "$HOST" A 2>/dev/null | grep -E '^[0-9]+\.' | head -1 || true)"
if [ -z "$REACHABLE_IP" ]; then
  REACHABLE_IP="$(nslookup "$HOST" 2>/dev/null | awk '/^Address: /{print $2}' | grep -E '^[0-9]+\.' | head -1 || true)"
fi
if [ -n "$REACHABLE_IP" ]; then
  echo "    reachableIp=${REACHABLE_IP}（用于"命中表且成功"那一轮）"
else
  echo "    ⚠ 本机解析不出 ${HOST} ⇒ hit 轮将被跳过（如实跳过，不假装验过）"
fi
"$ADB" shell "am start -n $PKG/.MainActivity --es path httpdns-probe --es host '$HOST' --es reachableIp '$REACHABLE_IP'" >/dev/null 2>&1
bash "$WAIT" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 40 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（40s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path httpdns-probe --es reachableIp '$REACHABLE_IP' -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 180 --interval 2 --max-interval 4; then
  echo "✗ 报告未生成——看 logcat"
  "$ADB" logcat -d -s 'proteus:I' | tail -15 || true
  exit 4
fi
"$ADB" pull "$REPORT" "$LOCAL" >/dev/null 2>&1 || { echo "✗ 拉取报告失败"; exit 4; }

echo "==> ③ 判定"
node - "$LOCAL" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const p = r.probe || {}
const checks = [
  ['探针已启动', String(r.probe_kick || '').includes('started')],
  ['★★基线成功（同域名不传 httpDns ⇒ 网络本身通）', p.baseline_ok === true],
  ['★★注入不可达 IP 后请求**失败**（表真的被采用）', p.inject_ok === false],
  ['注入失败不是 unsupported（该端确实实现了 HTTPDNS）', String(p.inject_code || '') !== 'fetch.unsupported'],
  // ★★★#1183：**业务可见**的每请求解析来源（`meta.transport.dnsSource`）
  //   ★这是"httpDNS 到底生效没有"从**间接推断**（请求成败）变成**每请求直接证据**的落点。
  ['★命中表的那次请求：meta.transport.dnsSource === table', p.hit_dns_source === 'table'],
  ['★dnsTableHit === true（与 dnsSource 自洽）', p.hit_transport && p.hit_transport.dnsTableHit === true],
  ['★那次确实是新建连接（reused=false ⇒ 真的查了 DNS）', p.hit_transport && p.hit_transport.reused === false],
  ['★基线（无表）不该报 table（不伪造来源）', p.baseline_dns_source !== 'table'],
  ['整体 ok', p.ok === true],
]
let bad = 0
for (const [name, ok] of checks) { console.log(`  ${ok ? '✅' : '✗'} ${name}`); if (!ok) bad++ }
console.log(`\n  读数：${JSON.stringify({
  host: p.host, platform: p.host_platform, mode: p.mode,
  baseline: { ok: p.baseline_ok, status: p.baseline_status },
  inject: { ok: p.inject_ok, code: p.inject_code, ip: p.inject_unreachable_ip },
})}`)
if (bad) {
  console.log('\n  报告原文：' + JSON.stringify(r).slice(0, 1600))
  console.log('\n  ★诊断：baseline_ok=false ⇒ 网络/域名本身不通（换 --host）；')
  console.log('    inject_ok=true ⇒ 宿主忽略了 httpDns 表（表没生效）；')
  console.log('    inject_code=fetch.unsupported ⇒ 该端没实现（iOS 属预期，见 mode）')
  process.exit(1)
}
console.log('\n✅ HTTPDNS 真机生效（基线通 + 注入不可达 IP ⇒ 失败）')
NODE

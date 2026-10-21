#!/usr/bin/env bash
# hosts/android/run-tls-probe.sh —— ★★★#1153：**TLS 证书 pinning** 真机判据（Android）
#
# 【它证明什么（Node 判据证不了的部分）】
#   pinning 只在 **TLS 握手**阶段生效，而握手在宿主里发生（`SSLSocketFactory` / `X509TrustManager`）
#   ⇒ "pin 未命中时连接真的被拒"只能真机证（Node 只能验指纹口径与归一）。
#
# 【装置：两台自签 HTTPS 服务（不同密钥）】
#   · A（默认 8810）/ B（默认 8811）—— 判据从各自 `/__pin` 取**权威 SPKI 指纹**（装置自证，不手算）
#   · 判定：
#     ① 对 A + pinA + pinOnly ⇒ 必须成功
#     ② 对 A + pinB + pinOnly ⇒ 必须 `fetch.tlsError`
#     ③ 对 A + pinA（**不开** pinOnly）⇒ 必须失败（叠加模式真的叠加了系统信任）
#     ④ 对 A 无 pin ⇒ 必须失败（自签被拒的基线）
#     ⑤ 对 B + pinB + pinOnly ⇒ 必须成功（证明 B 可达，②不是"连不上"假通过）
#
# 用法：bash hosts/android/run-tls-probe.sh [portA] [portB]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

# ★★#1153：**每条用例必须用不同端口**（真机实测：iOS 的 URLSession 会复用已建立的 TLS 连接
#   ⇒ 同 host:port 的连续请求只触发一次 challenge ⇒ "无 pin 也成功"是复用，不是 pinning 失效）。
#   ★端口必须**先探活**再分配：写死一段容易撞上别的进程（实测 8823 就被占），
#     而"跳过被占端口"会让探针打到空端口 ⇒ 假红。⇒ 从一个大范围里挑**确认空闲**的。
pick_free_ports() {
  local want="$1" start="$2" out="" p count
  p="$start"
  while :; do
    # ★★计数必须按**逗号个数 + 非空**算（空串时 `grep -c .` 返回 1 ⇒ 只挑 1 个端口 ⇒ 连接被复用）
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
PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
REPORT="/sdcard/Android/data/$PKG/files/tls-probe.json"
LOCAL_REPORT="$HERE/results/tls-probe.json"
GEN_DIR="$HERE/results/tls-certs"
mkdir -p "$HERE/results" "$GEN_DIR"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

echo "==> ① 起两台自签 HTTPS 服务（A:${PORTS_A} B:${PORTS_B}，各端口共用同一套证书）"
# ★每次重新生成证书（生成器有"存在即复用"逻辑；旧证书可能 SAN 不含判据用的地址）
rm -f "$GEN_DIR"/*.crt "$GEN_DIR"/*.key 2>/dev/null || true
node "$HERE/tools/tls-echo-server.mjs" "$PORTS_A" "--gen-dir=$GEN_DIR" "--san=DNS:localhost,IP:127.0.0.1" > "$HERE/results/tls-server-a.log" 2>&1 &
SRV_A=$!
node "$HERE/tools/tls-echo-server.mjs" "$PORTS_B" "--gen-dir=$GEN_DIR" "--san=DNS:localhost,IP:127.0.0.1" > "$HERE/results/tls-server-b.log" 2>&1 &
SRV_B=$!
cleanup() {
  kill "$SRV_A" "$SRV_B" 2>/dev/null || true
  for p in $(printf '%s+%s' "$PORTS_A" "$PORTS_B" | tr '+' ' '); do
    "$ADB" reverse --remove "tcp:${p}" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT_A}" --timeout 20 --interval 1 --max-interval 2; then
  echo "✗ 服务 A 未就绪（见 results/tls-server-a.log）"; exit 3
fi
if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT_B}" --timeout 20 --interval 1 --max-interval 2; then
  echo "✗ 服务 B 未就绪（见 results/tls-server-b.log）"; exit 3
fi
for p in $(printf '%s+%s' "$PORTS_A" "$PORTS_B" | tr '+' ' '); do
  "$ADB" reverse "tcp:${p}" "tcp:${p}" >/dev/null 2>&1 || { echo "✗ adb reverse ${p} 失败"; exit 3; }
done

# ★从服务端取**权威** SPKI 指纹（不在判据里手算——那样装置自己错了也发现不了）
#   ★★必须用**单行** `node -e`：首版写多行带缩进，末尾的 `)` 被拼进了输出串
#     ⇒ 推给设备的 pin 变成 `...Xk=)` ⇒ 宿主 Base64 解析失败 ⇒ pinning **静默失效**
#     （真机实测：日志 `忽略无法解析的 pin：...Xk=)`）。
PIN_A="$(curl -sk "https://127.0.0.1:${PORT_A}/__pin" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).spki||''))}catch{}})" | tr -d '\r\n')"
PIN_B="$(curl -sk "https://127.0.0.1:${PORT_B}/__pin" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).spki||''))}catch{}})" | tr -d '\r\n')"
[ -n "$PIN_A" ] || { echo "✗ 取不到 A 的 SPKI 指纹"; exit 3; }
[ -n "$PIN_B" ] || { echo "✗ 取不到 B 的 SPKI 指纹"; exit 3; }
[ "$PIN_A" != "$PIN_B" ] || { echo "✗ A/B 指纹相同（两套证书没分开）"; exit 3; }
echo "    A pin = ${PIN_A}"
echo "    B pin = ${PIN_B}"

echo "==> ② 安装 + 触发 tls-probe"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（等待信号会命中陈旧文件）"; exit 4
fi
# ★★base64 指纹**不能经 adb shell 传参**：`+` 会被当空格、`=` 会被当 key=value 分隔、
#   引号在 `adb shell` 的二次解析里还会掉字符（真机实测：收到的 pin 末尾多出一个 `)`，
#   `Base64.decode` 失败 ⇒ 整条 pin 被丢弃 ⇒ pinning **静默失效**）。
#   ⇒ 改成**推文件**：把两台服务的指纹写成本地文件 → `adb push` → 探针按沙箱路径读。
# ★★所有参数都走**文件**（不用 `--es`）：`adb shell` 的引号/逗号/`=` 都会咬参数 ——
#   实测两次踩：多行续行导致全空、逗号端口列表又一次全空。文件通道没有这些问题。
PIN_FILE="$GEN_DIR/pins.json"
node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ baseA: process.argv[2], baseB: process.argv[3], a: process.argv[4], b: process.argv[5] }))" \
  "$PIN_FILE" "https://127.0.0.1:${PORTS_A}" "https://127.0.0.1:${PORTS_B}" "$PIN_A" "$PIN_B"
"$ADB" push "$PIN_FILE" "/sdcard/Android/data/$PKG/files/tls-pins.json" >/dev/null 2>&1 \
  || { echo "✗ push 参数文件失败"; exit 3; }
"$ADB" shell "am start -n $PKG/.MainActivity --es path tls-probe" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path tls-probe -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 180 --interval 1 --max-interval 3; then
  echo "✗ 报告未生成——看 logcat / 服务日志"
  "$ADB" logcat -d -s 'proteus:I' 'proteus-tls:W' | tail -20 || true
  exit 4
fi
"$ADB" pull "$REPORT" "$LOCAL_REPORT" >/dev/null 2>&1 || { echo "✗ 拉取报告失败"; exit 4; }

echo "==> ③ 判定"
node - "$LOCAL_REPORT" "$PIN_A" "$PIN_B" <<'NODE'
const fs = require('fs')
const [reportPath, pinA, pinB] = process.argv.slice(2)
const r = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const p = r.tls_probe || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(String(r.probe_kick || '').includes('started'), '探针已启动')
add(p.ok === true, '整体 ok（tls_probe.ok）')
add(p.hit_secure === true, '装置确实用了 https（明文测不了 pinning）')
add(p.hit_ok === true, `★★pin **命中** ⇒ 请求成功（pinOnly 模式，自签证书）〔code=${p.hit_code || '-'}〕`)
add(p.mismatch_failed === true, `★★pin **未命中** ⇒ 请求失败（拿 B 的指纹连 A）`)
add(p.mismatch_is_tls_error === true, `★★★失败码是 **fetch.tlsError**（实得 ${p.mismatch_code || '-'}）——证书问题必须与网络失败分开`)
add(p.stacked_failed === true, `★★★**叠加模式真的叠加**：pin 对但不开 pinOnly ⇒ 自签被系统信任拒（这样 pin 才是额外防线而非替代）〔code=${p.stacked_code || '-'}〕`)
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
  console.log('\n  ★诊断提示：')
  console.log('    hit_ok=false 且 code=fetch.tlsError ⇒ pin 未被识别（检查宿主是否真的读了 tlsPins）')
  console.log('    mismatch_code 不是 tlsError ⇒ 归因链断了（HttpsURLConnection 把异常包在 SSLHandshakeException 里）')
  console.log('    stacked_failed=false ⇒ ★叠加模式没做（只做 pin 不调系统校验 ⇒ 安全性反而下降）')
  console.log('    b_ok=false ⇒ B 服务/证书有问题（②可能因此假通过）')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1800))
  process.exit(1)
}
console.log('\n✅ TLS pinning（Android：命中/未命中/叠加/基线 四条全部到位）')
NODE

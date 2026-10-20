#!/usr/bin/env bash
# hosts/android/run-save-probe.sh —— ★★★#1119：download **流式落盘**（S3）真机判据（Android）
#
# 【它证明什么（缺一不算 S3）】
#   ① 落盘成功且**字节数正确**；
#   ② **JS 侧不碰字节**（`data` 是路径字符串，不是字节数组）——"内存与文件解耦"的结构证据；
#   ③ **宿主记账** `peak_chunk_bytes` ≈ 16 KiB（单块缓冲），与文件总大小**无关**；
#   ④ 内容正确（JS 读回抽样比对）。
#
# 【★为什么文件要够大】4 KiB 在任何实现下都不会 OOM ⇒ 测不出"整包驻留 vs 边收边写"
#   （#1105「逐点差异测不出织纹」同族：样本量不够的判据等于没有判据）。默认 8 MiB。
#
# 用法：bash hosts/android/run-save-probe.sh [port]
#   PROTEUS_SAVE_PROBE_SIZE_MIB 可覆盖（默认 8）
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PORT="${1:-8795}"
SIZE_MIB="${PROTEUS_SAVE_PROBE_SIZE_MIB:-8}"
PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
REPORT="/sdcard/Android/data/$PKG/files/save-probe.json"
LOCAL_REPORT="$HERE/results/save-probe.json"
SERVER_LOG="$HERE/results/save-probe-server.log"
mkdir -p "$HERE/results"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

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
"$ADB" reverse "tcp:${PORT}" "tcp:${PORT}" >/dev/null 2>&1 || { echo "✗ adb reverse 失败"; exit 3; }
echo "    服务就绪 + reverse 已建"

echo "==> ② 安装 + 触发 save-probe（size=${SIZE_MIB}MiB）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（等待信号会命中陈旧文件）"; exit 4
fi
"$ADB" shell "am start -n $PKG/.MainActivity --es path save-probe --es base 'http://127.0.0.1:${PORT}' --ei size_mib ${SIZE_MIB}" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path save-probe -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 300 --interval 1 --max-interval 3; then
  echo "✗ 报告未生成——看 logcat / 服务日志"
  "$ADB" logcat -d -s 'proteus:I' | tail -20 || true
  tail -10 "$SERVER_LOG" || true
  exit 4
fi

"$ADB" pull "$REPORT" "$LOCAL_REPORT" >/dev/null 2>&1 || { echo "✗ 拉取报告失败"; exit 4; }

echo "==> ③ 判定"
node - "$LOCAL_REPORT" "$SIZE_MIB" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const sizeMiB = Number(process.argv[3])
const want = sizeMiB * 1024 * 1024
const p = r.probe || {}
const h = r.host_save_stats || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(String(r.probe_kick || '').includes('started'), '探针已启动')
add(p.ok === true, '整体 ok（probe.ok）')
add(Number(p.status) === 200, `HTTP 200（实得 ${p.status}）`)
add(p.data_is_path === true, `★JS 侧不碰字节（data 类型 ${p.data_kind}）`)
// ★大文件（> 1 MiB）**不做读回校验**：fs.readBytes 回 number[]，8 MiB 会变 8M 个 number
//   ⇒ JS 堆 > 64 MiB 直接 OOM（本轮实测）。判据两层：小文件验内容、大文件验结构。
if (sizeMiB <= 1) {
  add(Number(p.readback_size) === want, `读回字节 = ${want}（实得 ${p.readback_size}）`)
  add(Number(p.readback_mismatch) === 0, `读回内容抽样全对（错 ${p.readback_mismatch} / 查 ${p.readback_checked}）`)
} else {
  console.log(`  ℹ 大文件（${sizeMiB} MiB）跳过读回内容校验（会 OOM）——内容正确性由小文件用例覆盖`)
}
add(Number(h.bytes) === want, `宿主记账字节 = ${want}（实得 ${h.bytes}）`)
add(h.completed === true, '宿主落盘正常完成')
// ★核心：内存只与块大小相关
add(Number(h.peak_chunk_bytes) > 0 && Number(h.peak_chunk_bytes) <= 128 * 1024,
  `★峰值块 ${h.peak_chunk_bytes}B ≤ 128 KiB（与文件 ${sizeMiB} MiB **无关**）`)
add(Number(h.chunks) > 1, `边收边写（${h.chunks} 块）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：host=${JSON.stringify(h)}`)
if (bad) {
  console.log('\n  ★诊断：若 data_is_path=false ⇒ 仍在整包回推 JS（savePath 没接上）')
  console.log('    若 peak_chunk_bytes 接近文件大小 ⇒ 宿主在攒整包（不是边收边写）')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1500))
  process.exit(1)
}
console.log(`\n✅ download 流式落盘真机生效（JS 不碰字节 + 峰值块 ${h.peak_chunk_bytes}B 与 ${sizeMiB} MiB 文件无关）`)
NODE

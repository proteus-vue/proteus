#!/usr/bin/env node
// scripts/check-stream-evidence.mjs —— ★★★流式通道双端真机证据门禁（#1148）
//
// 【为什么需要】
//   #1118 的提交消息写着「双真机全绿 · iOS 11/11」，但**iOS 侧没有任何可复核产物**：
//     · `hosts/android/run-stream-probe.sh` 存 `results/stream-probe.json`（✅ 已入库）
//     · `hosts/ios/run-stream-probe.sh`     存 `results/superapp.json`（通用报告名 ⇒
//       **任何一次 superapp 运行都会覆盖它**；且它不入库、也不是流式专用）
//   ⇒ 结论只存在于 commit message 的文字里，事后无法复核。这正是 #1146 立的纪律
//     （"被引用的证据必须入库"）在**跨端能力**上的具体形态：
//     只跑一端时另一端是**推断**，不是证据。
//   ★顺带发现：`docs/ai-tasks.json` 里该任务的 verification 只写了 **Android** 的探针脚本，
//     iOS 那份从未被任何命令引用 ⇒ 没人会发现它缺证据。本门禁补上这一环。
//
// 【判据】
//   ① 两端证据文件都存在且已入库（Android / iOS 同名 stream-probe.json）
//   ② 内容判据（不是只看文件在）：probe.ok + 字节数 > 0 + 错位 0 + seq 连续
//   ③ 背压**真的触发过**（backpressure_waits > 0）——这是 S3 的核心命题：
//      没有背压的"流式"只是分多次收，内存仍会堆（本仓已有过一次"装置未测到"的教训）
//   ④ --list 只报告不判红
//
// 【诚实边界】鸿蒙端流式是 **unsupported**（一次性 VM 形态限制，见 #1118 的 note）⇒
//   本门禁只要求**两端**，不把"三端"当判据（要求做不到的端 = 假红）。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIST_ONLY = process.argv.includes('--list')

/** 有真机流式能力的端（鸿蒙 unsupported：一次性 VM 无法在调用期间持续回推） */
const ENDS = [
  { id: 'android', rel: 'hosts/android/results/stream-probe.json' },
  { id: 'ios', rel: 'hosts/ios/results/stream-probe.json' },
]

function isTracked(rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const problems = []
const rows = []

for (const { id, rel } of ENDS) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    problems.push(`${id}: 缺证据 ${rel}——跑 \`bash hosts/${id}/run-stream-probe.sh\` 生成并提交`)
    rows.push({ id, rel, state: '缺失' })
    continue
  }
  if (!isTracked(rel)) {
    problems.push(`${id}: 证据 ${rel} 存在但未入库（提交后别人/CI 拿不到）——git add -f ${rel}`)
  }
  let d
  try {
    d = JSON.parse(fs.readFileSync(abs, 'utf-8'))
  } catch (e) {
    problems.push(`${id}: ${rel} JSON 解析失败：${e.message}`)
    rows.push({ id, rel, state: '解析失败' })
    continue
  }
  // ★★#1148：两端的 probe 载荷键名**不同**（实测，不是猜）：
  //   · Android `probe`（由 `probe_raw` 再解析；hosts/android/run-stream-probe.sh 写的）
  //   · iOS     `stream_probe`（由 run-selfdraw 的 superapp 报告复制而来）
  //   ⇒ 判据必须认**实际形态**。★这是本仓第 N 次"判据假设了一种形态"：
  //     首版只读 stream_probe ⇒ Android 读出 ok=undefined/got_chunks=0，
  //     看起来像"Android 全坏"，实际是**判据读错了字段**（差一步就误报真缺陷）。
  let p = d.stream_probe ?? d.probe
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p)
    } catch {
      p = null
    }
  }
  p = p || {}
  const h = d.host_stream_stats || {}
  const gotChunks = Number(p.got_chunks ?? 0)
  const gotBytes = Number(p.got_bytes ?? 0)
  const mismatches = Number(p.mismatches ?? -1)
  const waits = Number(h.backpressure_waits ?? 0)

  if (p.ok !== true) problems.push(`${id}: probe.ok=${p.ok}（流式通路未成功）`)
  if (gotChunks <= 0) problems.push(`${id}: got_chunks=${gotChunks}（没有逐块到达）`)
  if (gotBytes <= 0) problems.push(`${id}: got_bytes=${gotBytes}（字节数为 0）`)
  if (mismatches !== 0) problems.push(`${id}: mismatches=${mismatches}（内容有错位）`)
  if (p.seq_continuous !== true) problems.push(`${id}: seq_continuous=${p.seq_continuous}（有丢帧/乱序）`)
  // ★S3 的核心命题：没有真背压 ⇒ 只是"分多次收"，消费侧拖慢时内存仍会堆。
  if (waits <= 0) {
    problems.push(
      `${id}: backpressure_waits=${waits}（背压**从未触发**）——` +
        `S3 要的是"消费侧慢下来时生产侧被挡住"；未测到不等于通过（装置限速不足或消费侧不够慢）`
    )
  }

  rows.push({
    id,
    rel,
    state: problems.some((x) => x.startsWith(`${id}:`)) ? '不达标' : '通过',
    key: d.stream_probe !== undefined ? 'stream_probe' : 'probe',
    chunks: gotChunks,
    bytes: gotBytes,
    waits,
  })
}

if (LIST_ONLY) {
  console.log(`流式通道双端证据（共 ${rows.length} 端）`)
  for (const r of rows) {
    const extra =
      r.chunks === undefined ? '' : ` · ${r.chunks} 块 · ${r.bytes}B · 背压 ${r.waits} 次（键 ${r.key}）`
    console.log(`  ${r.state.padEnd(6)} ${r.id.padEnd(8)} ${r.rel}${extra}`)
  }
  if (problems.length) {
    console.log(`  ⚠ ${problems.length} 条问题（--list 只报告）：`)
    for (const p of problems) console.log(`     · ${p}`)
  }
  process.exit(0)
}

if (problems.length > 0) {
  console.error('✗ 流式通道双端证据门禁未过：')
  for (const p of problems) console.error(`  · ${p}`)
  process.exit(1)
}
console.log(
  `✅ 流式通道双端证据齐备（${rows.map((r) => `${r.id} ${r.chunks} 块/${r.bytes}B/背压 ${r.waits} 次`).join(' · ')}）`
)

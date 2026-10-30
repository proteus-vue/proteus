#!/usr/bin/env node
// scripts/bench-echo-server.mjs —— ★★★#1404 **服务端天花板**基准（用于把"平台期"归属到客户端）
//
// 【它回答什么问题（不说清这条，QPS 读数就无法解释）】
//   真机压测得出一条平台期（例：Android 并发 4→8 都在 ~2.4k QPS，16 掉头向下）。
//   平台期只说明"某处饱和了"，**不说明是哪一处**。饱和点可能是：
//     ① 被测客户端（App 宿主管道 + QuickJS）——那 QPS 就是**框架指标**；
//     ② 服务端（单进程 node）——那 QPS 只是**装置指标**，不能当框架结论。
//   ★二者外观完全一样（都是一条平台线）⇒ 必须**单独量服务端**才能归属。
//   同族教训：本仓 #1103「队列从未满过」与「没有队列」读数同形。
//
// 【口径（与真机探针一致）】
//   · 固定 worker 池（不是 Promise.all(N)）· keep-alive 复用连接 · 预热一轮丢弃
//   · 同一批并发度（4/8/16）· 同一端点（`/perf?i=N`）· 报 p50/p99 + QPS
//   · **跑在本机回环**（`127.0.0.1`）⇒ 量到的是服务端自己的上限，不含任何设备/无线变量
//
// 【诚实边界】
//   · 本机回环的绝对数值**不代表生产服务端**（生产有反代/DB/鉴权）——它只用于**归属**：
//     「服务端能跑 12k、App 只跑 2.4k」⇒ 瓶颈在 App；同数量级 ⇒ 装置先饱和，读数不可用。
//   · node 的 http 服务端单进程，与真机压测时**同一个脚本**（`transfer-echo-server.mjs`）。
//
// 用法：node scripts/bench-echo-server.mjs [--total 1000] [--port 8978]
//       ⇒ 写 docs/generated/request-server-ceiling.json
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs/generated/request-server-ceiling.json')
const SERVER = path.join(ROOT, 'hosts/android/tools/transfer-echo-server.mjs')

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const TOTAL = Number(argOf('total', 1000))
const PORT = Number(argOf('port', 8978))
const CONCS = [4, 8, 16]

/** 固定 worker 池跑一轮，返回耗时数组 */
function runBatch(agent, conc, total) {
  return new Promise((resolve) => {
    const lat = []
    let next = 0
    const t0 = process.hrtime.bigint()
    const worker = () =>
      new Promise((done) => {
        const step = () => {
          const i = next++
          if (i >= total) return done()
          const s = process.hrtime.bigint()
          const req = http.get(`http://127.0.0.1:${PORT}/perf?i=${i}`, { agent }, (r) => {
            r.resume()
            r.on('end', () => {
              lat.push(Number(process.hrtime.bigint() - s) / 1e6)
              step()
            })
          })
          req.on('error', () => done())
        }
        step()
      })
    Promise.all(Array.from({ length: conc }, worker)).then(() => {
      const wallMs = Number(process.hrtime.bigint() - t0) / 1e6
      resolve({ lat, wallMs })
    })
  })
}

const quantile = (sorted, p) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))])

async function main() {
  const srv = spawn(process.execPath, [SERVER, String(PORT), '127.0.0.1'], { stdio: 'ignore' })
  const stop = () => { try { srv.kill() } catch { /* 已退 */ } }
  process.on('exit', stop)

  // ★有条件等待（不盲等）：轮询 /health 直到 200，有界
  const ready = await (async () => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const ok = await new Promise((res) => {
        http.get(`http://127.0.0.1:${PORT}/health`, (r) => { r.resume(); res(r.statusCode === 200) }).on('error', () => res(false))
      })
      if (ok) return true
      await new Promise((r) => setImmediate(r))
    }
    return false
  })()
  if (!ready) { stop(); console.error('✗ 服务端未就绪（15s）'); process.exit(1) }

  const agent = new http.Agent({ keepAlive: true, maxSockets: 32 })
  const points = []
  for (const c of CONCS) {
    await runBatch(agent, Math.min(c, 8), Math.max(8, Math.min(20, TOTAL))) // 预热丢弃
    const { lat, wallMs } = await runBatch(agent, c, TOTAL)
    const ok = lat.slice().sort((a, b) => a - b)
    points.push({
      concurrency: c,
      completed: ok.length,
      failed: TOTAL - ok.length,
      wallMs: +wallMs.toFixed(2),
      qps: +(ok.length / (wallMs / 1000)).toFixed(1),
      p50Ms: +quantile(ok, 0.5).toFixed(3),
      p99Ms: +quantile(ok, 0.99).toFixed(3),
    })
    console.log(`  并发 ${c} ⇒ ${points[points.length - 1].qps} QPS · p50 ${points[points.length - 1].p50Ms}ms · p99 ${points[points.length - 1].p99Ms}ms`)
  }
  agent.destroy()
  stop()

  const artifact = {
    note: '服务端天花板基准 —— 用于把真机压测的"平台期"归属到客户端还是装置。★本机回环，不代表生产服务端。',
    generatedBy: 'scripts/bench-echo-server.mjs',
    generatedAt: new Date().toISOString(),
    endpoint: `http://127.0.0.1:${PORT}/perf?i=N`,
    server: 'hosts/android/tools/transfer-echo-server.mjs（单进程 node）',
    totalPerPoint: TOTAL,
    points,
    /** 服务端可用的**最低**档吞吐（保守取最小值——归属时用它当上界最不容易误判） */
    floorQps: Math.min(...points.map((p) => p.qps)),
    honestBoundaries: [
      '本机回环 ≠ 生产服务端（生产有反代/DB/鉴权，吞吐通常更低）',
      '只用于归属"平台期在哪一侧"，不是产品性能承诺',
    ],
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2) + '\n')
  console.log(`\n✅ 已生成 ${path.relative(ROOT, OUT)}（最低档 ${artifact.floorQps} QPS）`)
}

void main()

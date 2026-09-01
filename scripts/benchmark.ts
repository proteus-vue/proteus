// scripts/benchmark.ts —— 功能基准 + 回归门禁（performance-plan G-30 工具链落地，★2026-08-31）
// 用法：
//   tsx scripts/benchmark.ts           跑 + 对比基线（回归 >1.5x → error exit 1；>1.2x → warn）
//   tsx scripts/benchmark.ts --update  跑 + 写回 benchmarks/baseline.json
//   tsx scripts/benchmark.ts --json    JSON 输出（CI 友好）
// 基准项均为纯函数/纯逻辑（Node 可跑、环境无关；预热 + 多轮 + 中位数抗抖动）。
// 门禁语义：功能级回归防护（防 O(n²) 引入等明显劣化），非真机指标（真机矩阵见 performance-plan 07 §2）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileVueSfc } from '@proteus-vue/compiler'
import { createHmrRuntime } from '@proteus-vue/hmr'
import type { HmrPayload } from '@proteus-vue/hmr'
import { collectStyleGateRecords } from '@proteus-vue/hmr/style-gate'
import { redactValue } from '@proteus-vue/devtools-runtime'

import { redactValue } from '@proteus-vue/devtools-runtime'
import { Window } from 'happy-dom'

// ★@proteus-vue/runtime → shared web-adapter / vue runtime-dom 模块初始化需要浏览器全局（window/document/location/history）
//   用 happy-dom Window 提供（与测试环境一致；仅本脚本内生效）
const win = new Window()
const g = globalThis as Record<string, unknown>
g.window = win
g.document = win.document
g.location = win.location
g.history = win.history
const { setDataBridge } = await import('@proteus-vue/runtime')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = path.join(ROOT, 'benchmarks', 'baseline.json')
/** 回归门禁：median > baseline × 1.5 → error（exit 1）；> 1.2 → warn */
const ERROR_FACTOR = 1.5
const WARN_FACTOR = 1.2

interface BenchItem {
  name: string
  iterations: number
  run: () => void
}

interface BenchResult {
  name: string
  medianMs: number
  minMs: number
  maxMs: number
}

// ─── 基准项 ───────────────────────────────────────────────────────────

const SAMPLE_SFC = `<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
const items = ref([{ id: 1, title: 'a' }, { id: 2, title: 'b' }])
function inc() { count.value++ }
</script>
<template>
  <view class="page">
    <text>{{ count }}</text>
    <view v-for="it in items" :key="it.id"><text>{{ it.title }}</text></view>
  </view>
</template>`

const BENCHMARKS: BenchItem[] = [
  {
    // 单 SFC 编译（template→wxml + script→逻辑层 + style→wxss）
    name: 'compile-vue-sfc',
    iterations: 30,
    run: () => {
      compileVueSfc(SAMPLE_SFC)
    },
  },
  {
    // setData 深层 diff：1000 项列表整体变更 → 叶路径补丁（diffPaths 全量）
    name: 'setdata-deep-diff-1000',
    iterations: 50,
    run: (() => {
      let n = 0
      return () => {
        const list = Array.from({ length: 1000 }, (_, i) => ({ id: i, v: n, title: `item-${n}` }))
        setDataBridge.markDirty('page/index', 'list', list)
        n += 1
      }
    })(),
  },
  {
    // HMR 批量应用：1000 payload（50 文件循环变更 → 同文件合并）
    name: 'hmr-apply-batch-1000',
    iterations: 30,
    run: (() => {
      const runtime = createHmrRuntime({ applyModule: () => true, reload: () => {} })
      const batch: HmrPayload[] = []
      for (let i = 0; i < 1000; i++) {
        batch.push({
          id: i + 1,
          file: `src/modules/mod-${i % 50}.vue`,
          type: 'vue',
          action: 'update',
          timestamp: Date.now(),
          code: `code-${i}`,
        })
      }
      return () => {
        runtime.reset() // applyBatch 按 id 幂等——每轮重置保证走全量路径
        runtime.applyBatch(batch)
      }
    })(),
  },
  {
    // Style Gate 可视化：100 条样式 × 五端原生值映射
    name: 'style-gate-collect-100',
    iterations: 50,
    run: (() => {
      const style: Record<string, unknown> = {}
      for (let i = 0; i < 100; i++) {
        style[`width-${i}`] = `${i}px`
      }
      style.color = '#ff0000'
      style.display = 'flex'
      return () => {
        collectStyleGateRecords(style, { platform: 'skyline', allPlatforms: true })
      }
    })(),
  },
  {
    // TraceBus 脱敏：1000 键对象（token/password 递归脱敏）
    name: 'trace-redact-1000',
    iterations: 50,
    run: (() => {
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < 1000; i++) {
        obj[`key-${i}`] = { token: 'secret', nested: { password: 'p' }, value: i }
      }
      return () => {
        redactValue(obj, ['token', 'password'])
      }
    })(),
  },
]

// ─── 测量与输出 ──────────────────────────────────────────────────────

function measure(item: BenchItem): BenchResult {
  const { name, iterations, run } = item
  // 预热（JIT 稳定）
  for (let i = 0; i < 3; i++) run()
  const samples: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    run()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]
  return { name, medianMs: round3(median), minMs: round3(samples[0]), maxMs: round3(samples[samples.length - 1]) }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

interface Baseline {
  updatedAt: string
  results: Record<string, { medianMs: number }>
}

function loadBaseline(): Baseline {
  if (!fs.existsSync(BASELINE_FILE)) return { updatedAt: '', results: {} }
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8')) as Baseline
  } catch {
    return { updatedAt: '', results: {} }
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const update = args.includes('--update')
  const json = args.includes('--json')
  const baseline = loadBaseline()

  const results = BENCHMARKS.map(measure)
  let errors = 0
  let warns = 0

  const rows: string[] = []
  for (const r of results) {
    const base = baseline.results[r.name]
    let status = '✓'
    if (base) {
      const ratio = r.medianMs / base.medianMs
      if (ratio > ERROR_FACTOR) {
        status = '✗'
        errors += 1
      } else if (ratio > WARN_FACTOR) {
        status = '⚠'
        warns += 1
      }
    } else {
      status = '＋' // 新增项（无基线）
    }
    rows.push({ ...r, status, base: base?.medianMs })
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          results: Object.fromEntries(rows.map((r) => [r.name, { medianMs: r.medianMs, status: r.status, baselineMs: r.base ?? null }])),
          errors,
          warns,
        },
        null,
        2,
      ),
    )
  } else {
    console.log('[bench] Proteus 功能基准（中位数 ms；回归门禁 >1.5x error / >1.2x warn）')
    console.log('-' .repeat(72))
    for (const r of rows) {
      const base = r.base !== undefined ? `基线 ${r.base}` : '无基线'
      console.log(`  ${r.status}  ${r.name.padEnd(24)} ${String(r.medianMs).padStart(8)} ms  [${base}]`)
    }
    console.log('-' .repeat(72))
    console.log(`  共 ${rows.length} 项 · error ${errors} · warn ${warns}${baseline.updatedAt ? ` · 基线更新于 ${baseline.updatedAt}` : ''}`)
  }

  if (update) {
    const next: Baseline = {
      updatedAt: new Date().toISOString(),
      results: Object.fromEntries(rows.map((r) => [r.name, { medianMs: r.medianMs }])),
    }
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true })
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + '\n')
    console.log(`[bench] 基线已写回：${path.relative(ROOT, BASELINE_FILE)}`)
  }

  process.exitCode = errors > 0 ? 1 : 0
}

main()

// hosts/ios/bridge/entry-v0-probe.ts —— V0 探针的**桌面 JSC** 执行入口（真机签名不可用时的替代通道）
//
// 【为什么存在这条通道】
//   V0 探针的**判读问题是机制性的**：「`v-memo` 等价物 / 组件拆分能否把单节点更新的
//   Vue 侧成本从 70ms 量级拉下来」。这不依赖具体设备，只依赖 Vue 的更新路径。
//   真机通道（hosts/ios/run-selfdraw.sh --bench）仍是**权威读数**，
//   但需要可用的签名身份；本通道用**桌面 JavaScriptCore**（与设备同引擎家族，
//   非 V8）跑同一份代码（bench-app.ts 与真机基准共用），给出**比率**与量级判断。
//
// ★诚实边界：桌面 JSC 的绝对毫秒**不等于**设备（JIT 策略/CPU 不同）——
//   本入口的读数只用于回答「比率与量级」，不得冒充真机数字。
//
// 用法：node hosts/ios/bridge/build-v0-probe.mjs && \
//       /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc dist/bundle-v0-probe.js

import { nextTick } from '@vue/runtime-core'
import { makeApp } from './bench-app'
import type { BenchStrategy } from './bench-app'

const now = (): number => Date.now()
const N = 1000
const ITERS = 7
const mid = Math.floor(N / 2)

interface Cell {
  strategy: BenchStrategy
  op: 'dot' | 'header'
  ms: number[]
  patches: number
  patchCount: number
  renders: number
  rowRenders: number
}

async function runCell(strategy: BenchStrategy, op: 'dot' | 'header'): Promise<Cell> {
  const app = makeApp(N, strategy)
  app.adapter.markFullSync()          // ★与真机 mountApp() 同款前置（否则永远走全量）
  const cell: Cell = { strategy, op, ms: [], patches: 0, patchCount: 0, renders: 0, rowRenders: 0 }
  for (let i = 0; i < ITERS; i++) {
    app.adapter.resetStats()
    const r0 = app.renderCount()
    const row0 = app.rowRenderCount()
    const t0 = now()
    // 交替取值 ⇒ 每次都是**真实变更**（否则第二次起就是空操作，读数无意义）
    if (op === 'dot') app.setDotSize(mid, i % 2 ? 20 : 36)
    else app.setHeaderMargin(i % 2 ? 20 : 12)
    await nextTick()
    cell.ms.push(now() - t0)
    const patches = app.adapter.takePatches()
    cell.patches = patches === null ? -1 : patches.length
    cell.patchCount = app.adapter.patchCount()
    cell.renders = app.renderCount() - r0
    cell.rowRenders = app.rowRenderCount() - row0
  }
  app.dispose()
  return cell
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

async function main(): Promise<void> {
  const engine = typeof (globalThis as { print?: unknown }).print === 'function' ? 'desktop JavaScriptCore (jsc)' : 'unknown'
  const out: Array<Record<string, unknown>> = []
  // ★预热：先跑一轮让 JIT 热身（读数取的是稳定态）
  await runCell('plain', 'dot')
  for (const op of ['dot', 'header'] as const) {
    for (const strategy of ['plain', 'memo', 'comp'] as const) {
      const c = await runCell(strategy, op)
      out.push({
        case: `V0_${strategy}_${op}`,
        strategy, op,
        ms_min: Math.min(...c.ms), ms_median: median(c.ms), ms_all: c.ms,
        patches_sent: c.patches, patch_count: c.patchCount,
        renders: c.renders, row_renders: c.rowRenders,
      })
    }
  }
  const payload = {
    kind: 'v0-probe',
    engine,
    items: N, iters: ITERS,
    note: '★桌面 JSC 比率读数；真机权威读数走 hosts/ios/run-selfdraw.sh --bench（需签名身份）',
    cells: out,
  }
  const json = JSON.stringify(payload, null, 2)
  if (typeof (globalThis as { print?: (s: string) => void }).print === 'function') {
    ;(globalThis as unknown as { print: (s: string) => void }).print('@@V0PROBE@@' + json + '@@END@@')
  } else {
    console.log(json)
  }
}

void main()

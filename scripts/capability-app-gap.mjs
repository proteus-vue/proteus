#!/usr/bin/env node
// scripts/capability-app-gap.mjs —— ★★★能力端 App 桥**缺口清单**（能力端主线的输入）
//
// 【它回答什么问题】「App（iOS/Android）还差哪些能力钩子的桥接线？」——按**源码事实**回答，
//   不是按手写清单：hook 取值里引用了哪些桥方法 → 这些方法在 App 桥工厂里是否存在。
//
// 【为什么单独成工具（而不是只看官网页面）】
//   · 官网能力页已经展示逐端状态，但它是**面向用户**的（含文案/降级说明），不适合当排期输入；
//   · 排期需要的是**可排序的清单**：缺什么方法、影响哪些 hook、是否基础能力（storage/location 之类
//     一旦缺就影响一大批业务）。
//   · ★并且本工具顺手守住一处**已知的谎报形态**：hook 经 runtime 间接引用桥（`res.connectWs(bridge,…)`）时，
//     旧解析器会抽到空 refs ⇒ 页面把「已接线」判成「未接线」（决策 #1112 的 websocket 实例）。
//     本工具与页面共用同一个抽取器（`website/scripts/lib/hook-bridge-refs.mjs`），不会再出现两套判定。
//
// 【口径（全部来自源码/构建事实）】
//   · 桥方法集 = `loadAppBridgeKeysFrom()`（决策 #881/#1067：锚定式解析 + 显式闭包登记）
//   · hook 依赖 = `extractHookBridgeRefs()`（含决策 #1112 的 runtime 间接展开）
//   · 判定：
//       ✅ 全部 refs 都在 App 桥  → App 端可接线
//       ❌ refs 非空但有缺失      → **真缺口**（列出缺的方法名）
//       ⚠️ refs 为空             → 无桥依赖 *或* 解析盲区（**需人工核**，不当作"已实现"）
//
// 【诚实边界】
//   · 「桥方法存在」≠「行为正确」：方法体可能是纯空壳（另有 `bridge-impl-reality` 守 MP/Web 侧）；
//     本工具只回答**接线面**，行为正确性由真机判据负责；
//   · 未覆盖鸿蒙（其宿主壳另有一套登记，见 `harmony-host-keys.mjs`）。
//
// 用法：node scripts/capability-app-gap.mjs [--json] [--verbose]
// 退出码：0 成功（缺口存在不是错误——这是排期输入，不是门禁）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = process.argv.includes('--json')
const VERBOSE = process.argv.includes('--verbose')

const { extractHookBridgeRefs, HOOK_FACTORY } = await import(
  path.join(ROOT, 'website/scripts/lib/hook-bridge-refs.mjs')
)
const { loadAppBridgeKeysFrom } = await import(path.join(ROOT, 'website/scripts/lib/app-bridge-keys.mjs'))

const apiSrc = fs.readFileSync(path.join(ROOT, 'packages/api/src/capability.ts'), 'utf8')
const { refs } = extractHookBridgeRefs(apiSrc, HOOK_FACTORY)
const appKeys = loadAppBridgeKeysFrom(ROOT).keys

// `probe()` 是**能力自检探针**（逐项探测 bridge 是否就绪），它不是业务能力，
//   却会因为"探测所有方法"而把每个缺失都算一遍 ⇒ 混进清单会虚增影响面（实测每个方法 +1）。
//   ⇒ 排除它。★这不是"过滤掉不好看的数据"，而是去掉一个**语义不同的消费者**。
const DIAGNOSTIC_HOOKS = new Set(['probe'])

const ok = []
const gaps = []
const blind = []
for (const [hook, list] of Object.entries(refs)) {
  if (DIAGNOSTIC_HOOKS.has(hook)) continue
  if (!list.length) { blind.push(hook); continue }
  const missing = list.filter((m) => !appKeys.has(m))
  if (missing.length) gaps.push({ hook, missing, refs: list })
  else ok.push(hook)
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    hookTotal: Object.keys(refs).length,
    appBridgeMethods: appKeys.size,
    ready: ok.length,
    gaps: gaps.map((g) => ({ hook: g.hook, missing: g.missing })),
    noBridgeRefs: blind,
  }, null, 2))
  process.exit(0)
}

console.log('[capability-app-gap] 能力端 App 桥缺口清单（源码事实推导）')
console.log(`  hook ${Object.keys(refs).length} 个 · App 桥 ${appKeys.size} 个方法`)
console.log(`  ✅ 可接线 ${ok.length} · ❌ 真缺口 ${gaps.length} · ⚠️ 无桥依赖/待核 ${blind.length}`)

// 缺一个方法影响多个 hook 时，按"影响面"排序更有用
const byMethod = new Map()
for (const g of gaps) {
  for (const m of g.missing) {
    if (!byMethod.has(m)) byMethod.set(m, [])
    byMethod.get(m).push(g.hook)
  }
}
const ranked = [...byMethod].sort((a, b) => b[1].length - a[1].length)
console.log('\n  按「一个桥方法影响多少 hook」排序（排期优先看这个）：')
for (const [m, hooks] of ranked) {
  console.log(`    ${String(hooks.length).padStart(2)} × ${m.padEnd(24)} ← ${hooks.join(', ')}`)
}

if (VERBOSE) {
  console.log('\n  逐 hook 明细：')
  for (const g of gaps) console.log(`    ${g.hook}: 缺 ${g.missing.join('/')}（refs: ${g.refs.join('/')}）`)
}
console.log('\n  ★口径：桥方法存在 ≠ 行为正确（空壳另由 bridge-impl-reality 守）；本工具只回答接线面。')
console.log('  ★本工具与官网能力页共用同一抽取器 ⇒ 页面状态与清单不会分叉。')

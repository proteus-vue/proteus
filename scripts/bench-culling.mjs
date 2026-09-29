// scripts/bench-culling.mjs —— ★卡 I5「overdraw culling」收益量化（零设备 · 秒级）
//
// 【测什么】4050 元素场景下，视口裁剪前后的**指令条数**与**生成耗时**。
//   ⇒ 对应卡 I5 的验收：「绘制耗时下降可测」+「4050 场景绘制耗时改善有数据」。
//
// 【为什么用指令条数当主判据（本仓纪律）】绘制的真实耗时在平台侧（Canvas/Skia），本地测不到；
//   但**指令条数与生成耗时**是它的**上游代理**——平台要执行的绘制命令少了多少，看条数最直接。
//   平台侧耗时另在真机用 gfxinfo 复核（见 ACCEPTANCE.md 的绘制口径）。
//
// 用法：npx tsx scripts/bench-culling.mjs [行数] [列数]
import { layoutTreeFromPNode, solveLayout, emitRenderCmds, attachParents } from '../packages/layout-core/src/index.ts'

const ROWS = Number(process.argv[2] ?? 50)
const COLS = Number(process.argv[3] ?? 40)
const CELL_W = 30, CELL_H = 18, GAP = 1
const V = { viewportWidth: 1080, viewportHeight: 2400, fontSize: 16, rootFontSize: 16 }
const L = (dp) => ({ kind: 'absolute', dp })

const pnode = (o) => ({ kind: 'view', props: { layout: {}, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } }, children: [], flags: { isStatic: true, flattenEligible: false, isLayoutBoundary: false, hasEvent: false, isNativeHost: false }, ...o })
const painted = (o) => pnode({ id: o.id, props: { layout: { flexDirection: 'column', width: L(o.w), height: L(o.h), flexShrink: 0, ...(o.extra ?? {}) }, paint: { backgroundColor: o.bg ?? '#285ac8' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } })

// 4050 结构：1 根 + 50 行 + 2000 格（每格一个背景）
const root = pnode({ id: 1, props: { layout: { flexDirection: 'column', width: L(COLS * (CELL_W + GAP)), height: L(ROWS * (CELL_H + GAP)) }, paint: { backgroundColor: '#000000' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } })
let id = 100
root.children = Array.from({ length: ROWS }, () => {
  const row = pnode({ id: id++, props: { layout: { flexDirection: 'row', height: L(CELL_H + GAP), flexShrink: 0, width: L(COLS * (CELL_W + GAP)) }, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } } })
  row.children = Array.from({ length: COLS }, () => painted({ id: id++, w: CELL_W, h: CELL_H }))
  return row
})

const tree = layoutTreeFromPNode([root], { lengthContext: V })
solveLayout(tree[0], { maxWidth: 1080, maxHeight: Infinity })
attachParents(tree[0])

const full = emitRenderCmds(tree)
// 视口 = 1080×800（一屏）：只有前 ~42 行可见
const culled = emitRenderCmds(tree, { cullToViewport: true, viewportWidth: 1080, viewportHeight: 800 })

const pct = (a, b) => `${(((a - b) / a) * 100).toFixed(1)}%`
console.log(`[culling] 场景 ${ROWS}×${COLS}（节点 ${id - 100 + 1}）· 视口 1080×800`)
console.log()
console.log(`  指令条数   全部 ${full.stats.cmdCount} → 裁剪后 ${culled.stats.cmdCount}   ↓ ${pct(full.stats.cmdCount, culled.stats.cmdCount)}`)
console.log(`  生成耗时   全部 ${full.stats.elapsedMs}ms → 裁剪后 ${culled.stats.elapsedMs}ms`)
console.log(`  裁剪读数   culledCount=${culled.stats.culledCount} · culledSubtrees=${culled.stats.culledSubtrees}`)
console.log()
const ok = culled.stats.cmdCount < full.stats.cmdCount && culled.stats.culledCount > 0
console.log(ok ? '  ✅ 裁剪生效（指令数下降）' : '  ❌ 未生效（检查视口或开关）')

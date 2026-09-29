// scripts/bench-merge-same-color.mjs —— ★卡 I5 执行项 3/3「同色相邻背景合并」收益量化（零设备 · 秒级）
//
// 【测什么】三类场景下合并前后的**指令条数**（平台绘制命令数的上游代理，同 bench-culling 口径）：
//   ① 等色长列表（1000 行同色）—— 合并的主战场
//   ② 斑马纹（隔行异色）—— **对照组**：应当一条都合并不了（证明判据不是"见到就合"）
//   ③ 4050 网格（50×40 同色、**行间有 1px 缝**）—— 验证"不严丝合缝不得合并"在规模下生效
//      （横向严丝合缝 ⇒ 每行并成一条；纵向有缝 ⇒ 不跨行并 ⇒ 期望 ~51 条而非 1 条）
//
// 用法：npx tsx scripts/bench-merge-same-color.mjs
import { layoutTreeFromPNode, solveLayout, emitRenderCmds, attachParents } from '../packages/layout-core/src/index.ts'
const L = (dp) => ({ kind: 'absolute', dp })
const pn = (o) => ({ kind: 'view', props: { layout: {}, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } }, children: [], flags: { isStatic: true, flattenEligible: false, isLayoutBoundary: false, hasEvent: false, isNativeHost: false }, ...o })
const bg = (id, w, h, color) => pn({ id, props: { layout: { flexDirection: 'column', width: L(w), height: L(h), flexShrink: 0 }, paint: { backgroundColor: color }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } })
const V = { viewportWidth: 1080, viewportHeight: 2400, fontSize: 16, rootFontSize: 16 }

function run(name, root, solveOpts) {
  const tree = layoutTreeFromPNode([root], { lengthContext: V })
  solveLayout(tree[0], solveOpts)
  attachParents(tree[0])
  const full = emitRenderCmds(tree)
  const merged = emitRenderCmds(tree, { mergeSameColorBg: true })
  const pct = (a, b) => `${(((a - b) / a) * 100).toFixed(1)}%`
  console.log(`${name}: 指令 ${full.cmds.length} → ${merged.cmds.length}（↓${pct(full.cmds.length, merged.cmds.length)}）· 合并读数 ${merged.stats.mergedBgCount}`)
}

// ① 等色长列表：1000 行同色背景（真实列表场景）
{
  const ROWS = 1000, H = 56, W = 390
  let id = 100
  const root = pn({ id: 1, props: { layout: { flexDirection: 'column', width: L(W), height: L(ROWS * H) }, paint: { backgroundColor: '#ffffff' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } })
  root.children = Array.from({ length: ROWS }, () => bg(id++, W, H, '#f5f5f5'))
  run('等色长列表 1000 行', root, { maxWidth: 1080, maxHeight: Infinity })
}

// ② 隔行异色（斑马纹）：应合并不了几对
{
  const ROWS = 1000, H = 56, W = 390
  let id = 100
  const root = pn({ id: 1, props: { layout: { flexDirection: 'column', width: L(W), height: L(ROWS * H) }, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } } })
  root.children = Array.from({ length: ROWS }, (_, i) => bg(id++, W, H, i % 2 ? '#ffffff' : '#f5f5f5'))
  run('斑马纹 1000 行（对照组）', root, { maxWidth: 1080, maxHeight: Infinity })
}

// ③ 4050 网格（50×40 同色格）
{
  const ROWS = 50, COLS = 40, CW = 30, CH = 18, G = 1
  let id = 100
  const root = pn({ id: 1, props: { layout: { flexDirection: 'column', width: L(COLS * (CW + G)), height: L(ROWS * (CH + G)) }, paint: { backgroundColor: '#000000' }, paintHint: { isMonochrome: false, isPureBackground: true, staticSubtree: false, needsCompositingLayer: false } } })
  root.children = Array.from({ length: ROWS }, () => {
    const row = pn({ id: id++, props: { layout: { flexDirection: 'row', height: L(CH + G), flexShrink: 0, width: L(COLS * (CW + G)) }, paint: {}, paintHint: { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false } } })
    row.children = Array.from({ length: COLS }, () => bg(id++, CW, CH, '#285ac8'))
    return row
  })
  run('4050 网格 50×40 同色（★有 1px 间隔 ⇒ 不应合并）', root, { maxWidth: 1080, maxHeight: Infinity })
}

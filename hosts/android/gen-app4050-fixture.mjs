// hosts/android/gen-app4050-fixture.mjs —— ★★对标 uni-app x「创建元素」场景的应用级夹具
//
// 【要解决的口径缺口】本仓此前的 4050 数字来自**引擎级合成场景**（`MainActivity.buildCmds()`
//   直接造 2000 条绘制指令）——而 uni-app x 基准的 229.2ms 是**应用级**
//   （点击 → 完整框架链路 → 渲染指令送达 OS）。两者不可比。
//   ⇒ 本脚本产出**真 SFC 编译 + 实例化**的 4050 元素树，设备端按应用级路径建树/排版/录制。
//
// 【规格对齐（逐条照搬基准）】
//   · 元素构成：**2050 view + 2000 text = 4050**（+1 根 = 4051 节点）
//     结构 = 50 行容器（row）× 40 格（cell，带背景色）+ 每格一个 text ⇒ 50 + 2000 = 2050 view ✓
//   · 每个 view **有背景色**（基准强调）；text 也带背景（与原生对照 `buildNativeTree` 严格同形——
//     该处注释写明「必须与 Proteus 侧画同样的东西」，否则绘制面积不同、数字不可比）
//
// 【为什么实例化在构建期做（运行时缺环，必须如实标注）】
//   Android **测试宿主没有 JS 引擎**（iOS 有 JSC）⇒ 模板实例化无法在设备上跑。
//   ⇒ 设备端测的是：**SFC 产物 → 建树 → 排版 → 生成指令 → 录制 DisplayList**——
//     即"组件已产出、进入渲染管线"这一段。这是本宿主的能力边界，报告里必须写明。
//
// 【产物】`app/src/main/assets/app-4050-tree.json`（生成物，勿手改）
//
// 用法：node hosts/android/gen-app4050-fixture.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const ASSET = path.join(HERE, 'app/src/main/assets/app-4050-tree.json')

// ★与基准一致的行列（50 × 40 = 2000 格）
const ROWS = 50
const COLS = 40

// 格尺寸与现有原生对照（`buildNativeTree`：cellW=30, cellH=18, gap=1）对齐，
// 保证两边的绘制面积与指令条数量级一致。
const CELL_W = 30
const CELL_H = 18
const GAP = 1

// ★★SFC 由脚本**程序化生成**（40 列若手写会是一屏墙）：
//   · 一行 `v-for`（外层行列表）+ 行内 **40 个显式格**
//   · 为什么不用嵌套 v-for：**构建期实例化只展开一层列表**（本仓实测：嵌套 v-for 的
//     内层槽位在 `instantiateTemplate` 里不被展开，`table.sources` 只出 2 个 list-data
//     槽位、无 list-item ⇒ 整树只出 1 个节点）。这是**诚实的能力边界**，写在报告里。
//   · 行内必须有**绑定**才会产出 list-item 槽位（无绑定则行数据无意义）——
//     故第一格用 `{{ row.label }}`（同时满足基准"text 有内容"）。
const CELL_HTML = Array.from({ length: COLS }, () =>
  '      <p-view style="width: ' + CELL_W + 'px; height: ' + CELL_H + 'px; flex-shrink: 0; margin-right: ' + GAP + 'px; background-color: #285ac8"><p-text style="font-size: 8px; color: #ffffff; background-color: #285ac8">item</p-text></p-view>',
).join('\n')

const sfc = `<template>
  <p-view style="flex-direction: column; width: 1080px; padding-top: 20px; padding-left: 16px">
    <p-view v-for="row in grid" :key="row.id" :width="row.w" style="flex-direction: row; height: ${CELL_H}px; flex-shrink: 0; margin-bottom: ${GAP}px">
${CELL_HTML}
    </p-view>
  </p-view>
</template>

<script setup lang="ts">
const grid = ref([{ id: 1, w: 1080 }])
</script>
`

const script = `
import { buildVaporSubscriptions, buildLayoutTemplate } from ${JSON.stringify(path.join(ROOT, 'packages/compiler/src/index.ts'))}
import { instantiateTemplate, ListRegistry } from ${JSON.stringify(path.join(ROOT, 'packages/slot-runtime/src/index.ts'))}

const sfc = ${JSON.stringify(sfc)}
const tpl = buildLayoutTemplate(sfc, 'app4050.vue').template
const { table } = buildVaporSubscriptions(sfc, 'app4050.vue')
const ROWS = ${ROWS}, COLS = ${COLS}
const grid = Array.from({ length: ROWS }, (_, r) => ({
  id: r + 1,
  cells: Array.from({ length: COLS }, (_, c) => ({ id: r * COLS + c + 1, label: 'item' })),
}))
const data: any = { grid }
const inst = instantiateTemplate(tpl, {
  viewport: { width: 1080, height: 2400 },
  read: (n) => data[n],
  table,
  registry: new ListRegistry(),
})
const nodes = inst.nodes
const byTag = {}
for (const n of nodes) { const t = n.tag || '?'; byTag[t] = (byTag[t] || 0) + 1 }
process.stdout.write(JSON.stringify({
  ok: true,
  viewport: inst.viewport,
  nodes,
  stats: inst.stats,
  templateNodes: tpl.nodes.length,
  byTag,
}))
`

const tmpDir = fs.mkdtempSync(path.join(ROOT, '.tmp-app4050-'))
const tmpScript = path.join(tmpDir, 'gen.ts')
fs.writeFileSync(tmpScript, script)
let raw
try {
  raw = execFileSync('npx', ['tsx', tmpScript], { cwd: ROOT, encoding: 'utf-8' })
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
const out = JSON.parse(raw)
const nodes = out.nodes
if (process.env.DEBUG_4050) {
  fs.writeFileSync('/tmp/app4050-debug.json', JSON.stringify(nodes, null, 1))
  console.error('[debug] nodes 已写 /tmp/app4050-debug.json')
}
// ★判据用「有 text 键」而不是「非空 text」：空文本可能是**初始值回填**的问题，
//   与"这个节点是不是 text 元素"无关（本仓实测：原判据把 50 个空文本误算成 view ⇒ 假失败）
const texts = nodes.filter((n) => n.text !== undefined && n.text !== null)
const views = nodes.length - texts.length

// ── ★规格断言：不满足基准构成就直接失败（防"生成完才发现数字不对"）────────────
const EXPECTED_VIEWS = ROWS * COLS + ROWS          // 2000 格 + 50 行 = 2050
const EXPECTED_TEXTS = ROWS * COLS                 // 2000
const EXPECTED_TOTAL = EXPECTED_VIEWS + EXPECTED_TEXTS // 4050（+1 根不计入基准口径）
// 行数据：只实例化一次模板行（构建期夹具），运行时不再展开（本宿主无 JS 引擎，见文件头）
const problems = []
if (texts.length !== EXPECTED_TEXTS) problems.push(`text 数 ${texts.length} ≠ ${EXPECTED_TEXTS}`)
if (views !== EXPECTED_VIEWS + 1) problems.push(`非 text 节点数 ${views} ≠ ${EXPECTED_VIEWS + 1}（含根）`)
if (nodes.length !== EXPECTED_TOTAL + 1) problems.push(`节点总数 ${nodes.length} ≠ ${EXPECTED_TOTAL + 1}`)
if (problems.length) {
  console.error('[app4050-fixture] ✗ 规格不符（基准要求 2050 view + 2000 text = 4050）')
  for (const p of problems) console.error(`    · ${p}`)
  console.error(`    实际按 tag：${JSON.stringify(out.byTag)}`)
  process.exit(2)
}

fs.writeFileSync(
  ASSET,
  JSON.stringify({
    note: '★★生成物（勿手改）——对标 uni-app x「创建元素」场景（2050 view + 2000 text）；生成：node hosts/android/gen-app4050-fixture.mjs',
    spec: { rows: ROWS, cols: COLS, cellW: CELL_W, cellH: CELL_H, gap: GAP,
      views: EXPECTED_VIEWS, texts: EXPECTED_TEXTS, elements: EXPECTED_TOTAL },
    compiler: { templateNodes: out.templateNodes },
    viewport: out.viewport,
    nodes,
  }),
)
console.log('[app4050-fixture] ✅ 生成 assets/app-4050-tree.json')
console.log(`    节点 ${nodes.length}（view ${views} + text ${texts.length}）· 规格 ${EXPECTED_TOTAL} 元素`)
console.log(`    按 tag：${JSON.stringify(out.byTag)}`)

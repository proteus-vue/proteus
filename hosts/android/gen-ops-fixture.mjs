// hosts/android/gen-ops-fixture.mjs —— ★★生成 Android 侧的 **Vapor 指令流 golden 夹具**
//
// 【为什么要有它（Android 那条缺口）】上一轮补齐了 `nativeApplyOps` 的 JNI 出口，但**没有端到端用例**：
//   · iOS 侧由 JSC 里的 JS 现场编码（`applyOps`），Android 这个测试宿主**没有 JS 引擎**
//     ⇒ 没有编码端，指令流从哪来？
//   · 若在 Java 里**再写一份编码器** ⇒ 那是第三份实现，且测的是"我自己编我自己解"，
//     跨语言契约根本没被验证（本仓纪律：只测自身往返等于没测）。
//
// 【正解（沿用本仓既有的跨语言 golden 纪律）】
//   在**构建期**用 TS 的真实编码器（`@proteus-vue/slot-runtime` 的 `encodeOps`）编码一份指令流，
//   把**字节**冻进 Java 源码；设备上由**核心解码**并断言几何 == TS 侧声明的期望值。
//   ⇒ 契约被真正跨语言验证：TS 编码（桌面）→ Rust 解码（真机 arm64 + JNI 编组）。
//
// 【产物】`app/src/main/java/dev/proteus/layoutcore/dev/OpsFixture.java`（生成物，勿手改）
//
// 用法：node hosts/android/gen-ops-fixture.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(HERE, 'app/src/main/java/dev/proteus/layoutcore/dev/OpsFixture.java')

// ── 场景（必须在 TS 侧与设备侧**同源**：树由本脚本产出，设备照发） ──
//
// 树形状（3 个节点，全部是布局边界 ⇒ 改一个叶子只应重排该行）：
//   0  根 column  宽度 400
//   1  row       宽度 400 高 60   ← **布局边界**（有显式宽高）
//   2  叶子      挂在 1 下，宽 50 高 30
//
// 指令：SET_STYLE(2, layout.width, 180) ⇒ 改宽度
//   期望：节点 2 的几何宽度变成 **180**（这个数来自**指令本身**，
//   不是"核心自己算出来的另一个数" ⇒ 断言不是循环论证）。
const WIDTH_BEFORE = 50
const WIDTH_AFTER = 180

const script = `
import { encodeOps, PropKeyTable, StringPool } from '${path.join(ROOT, 'packages/slot-runtime/src/index.ts')}'
const keys = new PropKeyTable()
const strings = new StringPool()
const ops = [{ op: 0x02, nodeId: 2, keyId: keys.intern('layout.width'), value: ${WIDTH_AFTER} }]
const bytes = encodeOps(ops, keys, strings)
process.stdout.write(JSON.stringify({
  bytes: Array.from(bytes),
  keys: keys.toArray(),
  strings: strings.toArray(),
  opCount: ops.length,
  widthBefore: ${WIDTH_BEFORE},
  widthAfter: ${WIDTH_AFTER},
  nodeId: 2,
}))
`
const raw = execFileSync('npx', ['tsx', '-e', script], { cwd: ROOT, encoding: 'utf-8' })
const fx = JSON.parse(raw)

/* ══════════ ★整树级虚拟化夹具：SFC → 模板实例化（与 iOS 同一份 SFC / 同一生产者） ══════════ */
//
// 【为什么用同一份 SFC（跨端可比的关键）】iOS 的 V11/V12 用的是 `hosts/ios/bridge/gen-vapor-table.mjs`
//   里那份 SFC（页面 + 标题 + v-for 行）。Android 若要"能消费 SFC 产出"，就该吃**同一份产物**
//   —— 否则两端的"已验证"说的不是同一件事（本仓纪律：先问比较对象是否可比）。
//   ⇒ 本脚本在同一构建期跑同一份 SFC 的编译 + 实例化，产出 `{viewport, nodes, rows}` 落进 assets。
//
// 【为什么落 assets 而不是冻进 Java 源码】1500+ 节点的 JSON 塞进 Java 字符串字面量既难读也难 diff；
//   assets 是本仓既有通路（`build-and-run.sh` 的 `aapt2 -A` 已在打包它）。
const TREE_ROWS = 500
const vaporSfc = `<template>
  <p-view style="flex-direction: column; padding-top: 60px; padding-left: 16px; background-color: #101020">
    <p-text style="font-size: 24px; color: #ffffff; margin-bottom: 12px">Vapor 全量 SFC</p-text>
    <p-view v-for="item in list" :key="item.id" style="flex-direction: row; align-items: center; height: 56px; flex-shrink: 0; margin-bottom: 8px; background-color: #1b1b21; border-radius: 12px">
      <p-view :width="item.dotW" style="height: 36px; flex-shrink: 0; background-color: #6f4ae8; border-radius: 18px" />
      <p-text :width="item.textW" style="font-size: 16px; color: #ffffff">{{ item.title }}</p-text>
    </p-view>
  </p-view>
</template>

<script setup lang="ts">
const list = ref([{ id: 1, dotW: 36, textW: 120, title: 'a' }])
</script>
`
const treeScript = `
import { buildVaporSubscriptions, buildLayoutTemplate } from '${path.join(ROOT, 'packages/compiler/src/index.ts')}'
import { instantiateTemplate, ListRegistry } from '${path.join(ROOT, 'packages/slot-runtime/src/index.ts')}'

const sfc = ${JSON.stringify(vaporSfc)}
const tpl = buildLayoutTemplate(sfc, 'android.vue').template
const { table } = buildVaporSubscriptions(sfc, 'android.vue')
const ROWS = ${TREE_ROWS}
const rows = Array.from({ length: ROWS }, (_, i) => ({
  id: i + 1, dotW: 36, textW: 120, title: '行 ' + (i + 1),
}))
const data: any = { list: rows }
const inst = instantiateTemplate(tpl, {
  viewport: { width: 400, height: 844 }, read: (n) => data[n], table, registry: new ListRegistry(),
})
process.stdout.write(JSON.stringify({
  ok: !!(inst.virtual && inst.virtual.rows.length === ROWS),
  viewport: inst.viewport,
  nodes: inst.nodes,
  rows: inst.virtual ? inst.virtual.rows : [],
  stats: inst.stats,
  templateNodes: tpl.nodes.length,
  rowSubtree: tpl.lists.length ? tpl.lists[0].subtreeIds.length : 0,
}))
`
const tmpTreeDir = fs.mkdtempSync(path.join(ROOT, '.tmp-tree-fixture-'))
const tmpTreeScript = path.join(tmpTreeDir, 'tree-fixture.ts')
fs.writeFileSync(tmpTreeScript, treeScript)
const treeRaw = execFileSync('npx', ['tsx', tmpTreeScript], { cwd: ROOT, encoding: 'utf-8' })
fs.rmSync(tmpTreeDir, { recursive: true, force: true })
const tree = JSON.parse(treeRaw)
if (!tree.ok) {
  console.error(`✗ SFC 实例化未产出虚拟化描述（rows=${tree.rows.length}）`)
  process.exit(2)
}
const TREE_ASSET = path.join(HERE, 'app/src/main/assets/vapor-tree.json')
fs.mkdirSync(path.dirname(TREE_ASSET), { recursive: true })
fs.writeFileSync(TREE_ASSET, JSON.stringify({
  note: '★★生成物（勿手改）——与 iOS V11/V12 同一份 SFC 的实例化产物；生成：node hosts/android/gen-ops-fixture.mjs',
  sfc_rows: TREE_ROWS,
  row_subtree: tree.rowSubtree,
  ...tree,
}))
console.log(`[android-ops-fixture] ✅ 生成 assets/vapor-tree.json`)
console.log(`    ${tree.nodes.length} 节点 · ${tree.rows.length} 行 · 每行 ${tree.rowSubtree} 节点`)

/* ── ★组装 splice 夹具：payload 取自**适配器真实产出**（`takeSplice()`） ── */
//
// 【为什么 splice 也要跨语言夹具（与 applyOps 同一纪律）】splice 的 payload 是
//   `{removes, inserts:[{parentId, nodes:[…], index}], textMeasures}`——由**适配器**产出。
//   在 Java 里手搓一份 ⇒ 又是"自己造输入自己验"，测不出适配器与核心的契约。
//   ⇒ 构建期跑真实适配器（追加一行）→ 冻结其 `takeSplice()` 输出 → 设备照发。
// ★与 build-bench.mjs 同法：`@vue/runtime-core` 是 renderer-app 的依赖，
//   仓库根不解析它 ⇒ 用 createRequire 从声明它的包位置显式解析（不猜路径）。
const requireFromApp = createRequire(path.join(ROOT, 'packages/renderer-app/package.json'))
const VUE_RUNTIME_CORE = requireFromApp.resolve('@vue/runtime-core')

// ★用**临时 .ts 文件**跑（不用 `tsx -e`）：动态 `import()` 不走 tsx 的 .ts 加载器，
//   而静态 import 需要文件级语法环境 ⇒ 写临时文件是唯一稳的形态。
const spliceScript = `
import { h, ref, nextTick } from '@vue/runtime-core'
import { createAppRenderer } from '@PROTEUS_RENDERER_APP@'
import { createSelfDrawAdapter } from '@PROTEUS_SELFDRAW@'

const adapter = createSelfDrawAdapter()
const renderer = createAppRenderer(adapter)
const items = ref([{ id: 1 }, { id: 2 }])
const App = { render: () => h('p-view', { style: { flexDirection: 'column' } },
  items.value.map((it: any) => h('p-view', { key: it.id, style: { height: 50, flexShrink: 0 } }))) }
const container = adapter.createElement('p-view')
adapter.root.children.push(container)
container.parent = adapter.root

async function main() {
  const app = renderer.createApp(App)
  app.mount(container)
  await nextTick()
  adapter.markFullSync()
  items.value = [{ id: 1 }, { id: 2 }, { id: 3 }]
  await nextTick()
  const splice = (adapter as any).takeSplice()
  const inserts = splice && splice.inserts ? splice.inserts : []
  let nodeCount = 0
  for (const ins of inserts) nodeCount += (ins.nodes || []).length
  process.stdout.write(JSON.stringify({
    splice,
    insertedNodes: nodeCount,
    inserts: inserts.length,
    textMeasures: (splice && splice.textMeasures) ? splice.textMeasures : {},
  }))
}
main()
`
  .replace('@PROTEUS_RENDERER_APP@', path.join(ROOT, 'packages/renderer-app/src/index.ts'))
  .replace('@PROTEUS_SELFDRAW@', path.join(ROOT, 'packages/renderer-app/src/adapters/selfdraw.ts'))

// ★临时脚本必须落在**仓库内**（不能在系统 tmpdir）：tsx 按 tsconfig/包上下文决定
//   是否做 TS 转换，仓库外的 .ts 会被当**原生 ESM** 跑 ⇒ 类型注解直接 SyntaxError（实测踩到）。
const tmpDir = fs.mkdtempSync(path.join(ROOT, '.tmp-ops-fixture-'))
const tmpScript = path.join(tmpDir, 'splice-fixture.ts')
fs.writeFileSync(tmpScript, spliceScript)
if (process.env.DUMP_FIXTURE) { console.log('=== SCRIPT ==='); console.log(spliceScript); process.exit(0) }

const spliceRaw = execFileSync('npx', ['tsx', tmpScript], { cwd: ROOT, encoding: 'utf-8' })
const sp = JSON.parse(spliceRaw)
fs.rmSync(tmpDir, { recursive: true, force: true })
if (!sp.splice) {
  console.error('✗ 适配器未产出 splice（夹具无法生成）')
  process.exit(2)
}

/** 字节数组 → Java 的 `new byte[]{...}` 字面量（每行 16 个，便于 diff） */
const byteLiteral = (() => {
  const parts = []
  for (let i = 0; i < fx.bytes.length; i += 16) {
    parts.push('        ' + fx.bytes.slice(i, i + 16).map((b) => `(byte) ${b}`).join(', '))
  }
  return parts.join(',\n')
})()

const java = `package dev.proteus.layoutcore;

/**
 * ★★**Vapor 指令流 golden 夹具**（**生成物，勿手改**——改请跑 \`node hosts/android/gen-ops-fixture.mjs\`）。
 *
 * 【这份夹具在验证什么（跨语言契约，本仓纪律）】
 *   TS 的真实编码器（\`@proteus-vue/slot-runtime\` 的 \`encodeOps\`）在**构建期**编出字节，
 *   冻在这里；设备上由 **Rust 核心解码**（经 JNI \`nativeApplyOps\`）并执行。
 *   ⇒ 若两侧对**字段宽度 / 端序 / 操作码号 / 池布局**的理解有任何分歧，设备侧会直接红。
 *   ★为什么不在 Java 里再写一个编码器：那是第三份实现，且只测出"我自己编我自己解"
 *     —— 跨语言契约根本没被验证（本仓纪律：只测自身往返等于没测）。
 *
 * 场景：3 节点小树（根 column → row(边界) → 叶子），指令为
 *   SET_STYLE(nodeId=2, layout.width, 期望宽度)
 * 期望：设备上该节点几何宽度 == **期望宽度**（该值来自**指令输入**，
 *   不是"核心算出的另一个数" ⇒ 断言不是循环论证）。
 * ★本块不得含反引号或美元花括号（它在生成器的 JS 模板串里——见 check:script-compile 的护栏）。
 */
public final class OpsFixture {
    private OpsFixture() {}

    /** TS 编码器产出的指令流（${fx.bytes.length} 字节：20B 头 + 键池 + 串池 + 指令体） */
    public static final byte[] OPS_BYTES = new byte[] {
${byteLiteral}
    };

    /** 键池（诊断用：确认池布局与 TS 侧一致） */
    public static final String[] KEYS = new String[] { ${fx.keys.map((k) => `"${k}"`).join(', ')} };

    /** 节点 id（指令作用对象） */
    public static final int NODE_ID = ${fx.nodeId};

    /** 改动前的宽度（设备侧先断言基线，再发指令） */
    public static final float WIDTH_BEFORE = ${fx.widthBefore}f;

    /** 指令声明的期望宽度（**判据值**——来自编码端的输入，非核心自报） */
    public static final float WIDTH_AFTER = ${fx.widthAfter}f;

    /** 指令条数（与 Rust 解码结果对账） */
    public static final int OP_COUNT = ${fx.opCount};

    /* ══════════ ★splice（结构变更）夹具：payload 取自**适配器真实产出** ══════════ */

    /**
     * 适配器 takeSplice() 的真实输出（追加一行）——由构建期跑真实适配器得到，**非手搓**。
     *
     * 形状：{removes:[…], inserts:[{parentId, nodes:[…], index}], textMeasures:{…}}
     * ★本块不得含反引号或美元花括号（在生成器 JS 模板串里——见护栏）。
     */
    public static final String SPLICE_JSON = ${JSON.stringify(JSON.stringify(sp.splice))};

    /** 该 splice 插入的节点数（与核心回报的 inserted 对账） */
    public static final int SPLICE_NODE_COUNT = ${sp.insertedNodes};

    /** 插入块数 */
    public static final int SPLICE_INSERT_COUNT = ${sp.inserts};

    /** 文本度量（适配器从宿主回传的度量表；本夹具场景无文本 ⇒ 空对象） */
    public static final String SPLICE_MEASURES = ${JSON.stringify(JSON.stringify(sp.textMeasures))};
}
`
// ── ★★`--check` 模式（2026-09-29 新增）──────────────────────────────────────
//
// 【为什么必须有（本会话实测的隐患）】本生成器此前**没有校验模式**，而产物**已入库**
//   （`OpsFixture.java` 是生成物但刻意入库供宿主编译）。实测发现：
//   入库的夹具版本是 **v1**，而协议早已是 **v2** ⇒ **生成物与源不同步**。
//   ★为什么没被发现：`build-and-run.sh` 步骤 ①.5 **每次构建都会重新生成**夹具
//     ⇒ 真机上跑的永远是新版 ⇒ **真机测试抓不到这个漂移**（只有"克隆后不构建就编译"才踩到）。
//   ⇒ 与 `gen:docs` / `gen:content` 同款处置：**生成物必须有 `--check` 门禁**，防静默漂移。
const CHECK = process.argv.includes('--check')
if (CHECK) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : ''
  if (existing.trim() !== java.trim()) {
    console.error(`✗ 指令流夹具漂移：${path.relative(ROOT, OUT)}`)
    console.error('  ⇒ 跑 `node hosts/android/gen-ops-fixture.mjs` 重新生成（改了协议/编码器/适配器后必须重生成）')
    console.error('  ★症状提示：若这是协议版本漂移（v1 vs v2），真机测试**不会红**（构建期会自动重生成）')
    console.error('    —— 只有本门禁能拦住它。')
    process.exit(1)
  }
  console.log(`✅ 指令流夹具与源一致（${fx.bytes.length} 字节 · ${fx.opCount} 条指令 · 版本在字节内）`)
  process.exit(0)
}

fs.writeFileSync(OUT, java)
console.log(`[android-ops-fixture] ✅ 生成 ${path.relative(ROOT, OUT)}`)
console.log(`    ${fx.bytes.length} 字节 · ${fx.opCount} 条指令 · 键池 [${fx.keys.join(', ')}]`)
console.log(`    期望：节点 ${fx.nodeId} 宽度 ${fx.widthBefore} → ${fx.widthAfter}`)

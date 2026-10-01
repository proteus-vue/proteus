// hosts/android/gen-vapor-fixture.mjs —— ★★**编译产物生成**（构建路径上的一步）
//
// 【它产出什么】`app/src/main/assets/vapor-artifacts.json`：
//   `{ sfc, tpl, table }` —— 编译器两件产物的**纯 JSON** 形态（LayoutTemplate + SubscriptionTable）。
//   设备端（`bundle-vapor.js`）拿它做实例化 + 订阅驱动更新（见 entry-vapor.ts 头注的分工）。
//
// 【为什么编译必须在构建期（README 式的一段）】
//   编译器依赖 `@babel/core` + `@vue/compiler-sfc`——二者引用 Node API
//   （browser 构建里 `path`/`fs` 被 externalize，代码里有 `Buffer`）⇒ **进不了 QuickJS**。
//   而实例化 + 订阅更新只依赖 `@proteus-vue/slot-runtime`（纯 TS 零 Node API，50KB）⇒ 可以进。
//   ★这正是产品形态：`proteus build` 编译、App 运行时实例化 + 更新。
//
// 【★为什么这条夹具是"真实 SFC"而不是手写节点表（本仓的缺口原文）】
//   `gen-app4050-fixture.mjs` 的注释写着「Android 测试宿主没有 JS 引擎 ⇒ 模板实例化无法在
//   设备上跑」——**该前提已过期**。本文件与 `bundle-vapor.js` 合起来把那条链补上：
//   SFC（真模板语法：静态样式字符串 + v-for + `:width` 绑定 + 插值文本）→ 编译 → 设备端。
//
// 【产物形态（判据依赖它）】
//   · `tpl.ok` 必须 true（否则设备端直接报错退出——不静默）；
//   · `table.stats.l1 > 0`（行内槽位必须真的进 L1，否则"订阅驱动更新"没东西可驱动）；
//   · `table.sources` 里必须有 `list` 源（行作用域求值的入口）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(HERE, 'app/src/main/assets/vapor-artifacts.json')

/**
 * 夹具 SFC：覆盖「页面 + 静态样式 + v-for 行 + 行内绑定 + 静态文本」——
 * ★尺寸用**明确 px**（不用百分比）：`parseStaticStyle` 只支持 px/纯数值，
 *   百分比会报诊断并被忽略（这是模板产物的**如实能力边界**，见 template.ts 的 LAYOUT_FIELDS）。
 *   ★根给 1080×1600 是**让内容真的铺开**（首跑 468 像素采样 = 根无宽度 ⇒ 只画了窄窄一列）。
 *  与 `tests/vapor-sfc-to-tree.test.ts` 同源形态（那边是 Node 判据，这里是设备侧）。 */
const SFC = `<template>
  <p-view style="width: 1080px; height: 1600px; flex-direction: column; padding-top: 24px; background-color: #14141c">
    <p-text style="font-size: 20px; color: #ffffff; margin-bottom: 12px">Vapor · 设备端</p-text>
    <p-view v-for="item in list" :key="item.id" style="height: 44px; margin-bottom: 6px; background-color: #285ac8">
      <p-text :width="item.w" style="font-size: 12px; color: #ffffff">{{ item.title }}</p-text>
    </p-view>
  </p-view>
</template>

<script setup lang="ts">
const list = ref([{ id: 1, w: 40, title: 'a' }])
</script>
`

// 用 tsx 跑编译器（与 gen-app4050-fixture.mjs 同一手法：临时脚本 + 真包）
const script = `
import { buildLayoutTemplate, buildVaporSubscriptions } from ${JSON.stringify(path.join(ROOT, 'packages/compiler/src/index.ts'))}
const sfc = ${JSON.stringify(SFC)}
const tplRes = buildLayoutTemplate(sfc, 'vapor-device.vue')
const subRes = buildVaporSubscriptions(sfc, 'vapor-device.vue')
process.stdout.write(JSON.stringify({
  ok: tplRes.ok,
  diagnostics: tplRes.diagnostics.map((d) => d.message),
  tpl: tplRes.template,
  table: subRes.table,
  sfc,
}))
`

const tmpDir = fs.mkdtempSync(path.join(ROOT, '.tmp-vapor-'))
const tmpScript = path.join(tmpDir, 'gen.ts')
fs.writeFileSync(tmpScript, script)
let raw
try {
  raw = execFileSync('npx', ['tsx', tmpScript], { cwd: ROOT, encoding: 'utf-8' })
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
const out = JSON.parse(raw)

// ── 规格断言：不满足就**当场失败**（防"跑到设备上才发现产物不对"）──────────────
const fail = (msg) => {
  console.error('[gen-vapor-fixture] ✗ ' + msg)
  if (out.diagnostics?.length) console.error('  编译器诊断：' + out.diagnostics.join(' | '))
  process.exit(1)
}
if (out.ok !== true) fail('模板产物不可用（tpl.ok=false）')
const tplNodes = out.tpl.nodes.length
if (tplNodes < 4) fail(`模板节点数异常：${tplNodes}（夹具应有 页面+标题+行根+行内文本 共 ≥4）`)
const l1 = out.table.stats.l1
if (!(l1 > 0)) fail(`订阅表 L1 槽位为 0——行内绑定（:width / 插值）没进 L1，订阅驱动更新无物可驱`)
const srcNames = out.table.sources.map((s) => s.sourceName)
if (!srcNames.includes('list')) fail(`订阅表缺 'list' 源（实际：${srcNames.join(',')}）——行作用域求值无入口`)
const itemSlots = out.table.sources.flatMap((s) => s.slots).filter((x) => x.kind === 'list-item')
if (itemSlots.length === 0) fail('订阅表里没有 list-item 槽位——v-for 行内更新将退化')

fs.writeFileSync(OUT, JSON.stringify(out))
const kb = (fs.statSync(OUT).size / 1024).toFixed(1)
console.log(
  `[gen-vapor-fixture] ✅ ${path.relative(ROOT, OUT)}（${kb} KB）· 模板 ${tplNodes} 节点 · ` +
    `L1 ${l1} / L0 ${out.table.stats.l0}（覆盖率 ${(out.table.stats.l1Rate * 100).toFixed(1)}%）· ` +
    `源 [${srcNames.join(', ')}] · 行内槽位 ${itemSlots.length}`,
)

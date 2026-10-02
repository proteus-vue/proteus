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
//
// 【★两份产物（2026-10-01 扩容：长列表虚拟化）】
//   · `vapor-artifacts.json` —— 短列表夹具（8 行）：跑「设备端实例化 + 订阅驱动增量」；
//   · `vapor-list-artifacts.json` —— **长列表夹具**（1000 行、行高 100px）：跑
//     「虚拟化」——整树进内核（几何正确），但**宿主只物化可见区**（行物化有界）。
//     判据：物化行数/指令数恒定有界 · 滚动真的动了（像素签名）· 回顶签名**恒等** · 复用率。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
// ★★A/B（第二份产物）需要的 import——**文件级**（不能放生成器的 tsx 模板字符串里）
import { parseStaticStyle, parsePaintDeclAttr, isPaintDeclAttr } from '../../packages/compiler/dist/index.js'
import { parse as sfcParse, compileTemplate } from '@vue/compiler-sfc'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(HERE, 'app/src/main/assets/vapor-artifacts.json')
/** 长列表产物（虚拟化通路用） */
const OUT_LIST = path.join(HERE, 'app/src/main/assets/vapor-list-artifacts.json')
/**
 * ★★★六端 SFC 压力夹具产物（2026-10-02）——**源是 examples 里的真实页面文件**。
 *
 * 【为什么单独一份产物】上一版 L4 夹具是六端手写声明（各自 wxml/html/Java/Swift 写一遍）；
 *   本产物让 iOS/Android 渲染**同一份 SFC 源码**（examples/pages/consistency-stress.vue），
 *   与 Web/MP 端跑的是同一个文件 ⇒ "一份源码六端渲染"第一次成立。
 *   ★`data` 字段：从 SFC script 解析出的**初始数据快照**——移动端不执行 script
 *   （Vapor 的定位是"模板实例化"），故构建期把数据抽出来内嵌 ⇒ 三端渲染的
 *   **模板 + 数据**都同源（改 SFC 一处，六端一起变）。
 */
const OUT_STRESS = path.join(HERE, 'app/src/main/assets/vapor-stress-artifacts.json')
/** 共享 SFC 源（**唯一事实源**：examples 页面与移动端产物同读此文件） */
const STRESS_SFC_PATH = path.join(ROOT, 'examples/pages/consistency-stress.vue')

/**
 * 夹具 SFC：覆盖「页面 + 静态样式 + v-for 行 + 行内绑定 + 静态文本」——
 * ★尺寸用**明确 px**：`parseStaticStyle` 支持 px/纯数值 + **宽高百分比**（→ widthRatio，
 *   2026-10-02 补齐）；**其余属性**的百分比仍不支持（报诊断并被忽略）。
 *   ★根给 1080×1600 是**让内容真的铺开**（首跑 468 像素采样 = 根无宽度 ⇒ 只画了窄窄一列）。
 *  与 `tests/vapor-sfc-to-tree.test.ts` 同源形态（那边是 Node 判据，这里是设备侧）。 */
const SFC = `<template>
  <p-view style="width: 1080px; height: 1600px; flex-direction: column; padding-top: 24px; background-color: #14141c">
    <p-text style="font-size: 20px; color: #ffffff; margin-bottom: 12px">Vapor · 设备端</p-text>
    <p-view style="height: 90px; margin-bottom: 8px; border-radius: 18px; background-color: #2a3f66"></p-view>
    <p-view style="height: 90px; margin-bottom: 8px" fill-gradient='{"kind":"linear","angle":90,"stops":[{"offset":0,"color":"#7c5cff"},{"offset":1,"color":"#ff9a6c"}]}'></p-view>
    <p-view style="height: 90px; margin-bottom: 8px; background-color: #1f2c44" glow='{"color":"#fff6d8","radius":26,"alpha":0.9}'></p-view>
    <p-view style="height: 90px; margin-bottom: 8px; background-color: #24405e" clip-path='{"kind":"inset","params":[0,0,0.45,0]}'></p-view>
    <p-view style="height: 80px; margin-bottom: 8px; background-color: #16203a" svg-path='{"d":"M16 64 Q 270 8 524 64","stroke":"#cfe0ff","strokeWidth":7,"progress":1}'></p-view>
    <p-view v-for="item in list" :key="item.id" style="height: 44px; margin-bottom: 6px; background-color: #285ac8">
      <p-text :width="item.w" style="font-size: 12px; color: #ffffff">{{ item.title }}</p-text>
    </p-view>
    <p-view style="height: 30px; margin-top: 10px; background-color: #6a4bf0"></p-view>
    <p-view :width="padW" @click="padW += 5" style="height: 96px; margin-top: 8px; background-color: #1c2b3f">
      <p-view :width="boxW" @click="boxW += 30" style="height: 56px; margin-top: 8px; background-color: #2f6fed"></p-view>
    </p-view>
  </p-view>
</template>

<script setup lang="ts">
const list = ref([{ id: 1, w: 40, title: 'a' }])
const boxW = ref(120)
const padW = ref(300)
const tapCount = ref(0)
</script>
`

/** 长列表夹具：**行高 100px**（视口 2400 ⇒ 可见 ~24 行；预加载 ±10 ⇒ 物化 ~34 行）
 *  ——判据的口径：1000 行都必须在内核树里（几何正确），但宿主只物化可见区。
 *  ★行内含 `:width` 绑定（L1 槽位）与插值文本（`{{ item.title }}`）。 */
const LIST_SFC = `<template>
  <p-view style="width: 1080px; flex-direction: column; background-color: #101018">
    <p-text style="font-size: 18px; color: #ffffff; margin-bottom: 8px">虚拟列表</p-text>
    <p-view v-for="item in list" :key="item.id" style="height: 100px; background-color: #1b2a4a">
      <p-text :width="item.w" style="font-size: 14px; color: #cfe0ff">{{ item.title }}</p-text>
    </p-view>
  </p-view>
</template>

<script setup lang="ts">
const list = ref([{ id: 1, w: 120, title: 'row' }])
</script>
`

// 用 tsx 跑编译器（与 gen-app4050-fixture.mjs 同一手法：临时脚本 + 真包）——**两份 SFC 一次跑完**
const buildAb = (src, name) => {
  const { descriptor } = sfcParse(src)
  const tpl = descriptor.template
  if (!tpl) throw new Error('无 <template>')
  const diags = []
  // 改写策略：文本级属性重写（不做 AST 变换）
  // 为什么不用 nodeTransforms：AST 上 push 一个 :style bind 会被 Vue 编译器按
  // "已有静态 style + 新绑定"合并成 normalizeStyle([...])，而且形状会错
  // （键名还是 kebab，适配器要 camel）——首版实测踩到。
  // 改用文本级重写：把 style="..." 与各绘制声明属性替换成单个 :style="{...}"。
  const kebabToCamel = (x) => x.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  const camelize = (o) => {
    const out = {}
    for (const [k, v] of Object.entries(o)) {
      if (k === 'margin' || k === 'padding') {
        const e = {}
        for (const [sk, sv] of Object.entries(v)) e[kebabToCamel(sk)] = sv
        out[k] = e
      } else out[kebabToCamel(k)] = v
    }
    return out
  }
  const rewritten = tpl.content.replace(/<([A-Za-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g, (full, tag, attrs, slash) => {
    const keep = []
    const merged = {}
    let has = false
    const attrRe = /([@:a-zA-Z][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g
    let am
    while ((am = attrRe.exec(attrs)) !== null) {
      const name = am[1]
      const rawVal = am[2].slice(1, -1)
      if (name === 'style') {
        Object.assign(merged, parseStaticStyle(rawVal, (m) => diags.push(m)))
        has = true
        continue
      }
      if (isPaintDeclAttr(name)) {
        const r = parsePaintDeclAttr(name, rawVal)
        if (r.ok) { merged[r.key] = r.value; has = true; continue }
        diags.push(r.hint)
        continue
      }
      keep.push(am[0])
    }
    if (!has) return full
    const styleObj = JSON.stringify(camelize(merged))
    // 单引号包裹（值里可能有双引号）
    const bind = `:style='${styleObj.replace(/'/g, "&#39;")}'`
    return `<${tag}${keep.length ? ' ' + keep.join(' ') : ''} ${bind}${slash}>`
  })
  const nodeTransforms = []
  void rewritten
  const r = compileTemplate({
    source: rewritten, filename: name, id: 'vapor-ab', mode: 'module',
    compilerOptions: { runtimeModuleName: '@vue/runtime-core', nodeTransforms },
  })
  return { code: r.code, errors: (r.errors || []).map(String), diags }
}

// 父进程算 AB（同一份 SFC 的 Vue 官方编译产物）
const AB_RESULT = buildAb(SFC, 'vapor-ab.vue')

// ★★★六端 SFC 压力夹具：读**共享 SFC 源文件**（examples 页面 = 唯一事实源）
const stressSfc = fs.readFileSync(STRESS_SFC_PATH, 'utf-8')

/**
 * 从 `<script setup>` 抽**初始数据快照**（移动端不执行 script——Vapor 的定位是"模板实例化"，
 *   参见 entry-vapor.ts 头注的分工）。抽法是受控的：仅剥掉 import 行、用 `ref` 桩执行余下声明
 *   ——本夹具的 script 是**受我们控制的纯声明**（无副作用、无异步）；非受控 script 不适用。
 *   ★判据兜底：抽出的 `list` 行数必须 > 0（否则"数据没抽到"会静默渲染成空列表）。
 */
function extractStressData(src) {
  const { descriptor } = sfcParse(src)
  const code = (descriptor.scriptSetup?.content ?? '').replace(/^\s*import[^\n]*\n/gm, '')
  const ref = (v) => ({ value: v })
  const fn = new Function('ref', `${code}\nreturn { list: list.value, summary: summary.value }`)
  return fn(ref)
}
const STRESS_DATA = extractStressData(stressSfc)
if (!Array.isArray(STRESS_DATA.list) || STRESS_DATA.list.length === 0) {
  console.error('[gen-vapor-fixture] ✗ stress：script 数据快照为空（extractStressData 失效？——不静默）')
  process.exit(1)
}

const script = `
import { buildLayoutTemplate, buildVaporSubscriptions, compileEvents } from ${JSON.stringify(path.join(ROOT, 'packages/compiler/src/index.ts'))}
const build = (sfc, name) => {
  const tplRes = buildLayoutTemplate(sfc, name)
  const subRes = buildVaporSubscriptions(sfc, name)
  const evRes = compileEvents(sfc)
  return {
    ok: tplRes.ok,
    diagnostics: tplRes.diagnostics.map((d) => d.message),
    tpl: tplRes.template,
    table: subRes.table,
    // ★★交互闭环（2026-10-01）：事件绑定 + handler 动作表（纯数据）
    events: evRes.events,
    handlers: evRes.handlers,
    eventDiagnostics: evRes.diagnostics.map((d) => d.message),
    sfc,
  }
}

process.stdout.write(JSON.stringify({
  small: build(${JSON.stringify(SFC)}, 'vapor-device.vue'),
  list: build(${JSON.stringify(LIST_SFC)}, 'vapor-list.vue'),
  // ★★★六端 SFC 压力夹具：编译**共享 SFC 文件**（examples 页面）——与 Web/MP 同源
  stress: build(${JSON.stringify(stressSfc)}, 'consistency-stress.vue'),
  ab: ${JSON.stringify(AB_RESULT)},
}))
`

/** 生成物：Vue 官方编译器编同一份 SFC（见文件头注的 A/B 说明） */


const tmpDir = fs.mkdtempSync(path.join(ROOT, '.tmp-vapor-'))
const tmpScript = path.join(tmpDir, 'gen.ts')
fs.writeFileSync(tmpScript, script)
let raw
try {
  raw = execFileSync('npx', ['tsx', tmpScript], { cwd: ROOT, encoding: 'utf-8' })
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
const parsed = JSON.parse(raw)

/** 规格断言：不满足就**当场失败**（防"跑到设备上才发现产物不对"） */
const check = (label, out) => {
  const fail = (msg) => {
    console.error(`[gen-vapor-fixture] ✗ ${label}：${msg}`)
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
  return { tplNodes, l1, srcNames, itemSlots }
}

// 生成物：Vue 官方编译器产出的 render（A/B 的第二份产物）
if (!parsed.ab || !parsed.ab.code) {
  console.error('[gen-vapor-fixture] X A/B: Vue compiler produced no render function')
  process.exit(1)
}
if ((parsed.ab.errors || []).length > 0) {
  console.error('[gen-vapor-fixture] X A/B: Vue compiler errors: ' + parsed.ab.errors.join(' | '))
  process.exit(1)
}
const AB_OUT = path.join(HERE, 'bridge/vapor-ab-render.generated.ts')
fs.writeFileSync(
  AB_OUT,
  '// GENERATED - do not edit (gen-vapor-fixture.mjs from the same SFC)\n' +
    '// source: @vue/compiler-sfc (mode=module, runtimeModuleName=@vue/runtime-core)\n' +
    // ★@ts-nocheck：**生成物不做类型检查**（Vue 编译器的 render 无类型注解，补注解很脆；
    //   而"手写入口要严格检查"这条纪律由 tsconfig.bridge.json 的 include 范围保证——
    //   这个文件是特例且理由明确，与"global.d.ts 类声明"同属常规做法）
    '// @ts-nocheck\n' +
    '/* eslint-disable */\n' +
    parsed.ab.code + '\nexport { render as abRender }\n',
)
console.log(
  `[gen-vapor-fixture] OK A/B: Vue official compiler render (${parsed.ab.code.length} bytes) -> ${path.relative(ROOT, AB_OUT)}`,
)

const smallInfo = check('短列表产物', parsed.small)
// ★★交互闭环断言：短列表夹具必须编出事件（否则真机上"点不动"——本次要验的就是这个）
// ★2026-10-02 扩容（冒泡锚）：夹具现有**两个** tap 绑定（按钮 + 外层容器）——
//   断言 ≥2，否则"链上两跳"的判据（⑦f/⑦g）没东西可判。
if (!parsed.small.events || parsed.small.events.length < 2) {
  console.error(`[gen-vapor-fixture] ✗ 交互闭环：夹具编出的事件不足（应 ≥2——按钮 + 容器各一；实际 ${parsed.small.events?.length ?? 0}）`)
  process.exit(1)
}
if (Object.keys(parsed.small.handlers || {}).length < 2) {
  console.error(`[gen-vapor-fixture] ✗ 交互闭环：handler 不足（应 ≥2——boxW 与 padW 各一；实际 ${Object.keys(parsed.small.handlers || {}).length}）`)
  process.exit(1)
}
fs.writeFileSync(OUT, JSON.stringify(parsed.small))
const kb = (fs.statSync(OUT).size / 1024).toFixed(1)

const listInfo = check('长列表产物', parsed.list)
fs.writeFileSync(OUT_LIST, JSON.stringify(parsed.list))
const kb2 = (fs.statSync(OUT_LIST).size / 1024).toFixed(1)

// ★★★六端 SFC 压力夹具产物：编译产物 + **数据快照**（与 Web/MP 同源）
const stressInfo = check('六端 stress 产物', parsed.stress)
/** 数据快照进产物（端上不执行 script，见 extractStressData 注释） */
parsed.stress.data = STRESS_DATA
fs.writeFileSync(OUT_STRESS, JSON.stringify(parsed.stress))
const kb3 = (fs.statSync(OUT_STRESS).size / 1024).toFixed(1)

console.log(
  `[gen-vapor-fixture] ✅ ${path.relative(ROOT, OUT)}（${kb} KB）· 模板 ${smallInfo.tplNodes} 节点 · ` +
    `L1 ${smallInfo.l1}（覆盖率 ${(parsed.small.table.stats.l1Rate * 100).toFixed(1)}%）· 源 [${smallInfo.srcNames.join(', ')}]`,
)
console.log(
  `[gen-vapor-fixture] ✅ 交互：${parsed.small.events.length} 条事件绑定 · ${Object.keys(parsed.small.handlers).length} 个 handler（纯数据，设备端执行）`,
)
console.log(
  `[gen-vapor-fixture] ✅ ${path.relative(ROOT, OUT_LIST)}（${kb2} KB）· 长列表模板 ${listInfo.tplNodes} 节点 · ` +
    `L1 ${listInfo.l1} · 行内槽位 ${listInfo.itemSlots.length}`,
)
console.log(
  `[gen-vapor-fixture] ✅ ${path.relative(ROOT, OUT_STRESS)}（${kb3} KB）· **六端 SFC 压力夹具** ` +
    `（源：examples/pages/consistency-stress.vue）· 模板 ${stressInfo.tplNodes} 节点 · ` +
    `L1 ${stressInfo.l1} · 行内槽位 ${stressInfo.itemSlots.length} · 数据 ${STRESS_DATA.list.length} 行`,
)

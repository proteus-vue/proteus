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
      <!-- ★★混合文本（P2-2，2026-10-03）：静态段 + 两个插值段 ⇒ 运行时求值拼接。
           判据核的是**完整串**（"row-1·row 1"）真的到了内核（text_probe），
           以及改数据后重发的 SET_TEXT 仍是完整串（不是只剩一个字段）。 -->
      <p-text :width="item.w" style="font-size: 12px; color: #ffffff">row-{{ item.id }}·{{ item.title }}</p-text>
    </p-view>
    <p-view style="height: 30px; margin-top: 10px; background-color: #6a4bf0"></p-view>
    <p-view :width="padW" @click="padW += 5" style="height: 96px; margin-top: 8px; background-color: #1c2b3f">
      <p-view :width="boxW" @click="boxW += 30" style="height: 56px; margin-top: 8px; background-color: #2f6fed"></p-view>
    </p-view>
    <!-- ★★事件修饰符夹具（P2-3，2026-10-03）：外层 @click（无修饰）+ 内层 @click.stop。
         **内层刻意不遮住外层的中心**（内层 40px 贴顶，外层 220px ⇒ 外层中心 y=110 在内层之外）
         ——宿主注入 tap 是按"节点中心"点的：若重叠，点外层也会命中内层 ⇒ 判据拿不到
         「祖先 handler 本会跑、但被 .stop 挡下」的证据。 -->
    <p-view :width="stopOuterW" @click="stopOuterW += 5" style="height: 220px; margin-top: 8px; background-color: #223344">
      <p-view :width="stopInnerW" @click.stop="stopInnerW += 30" style="height: 40px; background-color: #445566"></p-view>
    </p-view>
    <!-- ★★P2-5（2026-10-03）：v-once 冻结 / v-memo 组门 夹具。
         · once 行：{{ onceVal }} 只在首帧写，之后**源怎么改都不再写**（判据 ⑪ 用）；
         · memo 行：v-memo="[memoDep]" + {{ memoVal }} —— 改 memoVal（依赖净）⇒ **跳过**、
                     改 memoDep（依赖脏）⇒ 放行（把最新 memoVal 写下去）。
         ★两行的文本初值刻意可区分（once-x / memo-y），判据核"跳过"与"放行"的**不同**结果。 -->
    <p-text style="font-size: 12px; color: #ffffff">once-{{ onceVal }}</p-text>
    <p-text v-once style="font-size: 12px; color: #ffffff">once-{{ onceVal }}</p-text>
    <p-text v-memo="[memoDep]" :key="'memo'" style="font-size: 12px; color: #ffffff">memo-{{ memoVal }}</p-text>
    <!-- ★★P2-6~P2-9（2026-10-03）：
         · v-text（P2-6）：与插值同槽位；
         · 白名单纯函数（P2-8）：Math.round / String 等 + Math.PI 编译期内联（此前静默渲染成空）；
         · 纯方法（P2-8 续）：arr.join（真实项目用法）；
         · 可选链（P2-9）：obj?.x 编译期降级为 cond 程序（空值 ⇒ 空串，不是 'undefined'）。
         判据 ⑫ 核：这些节点的**首帧文本**是求值结果（不是空串、也不是 "undefined"/"null" 字面量）。 -->
    <p-text v-text="'vt-' + exprA" style="font-size: 12px; color: #ffffff"></p-text>
    <p-text style="font-size: 12px; color: #ffffff">pi-{{ Math.PI.toFixed(2) }}</p-text>
    <p-text style="font-size: 12px; color: #ffffff">mx-{{ Math.max(exprA, 7) }}</p-text>
    <p-text style="font-size: 12px; color: #ffffff">jn-{{ exprArr.join('|') }}</p-text>
    <p-text style="font-size: 12px; color: #ffffff">oc-{{ exprObj?.inner }}</p-text>
    <!-- ★★★P3-3（2026-10-03）Transition 桥接夹具：**外层 Transition 透传**（不占节点 id、
         不产包裹盒）+ 内层元素带 v-show（可见性切换是过渡的驱动源）。
         判据 ⑬ 核：可见性翻转后 transition_started 大于 0（动画真的交给了宿主）。
         ★本注释**不得**含反引号或美元花括号（它在 JS 模板串里——本仓已踩四次）。 -->
    <Transition name="fade-slide-up">
      <p-view v-show="trVisible" style="height: 40px; background-color: #7c5cff"></p-view>
    </Transition>
    <!-- ★★★P1-3（2026-10-03）组件内部渲染夹具：Kids 子组件（构建期编译成 ComponentDef）+
         props 绑**响应式源**（kidLabelW / kidLabel）⇒ 判据核「父改 props ⇒ 子节点真的更新」。
         ★底色避开 #2f6fed（A/B 判据的按钮色锚）。 -->
    <KidPanel :label="kidLabel" :labelW="kidLabelW" style="height: 30px" @bump="bumpTotal = $event + 100"></KidPanel>
    <!-- ★★★P1-3 emits（2026-10-03）：上面 @bump 监听子组件 $emit；本节点是**几何锚**——
         宽度绑 bumpTotal（初始 0 ⇒ 几何 0 宽），判据核「子 emit ⇒ 父 handler 跑 ⇒ **内核几何真变**」。
         ★为什么用宽度而不是文本（本仓判据口径）：文本改动可能被文本同步链路掩盖；几何是内核真值。 -->
    <p-view :width="bumpTotal" style="height: 6px; background-color: #3aa0ff"></p-view>
    <!-- ★★★P3 批次（2026-10-03）逻辑容器**透传**夹具：三者都**不产包裹盒**
         （Vue 语义：逻辑容器不渲染元素）——判据核「节点数守恒 + 几何与 Vue 等价」。
         ★本注释不得含反引号或美元花括号（在 JS 模板串里——护栏见 check:script-compile）。 -->
    <!-- ★★KeepAlive 的官方约束（本仓实测被 Vue 编译器当场拦下）：它要求「恰好一个子组件」
         ——p-view（原生标签）会被拒：SyntaxError: KeepAlive expects exactly one child component.
         ⇒ 夹具改用真组件形态（MyKeep）验证透传。
         ★底色避开 #2f6fed（A/B 判据的按钮色锚——本仓已踩：重复 ⇒ 判据红）。 -->
    <KeepAlive>
      <MyKeep>
        <p-view style="height: 20px; background-color: #4a5f8a"></p-view>
      </MyKeep>
    </KeepAlive>
    <Teleport to="#nowhere">
      <p-view style="height: 20px; background-color: #6f4ae8"></p-view>
    </Teleport>
    <Suspense>
      <template #default>
        <p-view style="height: 20px; background-color: #1b2a4a"></p-view>
      </template>
      <template #fallback>
        <p-text style="color: #ffffff">suspense-fallback</p-text>
      </template>
    </Suspense>
  </p-view>
</template>

<script setup lang="ts">
const list = ref([{ id: 1, w: 40, title: 'a' }])
const boxW = ref(120)
const padW = ref(300)
const tapCount = ref(0)
// ★P2-3 修饰符夹具的两个源（与 makeData 的初值一致）
const stopOuterW = ref(300)
const stopInnerW = ref(120)
// ★P2-5 夹具源（与 makeData 的初值一致）：onceVal 冻结；memoDep 是 v-memo 的依赖、memoVal 是内容
const onceVal = ref(1)
const memoDep = ref(0)
const memoVal = ref(1)
// ★P2-6~P2-9 夹具源（与 makeData 的初值一致）
const exprA = ref(3)
const exprArr = ref(['a', 'b'])
const exprObj = ref({ inner: 'ok' })
// ★P3-3 夹具源（与 makeData 的初值一致）：Transition 的可见性开关
const trVisible = ref(false)
// ★P1-3 夹具源（props 的**响应式**来源——判据据此验"父改 ⇒ 子更新"）
const kidLabel = ref('k0')
const kidLabelW = ref(40)
// ★P1-3 emits（2026-10-03）：子组件 @bump 的落点（父级 handler 做 bumpTotal = $event + 100）
const bumpTotal = ref(0)
</script>
`

/**
 * ★★★P1-3 组件内部渲染夹具（2026-10-03）：一个**真子组件 SFC**——构建期连同父模板一起编译成
 *   `ComponentDef`（模板 + 订阅表 + data 快照）随产物下发。设备端实例化时按注册表**展开内部**。
 *
 * 形态要点（每条都对应一条判据）：
 *   · `defineProps` 声明两个 props（`label` 字符串 / `labelW` 数值）⇒ 订阅表里它们是**源**；
 *   · 模板里同时用 `{{ label }}`（文本）与 `:width="labelW"`（样式）⇒ 两条槽位都要通；
 *   · 无 script 副作用（端上不执行 script——`data` 只作兜底）。
 * ★本块不得含反引号或美元花括号（在 JS 模板串里——护栏见 check:script-compile）。
 */
const CHILD_SFC = `<template>
  <p-view style="flex-direction: row; height: 24px">
    <p-text :width="labelW" style="font-size: 12px; color: #ffffff">child-{{ label }}</p-text>
    <p-text @tap="$emit('bump', labelW)" style="width: 40px; height: 16px; font-size: 10px; color: #ffd479">emit-btn</p-text>
  </p-view>
</template>

<script setup lang="ts">
const props = defineProps<{ label: string; labelW: number }>()
</script>
`

/**
 * ★★★P1-3 **插槽分发**夹具（2026-10-03）：子组件含具名出口 + 默认出口（两者都带**元素后备**）
 *   + 一个**空出口**（无后备）；父组件提供 #header / 默认内容 + 一个**无出口接住**的
 *   #orphan 内容。判据 ⑮ 核四件事：内容真的落到出口位置 / 后备被内容遮蔽（元素真的没了）/
 *   孤儿内容不渲染 / 内容节点在**内核**里真的有几何（不是"树里有、内核没有"）。
 *   ★文本用**唯一前缀**（SLOT- / fb- / kid-head）便于判据按文本锚定（不依赖 id 规律）。
 *   ★本注释不得含反引号或美元花括号（护栏见 check:script-compile）。
 */
const SLOT_CHILD_SFC = `<template>
  <p-view style="flex-direction: column; height: 74px">
    <p-text style="font-size: 10px; color: #cfe0ff">kid-head</p-text>
    <slot name="header"><p-text style="font-size: 10px">fb-hdr</p-text></slot>
    <slot><p-text style="font-size: 10px">fb-dft</p-text></slot>
    <slot name="empty" />
  </p-view>
</template>`

const SLOT_SFC = `<template>
  <p-view style="flex-direction: column">
    <KidSlot>
      <template #header><p-text style="font-size: 12px; color: #ffffff">SLOT-HDR</p-text></template>
      <p-text style="font-size: 12px; color: #ffffff">SLOT-DFT</p-text>
      <template #orphan><p-text style="font-size: 12px; color: #ffffff">ORPHAN-NEVER</p-text></template>
    </KidSlot>
  </p-view>
</template>`

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
    // ★★2026-10-03 修（P2-5 实测抓出）：上面的 attrRe **要求有 `=值`** ⇒ **无值属性**
    //   （`v-once` / `v-pre` / 布尔属性如 `hidden`、`disabled`）会被**静默丢弃**——
    //   而 v-once 直接决定"这棵子树是否冻结"，丢了它 = A/B 两侧语义不等价（B 侧照常更新）。
    //   ⇒ 补一道**裸属性**扫描（无 `=` 的 token 原样保留；不重复已收集的）。
    {
      // ★先把**带引号的值**整段挖掉再扫（否则会匹配到值内部的 `color:` 之类 token ⇒
      //   注入伪属性——本仓实测踩到：生成的 prop 里出现 `"color:": ""`）
      const bareAttrs = attrs.replace(/"[^"]*"|'[^']*'/g, ' ')
      const bare = /(?:^|\s)([@:a-zA-Z][\w:.-]*)(?=\s|$)/g
      let bm
      while ((bm = bare.exec(bareAttrs)) !== null) {
        const tok = bm[1]
        if (tok.includes('=')) continue
        if (keep.some((k) => k === tok || k.startsWith(tok + '='))) continue
        keep.push(tok)
      }
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
  // ★★★P1-3：组件注册表（子组件 SFC 的编译产物——与父产物同批产出、同源下发）
  components: {
    KidPanel: build(${JSON.stringify(CHILD_SFC)}, 'kid-panel.vue'),
    // ★P1-3 插槽分发夹具（判据 ⑮）——子组件含具名/默认出口（带元素后备）+ 空出口
    KidSlot: build(${JSON.stringify(SLOT_CHILD_SFC)}, 'kid-slot.vue'),
  },
  small: build(${JSON.stringify(SFC)}, 'vapor-device.vue'),
  list: build(${JSON.stringify(LIST_SFC)}, 'vapor-list.vue'),
  // ★P1-3 插槽分发：父 SFC（提供 #header / 默认内容 + 无出口的 #orphan）
  slot: build(${JSON.stringify(SLOT_SFC)}, 'vapor-slot.vue'),
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
/**
 * ★★**`withModifiers` 的宿主侧适配**（2026-10-03 · P2-3 实测抓出的真缺陷）
 *
 * 【故障链（真机实测）】`withModifiers` 官方**只在 `@vue/runtime-dom`**（它调 DOM 事件对象的
 *   `stopPropagation`/`preventDefault`）；而本 A/B 的 B 路把 Vue 运行时接到**自绘宿主**
 *   （无 DOM）⇒ 编译期 `runtimeModuleName` 指 `@vue/runtime-core`，该包**不导出**它
 *   ⇒ 模板一旦用 `@click.stop`，产出的 `_withModifiers(...)` 在挂载时抛
 *   `withModifiers is not a function`；而 QuickJS 无 `console` ⇒ 错误上报自身又炸，
 *   设备侧只看到 **`'console' is not defined`**（把真因盖住——本仓实测踩到）。
 *   ⇒ 正解：生成物里**带一份同语义实现**（守卫表与官方逐条对应），事件对象 = 自绘适配器
 *     `dispatchEvent` 合成的那个（`target`/`currentTarget`/`stopPropagation` 都有）。
 *   ★这也是 A/B **修饰符语义对齐**的前提：A 路（`slot-runtime.dispatchGesture`）的 `.stop`
 *     = "先跑本跳、再终止冒泡"；本实现走官方语义 = 守卫置 `_stopped` ⇒ 适配器派发循环
 *     break 在**本跳跑完之后** ⇒ 两路同语义（判据 ⑦"逐跳等价"才成立）。
 */
const WITH_MODIFIERS_SHIM = `
/* ★宿主侧 withModifiers（见生成器头注：官方只在 runtime-dom，自绘宿主没有 DOM） */
const modifierGuards = {
  stop: (e) => { if (typeof e.stopPropagation === 'function') e.stopPropagation() },
  prevent: (e) => { if (typeof e.preventDefault === 'function') e.preventDefault() },
  self: (e) => e.target !== e.currentTarget,
  ctrl: (e) => !e.ctrlKey, shift: (e) => !e.shiftKey, alt: (e) => !e.altKey, meta: (e) => !e.metaKey,
  left: (e) => 'button' in e && e.button !== 0,
  middle: (e) => 'button' in e && e.button !== 1,
  right: (e) => 'button' in e && e.button !== 2,
  exact: (e, modifiers) => ['ctrl','shift','alt','meta'].some((m) => e[m + 'Key'] && !modifiers.includes(m)),
}
const withModifiers = (fn, modifiers) => {
  if (!fn) return fn
  const cache = fn._withMods || (fn._withMods = {})
  const cacheKey = modifiers.join('.')
  return cache[cacheKey] || (cache[cacheKey] = (event, ...args) => {
    for (const m of modifiers) {
      const guard = modifierGuards[m]
      if (guard && guard(event, modifiers)) return
    }
    return fn(event, ...args)
  })
}
// ★生成物里的调用名是**别名** _withModifiers（编译器按 withModifiers as _withModifiers 产出）——
//   我们摘掉了那条 import，这里必须把别名绑上（首版只定义 withModifiers ⇒ 引用处仍是 undefined，实测踩到）
const _withModifiers = withModifiers
`

// 从 runtime-core 的 import 里摘掉 `withModifiers`（该包不导出它），改由本文件的 shim 提供
let abCode = String(parsed.ab.code)
if (/withModifiers/.test(abCode)) {
  const before = abCode
  abCode = abCode.replace(/import \{([^}]*)\} from "@vue\/runtime-core";?/, (m, names) => {
    const list = String(names)
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((n) => n !== 'withModifiers' && !/^withModifiers as\s/.test(n))
    return `import { ${list.join(', ')} } from "@vue/runtime-core"`
  })
  if (abCode === before) {
    console.error('[gen-vapor-fixture] ✗ A/B: 生成物引用了 withModifiers 但未能从 import 摘除（语法形态变了？）——不静默')
    process.exit(1)
  }
  abCode += WITH_MODIFIERS_SHIM
}
fs.writeFileSync(
  AB_OUT,
  '// GENERATED - do not edit (gen-vapor-fixture.mjs from the same SFC)\n' +
    '// source: @vue/compiler-sfc (mode=module, runtimeModuleName=@vue/runtime-core)\n' +
    // ★@ts-nocheck：**生成物不做类型检查**（Vue 编译器的 render 无类型注解，补注解很脆；
    //   而"手写入口要严格检查"这条纪律由 tsconfig.bridge.json 的 include 范围保证——
    //   这个文件是特例且理由明确，与"global.d.ts 类声明"同属常规做法）
    '// @ts-nocheck\n' +
    '/* eslint-disable */\n' +
    abCode + '\nexport { render as abRender }\n',
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
// ★★★P1-3（2026-10-03）：组件注册表随父产物一起下发（键名 `components`——
//   与 `entry-vapor.ts` 读的名字**必须一致**；本仓已踩过"题键不一致 ⇒ 静默拿不到"的坑）。
//   ★断言：注册表非空且**每个组件可编译**（否则设备端展开会留空占位——
//     "生成器静默退化"是本仓三令五申要拦的形态）。
if (!parsed.components || Object.keys(parsed.components).length === 0) {
  console.error('[gen-vapor-fixture] ✗ 组件注册表为空（P1-3 夹具应含 KidPanel）')
  process.exit(1)
}
for (const [nm, def] of Object.entries(parsed.components)) {
  if (!def || !def.ok || !def.tpl || !def.table) {
    console.error(`[gen-vapor-fixture] ✗ 组件 ${nm} 编译不完整（ok=${def && def.ok}）——` +
      `诊断：${(def && def.diagnostics || []).join(' | ')}`)
    process.exit(1)
  }
}
// ★★★P1-3 emits（2026-10-03）：子组件 **必须有** `$emit` 动作 + 父级必须有 **componentEmit 绑定**
//   （两者缺一 ⇒ 判据 ⑯ 无证据；"生成器静默退化"是本仓重点拦的形态）。
{
  const kid = parsed.components?.KidPanel
  const childEmitActs = Object.values(kid?.handlers ?? {}).flat().filter((a) => a && a.op === 'emit')
  const parentEmitBinds = (parsed.small?.events ?? []).filter((e) => e && e.componentEmit)
  if (childEmitActs.length === 0 || parentEmitBinds.length === 0) {
    console.error(
      `[gen-vapor-fixture] ✗ emits 夹具不完整（判据 ⑯ 将无证据）：` +
        `子组件 emit 动作=${childEmitActs.length}（应 ≥1）· 父级 componentEmit 绑定=${parentEmitBinds.length}（应 ≥1）`,
    )
    process.exit(1)
  }
  if (childEmitActs.length > 1 || parentEmitBinds.length > 1) {
    console.error(
      `[gen-vapor-fixture] ✗ emits 夹具应**恰好一条**（多余会让判据的锚点含混）：` +
        `emit 动作=${childEmitActs.length} · 绑定=${parentEmitBinds.length}`,
    )
    process.exit(1)
  }
  console.log(
    `[gen-vapor-fixture] ✅ emits 夹具：子 emit('${childEmitActs[0].event}') · ` +
      `父绑定 @${parentEmitBinds[0].event}（nodeId=${parentEmitBinds[0].nodeId}）`,
  )
}
fs.writeFileSync(OUT, JSON.stringify({ ...parsed.small, components: parsed.components, slot: parsed.slot }))
console.log(`[gen-vapor-fixture] ✅ 组件注册表：${Object.keys(parsed.components).join(', ')}（随父产物下发）`)
// ★P1-3 插槽分发夹具（判据 ⑮）：父产物必须带 slotFor 标记、子产物必须带 slotOutlet 标记
//   （"生成器静默退化"是本仓重点拦的形态——标记缺了就是分发不可能发生）
{
  const slotParent = parsed.slot
  const slotChild = parsed.components.KidSlot
  const has = (nodes, key) => (nodes || []).filter((n) => n && n[key]).length
  const parentFors = has(slotParent.tpl.nodes, 'slotFor')
  const childOutlets = has(slotChild.tpl.nodes, 'slotOutlet')
  if (!slotParent.ok || !slotChild.ok || parentFors < 3 || childOutlets < 3) {
    console.error(
      `[gen-vapor-fixture] ✗ 插槽分发夹具不完整（判据 ⑮ 将无证据）：` +
        `父 slotFor=${parentFors}（应 3）· 子 slotOutlet=${childOutlets}（应 3）· ok=${slotParent.ok}/${slotChild.ok}`,
    )
    process.exit(1)
  }
  console.log(`[gen-vapor-fixture] ✅ 插槽分发夹具：父内容根 ${parentFors} 个 · 子出口 ${childOutlets} 个`)
}
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

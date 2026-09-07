// tests/compiler-ir-m4.test.ts
// ★#505 M4 首条对照：v-model 组件契约挂 IR——草案 §6 M4（候选 2 作首条）：
//   契约（prop + update:arg + setData 回写）在旁路/IR 中携带完整字段（arg/propName），不再「手抄丢字段」
//   （草案 §1.2 取证缺口实例：vModelComponentHandlers 旁路只抄 {name, model}——组件属性名与 v-model
//   参数在 IR 快照里丢失，跨端 conformance/工具无法从快照重建产物契约）。
// 验收：① IR 声明 = 完整契约（arg/propName 在位）；② 产物与既有实现逐字节等价（行为零变化）；
//       ③ IR 单点可重建产物契约（快照自足）；④ 组件无 arg 形态默认 modelValue 契约。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'

const opts = { px2rpx: true, rpxRatio: 2 }

const REPO_ROOT = path.resolve('.')
const WALK_ROOTS = [path.resolve('examples/pages'), path.resolve('examples/subpackages'), path.resolve('src/components')]

function walkVue(dir: string, acc: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walkVue(p, acc)
    else if (f.endsWith('.vue')) acc.push(p)
  }
  return acc
}

const FILES = WALK_ROOTS.reduce((acc, root) => walkVue(root, acc), [] as string[])

describe('★#505 M4 首条对照①：v-model 组件契约完整入 IR（arg/propName 不再丢）', () => {
  it('v-model:visible → IR 声明 {name, model, arg, propName} 四字段全（契约两半 = template prop 绑定 + script 回写）', () => {
    const src = '<script setup lang="ts">import { ref } from "vue"\nconst show = ref(false)</script>\n'
      + '<template><p-modal v-model:visible="show">x</p-modal></template>'
    const r = compileVueSfc(src, { filename: 'pages/m4vm.vue', ...opts })
    expect(r.ir?.template.vModelComponentHandlers).toEqual([
      { name: 'proteusUpdateVisibleModel', model: 'show', arg: 'visible', propName: 'visible' },
    ])
    // 产物等价锚点（#500 形态不变——行为零变化）
    expect(r.wxml).toContain('visible="{{show}}"')
    expect(r.wxml).toContain('bind:update:visible="proteusUpdateVisibleModel"')
    expect(r.js).toContain('proteusUpdateVisibleModel(e) { this.setData({ show: e.detail }) }')
  })

  it('IR 快照自足：仅凭声明可重建产物契约（propName → {{model}} 绑定 + bind:update:propName 事件；name → 回写方法）', () => {
    const src = '<script setup lang="ts">import { ref } from "vue"\nconst visible = ref(false)\nconst title = ref("")</script>\n'
      + '<template><p-modal v-model:visible="visible" /><p-modal v-model="title" /></template>'
    const r = compileVueSfc(src, { filename: 'pages/m4self.vue', ...opts })
    const entries = r.ir?.template.vModelComponentHandlers ?? []
    // 每个组件 v-model 站点 = 一条完整契约
    expect(entries.length).toBe(2)
    for (const e of entries) {
      // template 侧：{{propName}}="{{model}}" + bind:update:propName="{{name}}"
      expect(r.wxml).toContain(`${e.propName}="{{${e.model}}}"`)
      expect(r.wxml).toContain(`bind:update:${e.propName}="${e.name}"`)
      // script 侧：name 方法回写 e.detail → setData({ model })
      expect(r.js).toContain(`${e.name}(e) { this.setData({ ${e.model}: e.detail }) }`)
    }
  })

  it('组件无 arg 形态：propName 缺省 modelValue（无 arg 键——契约归一不含空参数）', () => {
    const src = '<script setup lang="ts">import { ref } from "vue"\nconst title = ref("")</script>\n'
      + '<template><p-modal v-model="title">x</p-modal></template>'
    const r = compileVueSfc(src, { filename: 'pages/m4argless.vue', ...opts })
    expect(r.ir?.template.vModelComponentHandlers).toEqual([
      { name: 'proteusUpdateModelValueModel', model: 'title', propName: 'modelValue' },
    ])
    expect(r.wxml).toContain('modelValue="{{title}}"')
    expect(r.wxml).toContain('bind:update:modelValue="proteusUpdateModelValueModel"')
  })

  it('input 形态不进组件契约（value+bindinput 路径——vModelTargets 仍收集目标字段）', () => {
    const src = '<script setup lang="ts">import { ref } from "vue"\nconst keyword = ref("")</script>\n'
      + '<template><input v-model="keyword" /></template>'
    const r = compileVueSfc(src, { filename: 'pages/m4input.vue', ...opts })
    expect(r.ir?.template.vModelComponentHandlers).toEqual([])
    expect(r.ir?.template.vModelTargets).toEqual(['keyword'])
    expect(r.wxml).toContain('bindinput="proteusOnKeywordInput"')
  })
})

describe('★#505 M4 ScriptIR 首条：script 语义结构化投影（data/computeds/runtimeInits/lifecycles）', () => {
  const opts = { px2rpx: true, rpxRatio: 2 }
  const SRC = '<script setup lang="ts">import { ref, computed } from "vue"\nconst a = ref(1)\nconst b = "lit"\nconst c = computed(() => a.value * 2)\nconst d = computed(() => { const base = a.value + 1; return base * 3 })\nconst e = useWidget()\nonLoad(() => { e })\n</script>\n<template><view>{{ c }}</view></template>'

  it('data（ref+字面量）/computed（deps+形态）/runtimeInit（函数调用）/lifecycles 全量投影', () => {
    const r = compileVueSfc(SRC, { filename: 'pages/m4script.vue', ...opts })
    const s = r.ir?.script
    expect(s).toBeDefined()
    expect(s?.data).toEqual([{ name: 'a' }, { name: 'b' }])
    // computed：c 表达式形态（deps a）；d 块体形态（blockBody → kind block）
    expect(s?.computeds).toContainEqual({ name: 'c', deps: ['a'], kind: 'expression' })
    expect(s?.computeds).toContainEqual({ name: 'd', deps: ['a'], kind: 'block' })
    // useWidget() 函数调用 → runtimeInit（实例属性通道——非 data）
    expect(s?.runtimeInits).toContainEqual({ name: 'e' })
    expect(s?.data?.map((x) => x.name)).not.toContain('e')
    expect(s?.lifecycles).toContain('onLoad')
    // 产物等价锚点：既有 codegen 形态不变
    expect(r.js).toContain('a: 1')
    expect(r.js).toContain('c: this.data.a * 2')
  })

  it('禁用 script/computed-to-data → computeds 声明空（data 仍在——规则态如实投影）', () => {
    const r = compileVueSfc(SRC, { filename: 'pages/m4soff.vue', ...opts, rules: { disabled: ['script/computed-to-data'] } })
    expect(r.ir?.script?.computeds).toEqual([])
    expect(r.ir?.script?.data).toEqual([{ name: 'a' }, { name: 'b' }])
  })

  it('禁用 script/const-to-data → data/computeds/runtimeInits 全空（提取整体禁用）', () => {
    const r = compileVueSfc(SRC, { filename: 'pages/m4soff2.vue', ...opts, rules: { disabled: ['script/const-to-data'] } })
    expect(r.ir?.script?.data).toEqual([])
    expect(r.ir?.script?.computeds).toEqual([])
    expect(r.ir?.script?.runtimeInits).toEqual([])
  })

  it('纯模板（无 script）→ script 段确定性缺省（全空数组，非 undefined）', () => {
    const r = compileVueSfc('<template><view>hi</view></template>', { filename: 'pages/m4plain.vue', ...opts })
    expect(r.ir?.script).toEqual({ data: [], computeds: [], runtimeInits: [], lifecycles: [], watchers: [], props: [], provides: [], injects: [], methods: [] })
  })

  it('编译两次 → script 快照深等（确定性）', () => {
    const a = compileVueSfc(SRC, { filename: 'pages/m4det.vue', ...opts })
    const b = compileVueSfc(SRC, { filename: 'pages/m4det.vue', ...opts })
    expect(a.ir?.script).toEqual(b.ir?.script)
  })
})

describe('★#505 M4 首条对照②：契约声明与规则/禁用一致（删规则即红通道延续）', () => {
  it('禁用 directive/v-model → IR 组件契约与 vModelTargets 全空（退 #500 无绑定缺陷形态——既有门禁在 M4 契约上延续）', () => {
    const src = '<script setup lang="ts">import { ref } from "vue"\nconst show = ref(false)</script>\n'
      + '<template><p-modal v-model:visible="show" /></template>'
    const r = compileVueSfc(src, { filename: 'pages/m4off.vue', ...opts, rules: { disabled: ['directive/v-model'] } })
    expect(r.ir?.template.vModelComponentHandlers).toEqual([])
    expect(r.ir?.template.vModelTargets).toEqual([])
    expect(r.wxml).not.toContain('bind:update:visible')
  })
})

describe('★#505 M4 watch 声明投影：源形态/deps/immediate/observers 入 IR（props 源 = WeChat observers）', () => {
  const opts = { px2rpx: true, rpxRatio: 2 }
  it('watch 单 ref 源 + 数组源 immediate → watchers 声明（kind/deps/immediate 如实）', () => {
    const src = '<script setup lang="ts">import { ref, watch } from "vue"\nconst count = ref(0)\nconst tag = ref("")\nwatch(count, (n, o) => { console.log(n, o) })\nwatch([count, tag], () => { count.value }, { immediate: true })\n</script>\n<template><view>{{ count }}</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/m4watch.vue', ...opts })
    const ws = r.ir?.script?.watchers ?? []
    expect(ws).toContainEqual({ deps: ['count'], kind: 'ref', immediate: false, observers: false, params: ['n', 'o'] })
    expect(ws).toContainEqual({ deps: ['count', 'tag'], kind: 'array', immediate: true, observers: false, params: [] })
    // 产物等价锚点：既有 codegen 形态不变（proteusWatch 方法 + immediate 初始化调用）
    expect(r.js).toContain('proteusWatchCount')
    expect(r.js).toContain('proteusWatchCountAndTag')
  })

  it('props 源（组件模式 watch(() => props.x)）→ kind props + observers:true + propField（MP observers 契约）', () => {
    const src = '<script setup lang="ts">\nconst props = defineProps<{ width: number }>()\nwatch(() => props.width, (w) => { console.log(w) })\n</script>\n<template><view>{{ width }}</view></template>'
    const r = compileVueSfc(src, { filename: 'components/m4watch-props.vue', ...opts, isComponent: true })
    const ws = r.ir?.script?.watchers ?? []
    expect(ws).toContainEqual({ deps: [], kind: 'props', immediate: false, observers: true, propField: 'width', params: ['w'] })
    // 产物等价锚点：observers 段在位
    expect(r.js).toContain('observers: {')
    expect(r.js).toContain('width(n, o)')
  })

  it('禁用 script/watch-to-methods → watchers 声明空（产物同退——watch 不编译）', () => {
    const src = '<script setup lang="ts">import { ref, watch } from "vue"\nconst count = ref(0)\nwatch(count, () => { count.value })\n</script>\n<template><view>{{ count }}</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/m4watchoff.vue', ...opts, rules: { disabled: ['script/watch-to-methods'] } })
    expect(r.ir?.script?.watchers).toEqual([])
  })
})

describe('★#505 M4 props 契约入 IR：defineProps 对象/泛型 → properties 声明（name + 微信类型）', () => {
  const opts = { px2rpx: true, rpxRatio: 2 }
  it('泛型形式 defineProps<{ label, count? }> → props 声明（类型映射 String/Number）', () => {
    const src = '<script setup lang="ts">\nconst props = defineProps<{ label: string; count?: number }>()\n</script>\n<template><view>{{ label }}</view></template>'
    const r = compileVueSfc(src, { filename: 'components/m4props.vue', ...opts, isComponent: true })
    const ps = r.ir?.script?.props ?? []
    expect(ps).toContainEqual({ name: 'label', type: 'String' })
    expect(ps).toContainEqual({ name: 'count', type: 'Number' })
    // 产物等价锚点：properties 段在位
    expect(r.js).toContain('properties: {')
  })

  it('页面模式（非组件）defineProps 不提取 → props 声明空（与产物一致——无 properties 段）', () => {
    const src = '<script setup lang="ts">\nconst props = defineProps<{ label: string }>()\n</script>\n<template><view>{{ label }}</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/m4props-page.vue', ...opts })
    expect(r.ir?.script?.props).toEqual([])
  })

  it('禁用 script/define-props → props 声明空（产物同退——defineProps 忽略）', () => {
    const src = '<script setup lang="ts">\nconst props = defineProps<{ label: string }>()\n</script>\n<template><view>{{ label }}</view></template>'
    const r = compileVueSfc(src, { filename: 'components/m4props-off.vue', ...opts, isComponent: true, rules: { disabled: ['script/define-props'] } })
    expect(r.ir?.script?.props).toEqual([])
  })
})

describe('★#505 M4 provide/inject 键表入 IR：provide key（reactive 联动）+ inject 接收名', () => {
  const opts = { px2rpx: true, rpxRatio: 2 }
  it('裸 ref provide + inject 接收 → provides reactive:true / injects 键表（产物注册表段在位）', () => {
    const src = '<script setup lang="ts">import { ref } from "vue"\nconst theme = ref("light")\nprovide("theme", theme)\nconst t = inject("theme")\n</script>\n<template><view>{{ t }}</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/m4pi.vue', ...opts })
    const s = r.ir?.script
    expect(s?.provides).toEqual([{ key: 'theme', reactive: true }])
    expect(s?.injects).toEqual([{ key: 'theme', name: 't' }])
    // 产物等价锚点：全局注册表注入段在位
    expect(r.js).toContain('__proteusProvides')
  })

  it('静态值 provide → reactive:false（非裸 ref 提供 = 值快照不联动）', () => {
    const src = '<script setup lang="ts">\nprovide("mode", "dark")\n</script>\n<template><view>hi</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/m4pi2.vue', ...opts })
    expect(r.ir?.script?.provides).toEqual([{ key: 'mode', reactive: false }])
    expect(r.ir?.script?.injects).toEqual([])
  })

  it('禁用 script/provide-inject → provides/injects 全空（产物同退）', () => {
    const src = '<script setup lang="ts">import { ref } from "vue"\nconst theme = ref("light")\nprovide("theme", theme)\nconst t = inject("theme")\n</script>\n<template><view>{{ t }}</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/m4pi3.vue', ...opts, rules: { disabled: ['script/provide-inject'] } })
    expect(r.ir?.script?.provides).toEqual([])
    expect(r.ir?.script?.injects).toEqual([])
  })
})

describe('★#505 M4 methods 名册 + observers 参数归一声明', () => {
  const opts = { px2rpx: true, rpxRatio: 2 }
  it('顶层函数/箭头 → methods 名册（模板 @handler 回显关联面）；产物方法在位', () => {
    const src = '<script setup lang="ts">import { ref } from "vue"\nconst count = ref(0)\nfunction addOne() { count.value++ }\nconst go = (v) => { count.value = v }\n</script>\n<template><view @click="addOne" @tap="go">{{ count }}</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/m4methods.vue', ...opts })
    const names = (r.ir?.script?.methods ?? []).map((m) => m.name)
    expect(names).toContain('addOne')
    expect(names).toContain('go')
    // 产物等价锚点：方法体在产物
    expect(r.js).toContain('addOne() {')
    expect(r.js).toContain('go(v) {')
  })

  it('props 源 watch 原始参数名入 params（产物 observers 回调恒归一 n/o——#499 契约在 IR 声明）', () => {
    const src = '<script setup lang="ts">\nconst props = defineProps<{ width: number }>()\nwatch(() => props.width, (w) => { console.log(w) })\n</script>\n<template><view>{{ width }}</view></template>'
    const r = compileVueSfc(src, { filename: 'components/m4obs.vue', ...opts, isComponent: true })
    const ws = r.ir?.script?.watchers ?? []
    const obs = ws.find((w) => w.observers)
    expect(obs?.params).toEqual(['w']) // 原始开发者参数名
    // 产物锚点：observers 回调签名归一 n/o（#499 renameWatchParamsToNo）
    expect(r.js).toContain('width(n, o) {')
  })
})

describe('★#505 M4 评审补丁 P1：ScriptIR 声明 × 真实文件自洽门禁（84 真实 .vue——script 声明与现实一致机器化）', () => {
  it('watchers.deps ⊆ data∪computeds；data∩runtimeInits∩props = ∅；props 仅组件模式非空；全部文件 script 快照在位', () => {
    const issues: string[] = []
    let checked = 0
    for (const file of FILES) {
      const rel = path.relative(REPO_ROOT, file)
      const isComponent = rel.includes('src/components')
      const r = compileVueSfc(fs.readFileSync(file, 'utf-8'), { filename: file, isComponent })
      const s = r.ir?.script
      if (!s) {
        issues.push(`${rel}: script 快照缺失`)
        continue
      }
      checked++
      const dataNames = new Set((s.data ?? []).map((d) => d.name))
      const compNames = new Set((s.computeds ?? []).map((c) => c.name))
      const initNames = new Set((s.runtimeInits ?? []).map((i) => i.name))
      const propNames = new Set((s.props ?? []).map((p) => p.name))
      for (const w of s.watchers ?? []) {
        const missing = (w.deps ?? []).filter((d) => !dataNames.has(d) && !compNames.has(d))
        if (missing.length) issues.push(`${rel}: watch deps ${missing.join(',')} 不在 data/computeds 声明中`)
      }
      for (const n of dataNames) if (initNames.has(n) || propNames.has(n)) issues.push(`${rel}: data.${n} 与 runtimeInits/props 重名`)
      if (propNames.size && !isComponent) issues.push(`${rel}: 页面模式（非组件）出现 props 声明（defineProps 仅组件语义）`)
    }
    expect(checked, '84 真实文件必须全部编译（防门禁自身退化）').toBeGreaterThan(80)
    expect(issues, `ScriptIR 自洽问题：\n${issues.join('\n')}`).toEqual([])
  })
})

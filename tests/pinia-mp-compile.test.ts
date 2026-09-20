// tests/pinia-mp-compile.test.ts
// ★pinia-plan 12：Pinia MP 编译接入——P1 模板 store 绑定（编译产物断言）+ P3 共享模块放行（resolveSharedModule pinia 白名单）
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'
import { resolveSharedModule } from '../packages/plugin-vite/src/plugin'

const compile = (src: string, name = 'pinia.vue'): { wxml: string; js: string; warnings: string[] } => {
  const r = compileVueSfc(src, { filename: name })
  return { wxml: r.wxml, js: r.js, warnings: r.warnings }
}

describe('P1：模板 store 绑定（script/store-binding）', () => {
  const SFC = `<template>
    <p>{{ store.current ? store.current.title : '未播放' }}（{{ store.playing ? '播放中' : '已暂停' }}）</p>
    <p>音量：{{ store.volumePercent }}%（历史 {{ store.historyCount }} 首）</p>
  </template>
  <script setup>
import { usePlayerStore } from '../stores/player'
const store = usePlayerStore()
  </script>`

  it('wxml：store 前缀剥离（{{ store.current.title }} → {{ current.title }}）', () => {
    const { wxml } = compile(SFC)
    expect(wxml).toContain('{{ current ? current.title : \'未播放\' }}')
    expect(wxml).not.toContain('store.current')
    expect(wxml).toContain('{{ playing ? \'播放中\' : \'已暂停\' }}')
    expect(wxml).toContain('{{ volumePercent }}%')
  })

  it('js：onLoad 注入 $subscribe → setData（字段映射 + 实例属性 store）', () => {
    const { js } = compile(SFC)
    expect(js).toContain('this.store = usePlayerStore()') // runtimeInit
    expect(js).toContain('this.setData({ current: __self.store.current')
    expect(js).toContain('this.store.$subscribe')
    expect(js).toContain('__self.setData({ current: __self.store.current')
    expect(js).toContain('volumePercent: __self.store.volumePercent')
  })

  it('无 store 变量 / 无模板引用 → 不注入绑定', () => {
    const { js, wxml } = compile('<template><p>{{ count }}</p></template><script setup>const count = ref(1)</script>')
    expect(js).not.toContain('$subscribe')
    expect(wxml).toContain('{{ count }}')
  })
})

describe('P2：store 方法事件包装（inline handler 扩展）', () => {
  const SFC = `<template>
    <button @click="store.toggle()">切换</button>
    <button @click="store.play({ title: 'X', durationSec: 5 })">播放</button>
    <button @click="store.setVolume(store.volume - 0.1)">音量-</button>
    <button @click="store.setVolume(store.volume + 0.1)">音量+</button>
  </template>
  <script setup>
import { usePlayerStore } from '../stores/player'
const store = usePlayerStore()
  </script>`

  it('wxml：bindtap 指向包装方法；js：生成 proteusStoreXxx（this.store. 调用 + store. 引用改写）', () => {
    const { wxml, js } = compile(SFC)
    expect(wxml).toContain('bindtap="proteusStoreToggleNoArgs"')
    expect(wxml).toContain('bindtap="proteusStorePlaytitleXdurationSec5"')
    expect(js).toContain('this.store.toggle()')
    expect(js).toContain("this.store.play({ title: 'X', durationSec: 5 })")
    // ★+/- 区分（Minus/Plus 映射，避免同名方法冲突覆盖）
    expect(js).toContain('this.store.setVolume(this.store.volume - 0.1)')
    expect(js).toContain('this.store.setVolume(this.store.volume + 0.1)')
    expect(js).toContain('proteusStoreSetVolumestorevolumeMinus01')
    expect(js).toContain('proteusStoreSetVolumestorevolumePlus01')
    // 不再警告复杂表达式
    expect(js).not.toContain('proteusStoreSetVolumestorevolume01')
  })

  it('非 store 事件（复杂表达式）仍警告', () => {
    const { js, warnings } = compile('<template><button @click="a.b()">x</button></template>')
    expect(js).not.toContain('proteusStore')
  })
})

// ★F-34（外部报告 round 12）：store. 前缀剥离此前只覆盖「插值」与「:prop」两条通道，
//   v-if / v-else-if / v-for / v-show / v-html 各自走表达式通道**漏剥** → 产物 wx:if="{{store.err}}"
//   在 MP 端读到 undefined（store 是实例属性，不在 data 上）→ 条件恒假 / 列表恒空（静默不渲染）。
//   修法：五处全部收敛到 rewriteStoreRefs（同一件事只允许一份实现）。
//   破坏性说明：删掉任一处的 rewriteStoreRefs 调用，本组对应用例即红（残留断言先行于正向断言）。
describe('★F-34：指令通道的 store. 前缀剥离（round 12）', () => {
  const SFC = `<template>
    <view v-if="store.err">{{ store.err }}</view>
    <view v-else-if="store.apiReady">ok</view>
    <view v-else>none</view>
    <view v-for="p in store.projects" :key="p.id">{{ p.name }}</view>
    <view v-show="store.tree">tree</view>
    <rich-text v-html="store.html" />
  </template>
  <script setup>
import { useWorkbenchStore } from '../stores/player'
const store = useWorkbenchStore()
  </script>`

  it('wxml：六条通道全部剥前缀（任一漏剥即残留断言先红）', () => {
    const { wxml } = compile(SFC)
    // 反向断言先行：残留就是缺陷本身
    expect(wxml).not.toContain('store.')
    expect(wxml).toContain('wx:if="{{err}}"')
    expect(wxml).toContain('wx:elif="{{apiReady}}"')
    expect(wxml).toContain('wx:for="{{projects}}"')
    expect(wxml).toContain('wx:key="id"')
    expect(wxml).toContain('hidden="{{!tree}}"') // v-show → hidden 取反
    expect(wxml).toContain('nodes="{{html}}"')
  })

  it('js：指令里引用到的 store 字段同样进 $subscribe（否则数据到达后不重渲染）', () => {
    const { js } = compile(SFC)
    for (const field of ['err', 'apiReady', 'projects', 'tree', 'html']) {
      expect(js, `字段 ${field} 应进 setData 映射`).toContain(`${field}: __self.store.${field}`)
    }
  })

  it('v-for 别名不得被 store 剥离误改（p in store.projects → 别名 p 保持）', () => {
    const { wxml } = compile(SFC)
    expect(wxml).toContain('wx:for-item="p"')
    expect(wxml).toContain('{{ p.name }}')
  })
})

// ★F-35（框架自查，与 #500/#505 同族）：箭头事件处理器此前只警告**原样输出**——
//   产物 bind:open="(n) => continueWriting(n)"，而事件属性值是**方法名**，整句非法 → 真机事件永不触发（静默失效）。
//   修法：单方法调用体的箭头形态降级为包装方法，参数按事件类型绑定载荷（自定义事件 e.detail / 原生事件 e）。
describe('★F-35：箭头事件处理器 → 包装方法（框架自查）', () => {
  it('自定义事件：参数 → e.detail（框架约定：emit 裸载荷 → 页面 e.detail = payload，见 S37）', () => {
    const { wxml, js } = compile(`<template>
      <chapter-tree :tree="tree" @open="(n) => continueWriting(n)" @pick="(n) => onPick(n.id)" />
    </template>
    <script setup>
const tree = ref(null)
function continueWriting(n) {}
function onPick(n) {}
    </script>`)
    expect(wxml).not.toContain('=>') // 产物不得含箭头函数（非法方法名）
    expect(wxml).toContain('bind:open="proteusInlineContinueWritingPayloadDet"')
    expect(js).toContain('this.continueWriting(e.detail)')
    expect(js).toContain('this.onPick(e.detail.id)')
  })

  it('原生事件：参数 → 事件本体 e（原生事件载荷就是事件对象，不再包一层 detail）', () => {
    const { wxml, js } = compile(`<template>
      <button @click="(e) => handle(e)">x</button>
    </template>
    <script setup>
function handle(e) {}
    </script>`)
    expect(wxml).toContain('bindtap="proteusInlineHandlePayloadEvt"')
    expect(js).toContain('this.handle(e)')
    expect(js).not.toContain('this.handle(e.detail)')
  })

  it('无参箭头与 store 箭头：仍生成包装方法（无参键 NoArgs / this.store. 调用）', () => {
    const a = compile(`<template><view @tap="() => onTap(1)" /></template><script setup>
function onTap(n) {}
    </script>`)
    expect(a.wxml).toContain('proteusInlineOnTap1')
    expect(a.js).toContain('this.onTap(1)')

    const b = compile(`<template><view @tap="(n) => store.open(n)" /></template><script setup>
import { useWorkbenchStore } from '../stores/player'
const store = useWorkbenchStore()
    </script>`)
    expect(b.wxml).toContain('proteusStoreOpenPayloadDet')
    expect(b.js).toContain('this.store.open(e.detail)')
  })

  it('不可校准形态仍诚实警告 + 原样输出（体含 setup 局部变量 / 表达式 / 嵌套调用）', () => {
    for (const h of ['(n) => onPick(n, base)', '(n) => n + 1', '(n) => onPick(f(n))']) {
      const { wxml, warnings } = compile(
        `<template><view @tap="${h}" /></template><script setup>
const base = 1
function onPick(n, b) {}
function f(n) { return n }
        </script>`,
      )
      expect(warnings.some((w) => w.includes('不是简单方法引用')), `${h} 应告警`).toBe(true)
      expect(wxml).toContain(h) // 原样输出（不静默改写）
    }
  })

  it('★命名不得碰撞：() => log(\'n\') 与 (n) => log(n) 是两个方法（字面量不算用到载荷）', () => {
    const { js } = compile(`<template>
      <view @tap="() => log('n')" />
      <view @tap="(n) => log(n)" />
    </template>
    <script setup>
function log(v) {}
    </script>`)
    expect(js).toContain("this.log('n')")
    expect(js).toContain('this.log(e.detail)')
    // 两个方法体必须都在（同名去重会吃掉一个 → 事件指向错误方法体）
    expect((js.match(/this\.log\(/g) ?? []).length).toBe(2)
  })
})

describe('B6：页面 onUnload 退订 store 订阅（★2026-09-12 真机修复：不再 $dispose 全局 store）', () => {
  it('useXxxStore 页面 → onLoad 存 $subscribe 退订函数 + onUnload 退订（不销毁 app 级 store）', () => {
    const { js } = compile(
      `<template><p>{{ store.volume }}</p></template>\n  <script setup>\nimport { usePlayerStore } from '../stores/player'\nconst store = usePlayerStore()\n  </script>`,
    )
    // onLoad：保存 $subscribe 的退订函数（Pinia $subscribe 返回 unwatch）
    expect(js).toContain('this.__proteusStoreUnsub = this.store.$subscribe(')
    // onUnload：仅退订本页订阅——★不得调用 $dispose（会销毁 app 级全局 store）
    expect(js).toContain('if (this.__proteusStoreUnsub) { this.__proteusStoreUnsub(); this.__proteusStoreUnsub = null }')
    expect(js).not.toContain('this.store.$dispose()')
    expect(js).toContain('onUnload() {')
  })

  it('无 store 变量 → 不注入退订', () => {
    const { js } = compile('<template><p>{{ count }}</p></template><script setup>const count = ref(1)</script>')
    expect(js).not.toContain('__proteusStoreUnsub')
  })
})

describe('P3：共享模块放行（resolveSharedModule pinia 白名单）', () => {
  it('pinia 及其依赖链 → 解析（放行）', () => {
    const repoRoot = path.resolve(__dirname, '..')
    const r = resolveSharedModule(repoRoot, path.join(repoRoot, 'examples/pages/pinia-demo.vue'), '../stores/player')
    expect(r?.relNoExt).toBe('examples/stores/player')
  })

  it('其他第三方（lodash 等）→ 仍跳过', () => {
    expect(resolveSharedModule('/proj', '/proj/pages/a.vue', 'lodash')).toBeNull()
    expect(resolveSharedModule('/proj', '/proj/pages/a.vue', 'axios')).toBeNull()
  })
})

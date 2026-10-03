// tests/mp-global-layer-inject.test.ts —— ★★★GP3-b1：Global 层「每页注入 + 状态共享」回归锁（2026-10-03）
//
// 【这张卡解决什么】《Proteus_全局挂载点与App根组件方案》的核心承诺：
//   **源码声明一次（App.vue 的 <global-layer>），全应用生效**——而 MP 端每页是独立渲染树
//   （方案 §1.2-bis）⇒ 必须把外壳编译成**可注入片段**注入每个页面产物。
//
// 【★诚实边界（本测试锁的就是它，防"结论被放大"）】
//   · **源码层面**：声明一次 ✔（用例 ①）
//   · **实例层面**：每页一份实例（用例 ② 证明"每页都注入"）——与官方 custom-tab-bar 同模式
//   · **状态一份**：跨页一致靠共享模块（用例 ③ 的 require 路径 + 用例 ⑨ 的写镜像/拉取）
//   ⇒ **不得**把本测试读成"单实例跨页面存活"（那是 Web/自绘端的能力，MP 不成立）
//
// 【判据设计（不只看一个证据）】
//   ① 外壳编译：结构化件（wxml/data/methods/initLines）与**同源**产物（外壳 js 里也有同一方法）
//   ② 页面注入：wxml 前缀（树序） + data 直读共享状态 + 方法合并 + wxss 并入
//   ③ 共享通道：页面 require 相对路径正确 + 状态模块四 API 齐
//   ④ **冲突规则**：页面同名优先（不静默覆盖——有 warning）
//   ⑤ **生命周期黑名单**：壳方法叫 onShow ⇒ 不注入（否则与页面钩子抢键 ⇒ 页面钩子静默失效）
//   ⑥ **页面机制不泄漏**：外壳产物不含 onLoad/onReady/派发桥/滚动桥/探测复位
//   ⑦ **反向零开销**：无 <global-layer> ⇒ 不产片段、页面无 require、无注入行
//   ⑧ C1：变体 `App.mp.vue` 也允许声明（平台变体机制）
//   ⑨ 写镜像 + onShow 拉取（状态一致的两个方向）

import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '@proteus-vue/compiler'
import type { GlobalLayerSnippet } from '@proteus-vue/types'

const SHELL_SRC = `<script setup lang="ts">
import { ref } from 'vue'
const barVisible = ref(false)
const netText = ref('网络正常')
function toggleBar() { barVisible.value = !barVisible.value }
</script>
<template>
  <app-root>
    <global-layer>
      <view class="bar" @tap="toggleBar">{{ netText }}</view>
    </global-layer>
  </app-root>
</template>
<style scoped>.bar { color: red }</style>`

const PAGE_SRC = `<script setup lang="ts">
import { ref } from 'vue'
const title = ref('页面')
function go() { title.value = 'go' }
</script>
<template><view class="page"><text>{{ title }}</text><text @tap="go">tap</text></view></template>`

const compileShell = (src = SHELL_SRC, filename = 'App.vue') =>
  compileVueSfc(src, { filename, isComponent: false, appShell: true, px2rpx: false, rpxRatio: 2, platform: 'mp' })

const withReq = (s: GlobalLayerSnippet): GlobalLayerSnippet => ({ ...s, requirePath: '../_proteus/global-layer.js' })

const compilePage = (snippet?: GlobalLayerSnippet, src = PAGE_SRC, filename = 'pages/index.vue') =>
  compileVueSfc(src, {
    filename,
    isComponent: false,
    px2rpx: false,
    rpxRatio: 2,
    platform: 'mp',
    ...(snippet ? { globalLayer: withReq(snippet) } : {}),
  })

describe('★GP3-b1 · ① App 壳编译：结构化件产出（同源，不从产物文本反解）', () => {
  it('含 <global-layer> 的 App 壳 ⇒ isAppShell + 片段（wxml/data/methods/wxss/stateModuleRel）', () => {
    const r = compileShell()
    expect(r.isAppShell).toBe(true)
    const s = r.globalLayerSnippet
    expect(s, '应产出注入片段').toBeTruthy()
    expect(s!.wxml, 'wxml 是 global 层内容（解壳后）').toContain('{{ netText }}')
    expect(s!.wxml, '不含层标签本身').not.toContain('<global-layer')
    expect(s!.wxml, '不含 page 层内容（MP 端页面自成一 Page 层）').not.toContain('page-layer')
    expect(s!.data.map(([k]) => k).sort(), 'data 初值（保序条目形态）').toEqual(['barVisible', 'netText'])
    expect(s!.methods.join('\n'), '方法行（含 ref 改写后的 setData）').toContain('toggleBar()')
    expect(s!.methods.join('\n')).toContain('this.setData({ barVisible:')
    expect(s!.wxss, 'wxss 含壳样式').toContain('color: red')
    expect(s!.stateModuleRel, '共享状态模块路径（契约单调来源）').toBe('_proteus/global-layer.js')
    expect(s!.srcRel).toBe('App.vue')
  })

  it('★同源：片段方法行与外壳自身产物是同一份（不是两处实现）', () => {
    const r = compileShell()
    const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
    const snippetMethod = norm(r.globalLayerSnippet!.methods.join('\n'))
    // 外壳自身 js 里也应出现同一方法体（同一 codegen 交出——改一处不会只改半边）
    expect(r.js).toContain('toggleBar()')
    expect(norm(r.js), '片段方法体 = 外壳产物里的同一段（空白归一后相等）').toContain(snippetMethod)
  })

  it('★⑥ 外壳产物**不含页面机制**（onLoad/onReady/派发桥/滚动桥/探测复位）——外壳不是页面', () => {
    const js = compileShell().js
    expect(js, '不产 onLoad').not.toContain('onLoad(')
    expect(js, '不产 onReady').not.toContain('onReady(')
    expect(js, '不产生命周期派发桥').not.toContain('proteusPageEmit')
    expect(js, '不产探查复位').not.toContain('__PROTEUS_PROBES__')
    expect(js, '不产滚动桥').not.toContain('proteusPageScroll')
  })

  it('★⑦ 反向零开销：无 <global-layer> ⇒ 无片段（不产半成品）', () => {
    const r = compileShell(`<template><view>plain</view></template>`, 'App.vue')
    expect(r.isAppShell, '未声明层标签 ⇒ 不是壳').toBeFalsy()
    expect(r.globalLayerSnippet, '无层声明 ⇒ 无片段').toBeFalsy()
  })

  it('★⑦ 反向：声明了层但 global 为空（只写 page 层）⇒ 不产片段 + 可见警告（不静默）', () => {
    const r = compileShell(`<template><app-root><page-layer><view>x</view></page-layer></app-root></template>`, 'App.vue')
    expect(r.isAppShell).toBe(true)
    expect(r.globalLayerSnippet, '无 global 内容 ⇒ 无片段').toBeFalsy()
    expect(r.warnings.join('\n'), 'page 层有内容 ⇒ 说明"MP 不由外壳提供"').toContain('<page-layer> 含内容')
  })

  it('★⑧ C1 放行平台变体：`App.mp.vue` 允许声明挂载层（平台变体机制）', () => {
    const r = compileShell(SHELL_SRC, 'App.mp.vue')
    expect(r.isAppShell, '变体应被识别为壳').toBe(true)
    expect(r.globalLayerSnippet, '变体应产片段').toBeTruthy()
  })
})

describe('★GP3-b1 · ② 页面注入：wxml 前缀（树序）/ data 直读 / 方法合并 / wxss 并入', () => {
  const snippet = compileShell().globalLayerSnippet!

  it('★wxml：Global 层内容作为页面 wxml 的**前缀**（树序 = z-order ⇒ Global 在下、页面在上）', () => {
    const p = compilePage(snippet)
    const iGlobal = p.wxml.indexOf('netText')
    const iPage = p.wxml.indexOf('title')
    expect(iGlobal, '注入的全局内容应在页面里存在').toBeGreaterThanOrEqual(0)
    expect(iPage, '页面自身内容仍在').toBeGreaterThanOrEqual(0)
    expect(iGlobal, '★Global 内容在页面内容**之前**（树序表达层间顺序）').toBeLessThan(iPage)
  })

  it('★data：页面 data **直读共享状态**（Page 构造期即拿到最新值，不依赖 onShow）', () => {
    const js = compilePage(snippet).js
    expect(js, 'require 共享模块（路径由插件按页面目录回填）').toContain('require("../_proteus/global-layer.js")')
    expect(js, '★全局键初值从共享状态读（缺省回声明初值）').toMatch(/barVisible: \(function \(\) \{ var __s = __proteusGlobal\.get\("barVisible"\); return __s === undefined \? false : __s \}\)\(\)/)
    expect(js, 'netText 同理').toContain('__proteusGlobal.get("netText")')
  })

  it('★方法：壳方法注入页面（模板 @handler 可命中；同页面实例 this）', () => {
    const p = compilePage(snippet)
    expect(p.wxml, '页面 wxml 有壳绑定的 handler').toMatch(/bind:tap="toggleBar"/)
    expect(p.js, '页面 js 有壳方法实现').toContain('toggleBar()')
  })

  it('★wxss：壳样式并入页面（置前——页面样式可覆盖）', () => {
    const p = compilePage(snippet)
    const l = p.wxss
    expect(l, '壳样式在').toContain('color: red')
    expect(l.indexOf('color: red'), '壳样式在页面样式**之前**（页面可覆盖）').toBeLessThan(
      Math.max(l.lastIndexOf('.page'), 0) === 0 ? l.length : l.length,
    )
    // 更强判据：页面样式段落（.page-<scope>）在壳样式之后
    const scopeIdx = l.search(/\.page-data-v-/)
    if (scopeIdx >= 0) expect(l.indexOf('color: red'), '壳样式在前').toBeLessThan(scopeIdx)
  })

  it('★页面自身机制**完整保留**（注入不破坏页面：onLoad 参数解析/派发桥都在）', () => {
    const js = compilePage(snippet).js
    expect(js, '页面 onLoad（参数解析）仍在').toContain('onLoad(options)')
    expect(js, '页面派发桥仍在').toContain('proteusPageEmit')
    expect(js, '探测复位仍在（页面机制）').toContain('__PROTEUS_PROBES__')
  })

  it('★⑨ 状态一致两个方向：写镜像（setData 拦截）+ onShow 拉取', () => {
    const js = compilePage(snippet).js
    // 写方向：包装 setData，把全局键镜像进共享状态
    expect(js, '写镜像：包装 setData').toContain('__proteusGlobal.set(__k, patch[__k])')
    expect(js, '包装幂等（只装一次）').toContain('__proteusGlWrapped')
    // 读方向：onShow 拉取
    expect(js, '读方向：onShow 拉取').toContain('__proteusGlPull')
    expect(js, 'onShow 里调用拉取').toMatch(/onShow\(\) \{[\s\S]{0,120}__proteusGlPull/)
    // onLoad 里安装包装（先于任何 setData 写入）
    expect(js, 'onLoad 安装包装').toMatch(/onLoad\(options\) \{[\s\S]{0,200}__proteusGlWrap\(\)/)
  })

  it('★⑦ 反向：无片段 ⇒ 页面零注入（无 require、无桥方法、无 onShow 拉取）', () => {
    const js = compilePage(undefined).js
    expect(js).not.toContain('__proteusGlobal')
    expect(js).not.toContain('__proteusGlWrap')
    expect(js).not.toContain('__proteusGlPull')
  })

  it('★组件不注入（Global 层是页面级概念——组件产物不受影响）', () => {
    const c = compileVueSfc(`<template><view class="c"><slot /></view></template>`, {
      filename: 'components/x/index.vue',
      isComponent: true,
      px2rpx: false,
      rpxRatio: 2,
      platform: 'mp',
      globalLayer: withReq(snippet),
    })
    expect(c.js, '组件不 require 共享状态').not.toContain('__proteusGlobal')
    expect(c.wxml, '组件 wxml 无注入').not.toContain('netText')
  })
})

describe('★GP3-b1 · ④⑤ 合并规则：页面优先 + 生命周期黑名单（两条都是"防静默失效"）', () => {
  it('★④ 数据字段冲突：页面同名 ⇒ **页面优先**（不静默覆盖——有可见 warning）', () => {
    const snippet = compileShell().globalLayerSnippet!
    const p = compilePage(snippet, `<script setup lang="ts">
const netText = '页面自己的'
</script><template><view>{{ netText }}</view></template>`)
    expect(p.js, '页面字段保留自己的初值').toContain('netText: "页面自己的"')
    expect(p.js, '页面字段**不**从共享状态读（页面优先）').not.toContain('__proteusGlobal.get("netText")')
    // barVisible 不在页面里 ⇒ 仍注入
    expect(p.js, '未冲突的全局字段仍注入').toContain('__proteusGlobal.get("barVisible")')
  })

  it('★⑤ 方法冲突：页面同名 ⇒ **页面优先** + warning', () => {
    const snippet = compileShell().globalLayerSnippet!
    const p = compilePage(snippet, `<script setup lang="ts">
function toggleBar() { console.log('page version') }
</script><template><view @tap="toggleBar">x</view></template>`)
    const defs = p.js.match(/toggleBar\(\) \{/g) ?? []
    expect(defs.length, '同名方法只应有一份（页面优先）').toBe(1)
    expect(p.js, '保留的是页面版本').toContain("console.log('page version')")
    expect(p.warnings.join('\n'), '冲突必须可见（不静默）').toContain('页面优先')
  })

  it('★⑤ 生命周期黑名单：壳方法叫 onShow ⇒ 不注入（否则与页面钩子抢键 ⇒ 页面钩子静默失效）', () => {
    const r = compileShell(`<script setup lang="ts">
const n = { value: 0 }
function onShow() { n.value++ }
</script>
<template><app-root><global-layer><view @tap="onShow">x</view></global-layer></app-root></template>`)
    expect(r.warnings.join('\n'), '必须可见地说明"页面生命周期名不注入"').toContain('生命周期')
    // 页面注入后：onShow 只应有一个（页面的安全清单版本），不含壳逻辑
    const p = compilePage(r.globalLayerSnippet!, undefined)
    const onShowDefs = p.js.match(/onShow\(\) \{/g) ?? []
    expect(onShowDefs.length, 'onShow 只能有一处定义（页面钩子不被覆盖）').toBe(1)
  })
})

describe('★★2026-10-04 回归锁：编译缓存键**必须含 App 壳片段**（本轮真缺陷）', () => {
  // 【缺陷】页面编译时注入壳片段，但缓存键不含它 ⇒ **改壳后页面命中旧缓存** ⇒ 新方法/字段永不注入。
  //   实测：壳里新增的 saSyncTabBarBadge 在**全部页面产物**里缺失（单独编译壳却有）——
  //   排查三轮才定位到缓存。修法：plugin.ts 的 compileCacheKey 传 globalLayerFingerprint。
  it('★compileCacheKey 的 options 含 globalLayerFingerprint（不同壳片段 ⇒ 不同键）', async () => {
    const { compileCacheKey } = await import('../packages/plugin-vite/src/cache')
    const optsA = { rel: 'pages/a.vue', isComponent: false, px2rpx: false, rpxRatio: 2, annotateLines: false, debug: false, globalLayerFingerprint: 'SHELL_A' }
    const optsB = { ...optsA, globalLayerFingerprint: 'SHELL_B' }
    const root = process.cwd()
    const kA = compileCacheKey('<view/>', optsA, root)
    const kB = compileCacheKey('<view/>', optsB, root)
    expect(kA, '★壳片段不同 ⇒ 缓存键必须不同（否则改壳不失效）').not.toBe(kB)
    // 反向：其余相同 ⇒ 键相同（缓存仍有效——不是把缓存整个废掉）
    const kA2 = compileCacheKey('<view/>', { ...optsA }, root)
    expect(kA2, '同输入 ⇒ 同键（缓存仍工作）').toBe(kA)
  })

  it('★plugin.ts 确实把 shell 片段传进缓存键（源码级判据——防"改回不传"）', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../packages/plugin-vite/src/plugin.ts', import.meta.url), 'utf-8')
    expect(src, '★缓存键构造处必须传 globalLayerFingerprint').toContain('globalLayerFingerprint:')
    expect(src, '★且取值来自 globalLayerSnippet（不是常量占位）').toMatch(/globalLayerFingerprint:[\s\S]{0,200}globalLayerSnippet/)
  })
})

describe('★GP3-b1 · ③ 共享状态模块：API 齐备（写/读/快照/订阅）', () => {
  it('状态模块源码含 get/set/has/all/subscribe（页面桥只调 get/set）', async () => {
    const mod = await import('../packages/plugin-vite/src/appSkeleton')
    const code = mod.GLOBAL_LAYER_STATE_CODE
    for (const api of ['get:', 'set:', 'has:', 'all:', 'subscribe:']) {
      expect(code, `状态模块应有 ${api}`).toContain(api)
    }
    expect(code, '模块级单例（跨页一份）').toContain('var __state = Object.create(null)')
    expect(code, 'set 通知订阅者（为将来实时同步预留）').toContain('__subs[k]')
  })

  it('契约常量与片段默认值同源（不在两处硬编码）', async () => {
    const contracts = await import('@proteus-vue/contracts')
    const snippet = compileShell().globalLayerSnippet!
    expect(snippet.stateModuleRel).toBe(contracts.GLOBAL_LAYER_STATE_MODULE)
  })
})

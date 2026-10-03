// tests/gp5-scenarios.test.ts —— ★★★GP5：八条超级应用场景回归锁（2026-10-03）
//
// 【这张卡解决什么（任务卡 GP5 原文）】八条超级应用场景（Toast / Loading / 登录拦截 / 悬浮球 /
//   音乐条 / 网络状态条 / 主题容器 / IM 角标）**任一条需要每页引入 ⇒ 方案不成立**。
//   本测试锁的是**编译期可判定的那半**："声明一次 → 每页自动获得"（真机 e2e 验端上行为）。
//
// 【★判据设计（三层，缺一即可能是假绿）】
//   ① **零声明**：GP5 演示页源码**不含**任何场景元素/全局字段——它只用注入的壳方法
//      （若哪天开发者"顺手"在页面里也写一份，本测试的负向断言会红）；
//   ② **声明面齐备**：App 壳的 Global 层含四条场景的字段/方法（可枚举、可数）；
//   ③ **注入面生效**：任意页面编译后 —— data 直读共享状态 + 壳方法合并 + wxml 前缀。
//   ★④ C2 上限：四条场景加入后节点数仍在 32 以内（**这是回归锁**：场景继续膨胀会被编译期拦住）。
//
// 【★与 e2e 的分工】本文件证"编译期结构"（零引入/注入/计数）；`tests/e2e-mp-gp5.test.ts`
//   证"端上行为"（真机：切换 → 出现 → 跨页仍在 → 其它页拉到同一份状态）。

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compileVueSfc, transformTemplateToWxml } from '@proteus-vue/compiler'
import type { GlobalLayerSnippet } from '@proteus-vue/types'

const APP_MP = path.resolve(__dirname, '../examples/App.mp.vue')
const DEMO = path.resolve(__dirname, '../examples/subpackages/svg-lab/pages/gp5-scenarios-demo.vue')
/** ★先剥注释再判（本仓教训：断言自污染——我自己的说明注释里写了 `<app-root>` 字面量 → 误红） */
const stripComments = (src: string): string =>
  src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
const appSrc = fs.readFileSync(APP_MP, 'utf-8')
const demoSrc = stripComments(fs.readFileSync(DEMO, 'utf-8'))

/** 从 SFC 取 `<template>` 段（C2 计数在模板变换结果上——`compileVueSfc` 不透传该字段） */
const templateOf = (sfc: string): string => {
  const m = /<template[^>]*>([\s\S]*)<\/template>/i.exec(sfc)
  return m ? m[1] : ''
}

const compileShell = (src = appSrc, filename = 'App.mp.vue') =>
  compileVueSfc(src, { filename, isComponent: false, appShell: true, px2rpx: false, rpxRatio: 2, platform: 'mp' })

const withReq = (s: GlobalLayerSnippet): GlobalLayerSnippet => ({ ...s, requirePath: '../_proteus/global-layer.js' })

const PAGE_SRC = `<script setup lang="ts">
import { ref } from 'vue'
const title = ref('页面')
</script>
<template><view class="page"><text>{{ title }}</text></view></template>`

const compilePage = (snippet?: GlobalLayerSnippet, src = PAGE_SRC, filename = 'pages/index.vue') =>
  compileVueSfc(src, {
    filename,
    isComponent: false,
    px2rpx: false,
    rpxRatio: 2,
    platform: 'mp',
    ...(snippet ? { globalLayer: withReq(snippet) } : {}),
  })

describe('★GP5 · ① 演示页**零全局声明**（"每页零引入"的直接证据）', () => {
  it('演示页源码不含任何挂载层标签（没有 app-root / global-layer）', () => {
    expect(demoSrc, '不含 <app-root>').not.toContain('<app-root')
    expect(demoSrc, '不含 <global-layer>').not.toContain('<global-layer')
    // 也不含任何场景元素的 id（悬浮球/音乐条/主题/角标全在 App 壳）
    for (const id of ['gl-fab', 'gl-music-bar', 'gl-theme-bg', 'gl-im-badge', 'gl-net-bar']) {
      expect(demoSrc.includes(`id="${id}"`), `演示页不应声明 #${id}（那会在 App 壳之外造第二份）`).toBe(false)
    }
  })

  it('演示页编译（无注入①）⇒ 产物里**没有**全局场景元素（证明内容确实来自壳）', () => {
    const p = compilePage(undefined, demoSrc, 'pages/gp5-scenarios-demo.vue')
    expect(p.wxml, '无壳注入 ⇒ 产物无悬浮球').not.toContain('gl-fab')
    expect(p.wxml, '无壳注入 ⇒ 产物无音乐条').not.toContain('gl-music-bar')
    expect(p.wxml, '无壳注入 ⇒ 产物无主题层').not.toContain('gl-theme-bg')
    expect(p.wxml, '无壳注入 ⇒ 产物无 IM 角标').not.toContain('gl-im-badge')
  })

  it('演示页编译（有注入②）⇒ 产物里**出现**四条场景（内容来自壳注入）', () => {
    const snippet = compileShell().globalLayerSnippet!
    const p = compilePage(snippet, demoSrc, 'pages/gp5-scenarios-demo.vue')
    expect(p.wxml, '注入后应出现悬浮球').toContain('gl-fab')
    expect(p.wxml, '注入后应出现音乐条').toContain('gl-music-bar')
    expect(p.wxml, '注入后应出现主题层').toContain('gl-theme-bg')
    expect(p.wxml, '注入后应出现 IM 角标').toContain('gl-im-badge')
    // 注入在前（树序）——全局内容先于页面自身内容
    expect(p.wxml.indexOf('gl-fab'), '★注入内容在页面内容之前（树序表达层间顺序）').toBeLessThan(p.wxml.indexOf('gp5-title'))
  })
})

describe('★GP5 · ② 声明面齐备：四条场景字段/方法都在壳的结构化件里', () => {
  const snippet = compileShell().globalLayerSnippet!

  it('场景字段齐全（④悬浮球 ⑤音乐条 ⑦主题 ⑧IM 角标——与 ⑥状态条并列）', () => {
    const keys = snippet.data.map(([k]) => k)
    for (const k of ['fabVisible', 'musicVisible', 'musicPlaying', 'theme', 'imUnread', 'barVisible', 'netText']) {
      expect(keys, `应含场景字段 ${k}`).toContain(k)
    }
  })

  it('场景方法齐全（glToggleFab / glToggleMusic / glTogglePlay / glToggleTheme / glBumpIm / glClearIm）', () => {
    const methods = snippet.methods.join('\n')
    for (const m of ['glToggleFab()', 'glToggleMusic()', 'glTogglePlay()', 'glToggleTheme()', 'glBumpIm()', 'glClearIm()']) {
      expect(methods, `应含场景方法 ${m}`).toContain(m)
    }
  })

  it('★④ C2 上限回归锁：Global 层节点数 ≤ 32（场景膨胀会被编译期拦住）', () => {
    const r = transformTemplateToWxml(templateOf(appSrc), { px2rpx: false, rpxRatio: 2, filename: 'App.mp.vue' }) as unknown as {
      mountLayers?: { global?: { nodeCount: number } }
    }
    const count = r.mountLayers?.global?.nodeCount ?? 0
    expect(count, 'Global 层应有节点（四条场景 + 状态条 + 主题层）').toBeGreaterThanOrEqual(5)
    expect(count, '★节点数必须 ≤ 契约上限 32（含余量——场景继续加会被 C2 拦）').toBeLessThanOrEqual(32)
    // 编译不能报 C2（当前声明在限内）
    expect(compileShell().warnings.join('\n'), '不应触发 C2 超限警告').not.toContain('超过上限')
  })

  it('★场景样式并入片段（wxss 含四条场景的类名）', () => {
    for (const cls of ['.gl-fab', '.gl-music-bar', '.gl-theme-bg', '.gl-im-badge']) {
      expect(snippet.wxss, `壳样式应含 ${cls}`).toContain(cls)
    }
  })
})

describe('★GP5 · ③ 注入面：任意页面自动获得四条场景（声明一次、全应用生效）', () => {
  const snippet = compileShell().globalLayerSnippet!

  it('数据直读共享状态（页面构造期即拿到——不依赖 onShow）', () => {
    const js = compilePage(snippet).js
    expect(js, '__proteusGlobal.get("fabVisible")').toContain('__proteusGlobal.get("fabVisible")')
    expect(js, '__proteusGlobal.get("imUnread")').toContain('__proteusGlobal.get("imUnread")')
    expect(js, '__proteusGlobal.get("theme")').toContain('__proteusGlobal.get("theme")')
    expect(js, '__proteusGlobal.get("musicVisible")').toContain('__proteusGlobal.get("musicVisible")')
  })

  it('壳方法合并进页面实例（模板 @handler 可命中）', () => {
    const js = compilePage(snippet).js
    for (const m of ['glToggleFab', 'glToggleMusic', 'glToggleTheme', 'glBumpIm']) {
      expect(js, `页面 js 应含壳方法 ${m}`).toContain(`${m}()`)
    }
  })

  it('★写镜像覆盖四条场景字段（任意页写入 ⇒ 其它页拉到同一份）', () => {
    const js = compilePage(snippet).js
    expect(js, 'setData 拦截把全局键镜像进共享状态').toContain('__proteusGlobal.set(__k, patch[__k])')
    // 全局键表里含场景字段（把 setData 的镜像键表读出来核对）
    expect(js, '键表含 imUnread').toMatch(/__keys = \[[^\]]*"imUnread"/)
    expect(js, '键表含 fabVisible').toMatch(/__keys = \[[^\]]*"fabVisible"/)
  })

  it('★⑦ 主题容器在树序最前（Global 层内第一个节点 = 最底层——页面背景透明时透出）', () => {
    const wxml = snippet.wxml
    expect(wxml.indexOf('gl-theme-bg'), '主题层应先于其它场景').toBeLessThan(wxml.indexOf('gl-fab'))
  })
})

describe('★GP5 · ④ 反向：八条场景的宿主都"不每页引入"（本方案对 uni-app 的核心差异）', () => {
  it('Overlay 三条（Toast/Loading/登录拦截）宿主由**构建期按需注入**——演示页源码无宿主标签', () => {
    for (const f of ['gp4-toast-queue-demo.vue', 'gp4-loading-demo.vue']) {
      const src = fs.readFileSync(path.resolve(__dirname, `../examples/subpackages/svg-lab/pages/${f}`), 'utf-8')
      expect(src.includes('<p-toast-host'), `${f} 不应手写 toast 宿主（注入负责）`).toBe(false)
      expect(src.includes('<p-loading-host'), `${f} 不应手写 loading 宿主（注入负责）`).toBe(false)
    }
  })

  it('登录拦截 = 手写宿主的**唯一例外**（需绑业务动作）——且已在注释里写明理由', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../examples/subpackages/svg-lab/pages/gp4-auth-gate-demo.vue'), 'utf-8')
    expect(src.includes('<p-auth-gate'), '本页手写宿主（onAction 需绑定）').toBe(true)
    expect(src, '必须写明"为什么手写"（防后人误当违规）').toContain('手写宿主')
  })
})

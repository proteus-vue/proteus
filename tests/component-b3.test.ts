// tests/component-b3.test.ts
// ★组件库落地评估 v2（B3）：p-scroll-view（滚动容器）+ p-list-view（virtual-list 通用化）+ virtual-list 兼容别名
// 高性能要点断言：start 守卫（intra-row 滚动零 setData）/ items 变化响应（Web watch + MP observers）/ lazy 门控 / virtual 开关
import { describe, it, expect, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compileVueSfc } from '../packages/compiler/src'
import { runGenRoutes } from '../packages/plugin-vite/src/gen-routes'
import type { ProteusConfig } from '../packages/plugin-vite/src/config'

const COMPONENTS_DIR = path.resolve('src/components')
const FRAMEWORK_COMPONENTS_DIR = path.resolve('src/components')

function compileComponent(tag: string) {
  const sfc = fs.readFileSync(path.join(COMPONENTS_DIR, tag, 'index.vue'), 'utf-8')
  return compileVueSfc(sfc, { isComponent: true, filename: `src/components/${tag}/index.vue` })
}

describe('p-scroll-view（滚动容器，薄包装）', () => {
  it('MP 产物：scroll-view 透传 + 滚动/触底/刷新事件转发 + 插槽', () => {
    const { wxml, js } = compileComponent('p-scroll-view')
    expect(wxml).toContain('<scroll-view')
    expect(wxml).toContain('scroll-y="{{scrollY}}"')
    expect(wxml).toContain('lower-threshold="{{lowerThreshold}}"')
    expect(wxml).toContain('bindscroll="onScroll"')
    expect(wxml).toContain('bind:scrolltolower="onScrollToLower"')
    expect(wxml).toContain('bind:refresherrefresh="onRefresherRefresh"')
    expect(wxml).toContain('<slot')
    expect(js).toContain("this.triggerEvent('scroll', e)")
    expect(js).toContain("this.triggerEvent('scrolltolower', e)")
  })
})

describe('p-list-view（虚拟长列表，virtual-list 通用化）', () => {
  it('MP 产物：scroll-view + 虚拟/全量双分支 + 占位 + items observers + 守卫', () => {
    const { wxml, js } = compileComponent('p-list-view')
    // wxml：虚拟窗口（占位 + visible）与全量分支（v-else over items）
    expect(wxml).toContain('<scroll-view')
    expect(wxml).toContain('wx:if="{{virtual}}"')
    expect(wxml).toContain('wx:for="{{visible}}"')
    expect(wxml).toContain('wx:else wx:for="{{items}}"')
    expect(wxml).toContain("height:{{start * itemHeight + 'px'}}")
    // js：items 变化响应（props 源 watch → observers）
    expect(js).toContain('observers: {')
    expect(js).toContain('items(n, o) {')
    expect(js).toContain('calc()')
    // js：首帧 + 性能守卫 + lazy 门控
    expect(js).toContain('onReady() {')
    expect(js).toContain('if (s === this.data.start) return')
    expect(js).toContain('this.data.lazy && !this.data.ready')
  })

  it('calc 方法内 props 改写为 this.data + 窗口数学走纯函数 getVirtualWindow（MP 运行时安全）', () => {
    const { js } = compileComponent('p-list-view')
    expect(js).toContain('this.data.items.slice(w.start, w.start + w.count)')
    expect(js).toContain('getVirtualWindow(')
    expect(js).not.toContain('props.items.slice')
  })
})

describe('virtual-list 兼容别名（转发 p-list-view）', () => {
  it('产物：p-list-view 转发 + 原 props 表面不变', () => {
    const { wxml, js } = compileComponent('virtual-list')
    expect(wxml).toContain('<p-list-view')
    expect(wxml).toContain('items="{{items}}"')
    expect(wxml).toContain('item-height="{{itemHeight}}"')
    expect(wxml).toContain('height="{{height}}"')
    expect(js).toContain('items: { type: Array }')
  })

  it('gen-routes 嵌套：virtual-list 的 component.json 解析 p-list-view → /proteus/p-list-view/index', () => {
    const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-comp-b3-'))
    afterAll(() => {
      fs.rmSync(TMP, { recursive: true, force: true })
    })
    const root = path.join(TMP, 'nest')
    const pageDir = path.join(root, 'src/pages')
    fs.mkdirSync(pageDir, { recursive: true })
    fs.writeFileSync(
      path.join(pageDir, 'index.vue'),
      `<template><virtual-list :items="items" /></template>\n`,
    )
    fs.writeFileSync(
      path.join(root, 'src/pages', 'index.json.expected'),
      'x',
    )
    const config: ProteusConfig = {
      platform: 'mp-weixin',
      skyline: true,
      appid: 'wx0000000000',
      pagesDir: 'src/pages',
      routesOutput: 'src/router/auto-routes.ts',
      customRoute: { registerPresets: true, builders: {} },
      setDataBridge: { batchWindow: 16, perComponent: true },
      style: { px2rpx: true, rpxRatio: 2 },
    }
    runGenRoutes({ config, root, frameworkComponentsDir: FRAMEWORK_COMPONENTS_DIR })
    // 页面 → virtual-list；virtual-list 组件.json → p-list-view（嵌套解析）
    const pageJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/pages/index.json'), 'utf-8'))
    expect(pageJson.usingComponents['virtual-list']).toBe('/proteus/virtual-list/index')
    const vlJsonPath = path.join(root, 'dist/mp-weixin/proteus/virtual-list/index.json')
    const vlJson = JSON.parse(fs.readFileSync(vlJsonPath, 'utf-8'))
    expect(vlJson.usingComponents['p-list-view']).toBe('/proteus/p-list-view/index')
  })
})

describe('p-list-view / p-scroll-view 端到端（页面 usingComponents 自动解析）', () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-comp-b3-page-'))
  afterAll(() => {
    fs.rmSync(TMP, { recursive: true, force: true })
  })
  const root = path.join(TMP, 'demo')
  const pageDir = path.join(root, 'src/pages')
  fs.mkdirSync(pageDir, { recursive: true })

  it('页面用 p-scroll-view/p-list-view → page.json usingComponents 指向 /proteus/<tag>/index', () => {
    fs.writeFileSync(
      path.join(pageDir, 'index.vue'),
      `<template><p-scroll-view><p-list-view :items="items" /></p-scroll-view></template>\n<route>\n{\n  "meta": { "title": "列表" }\n}\n</route>\n`,
    )
    const config: ProteusConfig = {
      platform: 'mp-weixin',
      skyline: true,
      appid: 'wx0000000000',
      pagesDir: 'src/pages',
      routesOutput: 'src/router/auto-routes.ts',
      customRoute: { registerPresets: true, builders: {} },
      setDataBridge: { batchWindow: 16, perComponent: true },
      style: { px2rpx: true, rpxRatio: 2 },
    }
    runGenRoutes({ config, root, frameworkComponentsDir: FRAMEWORK_COMPONENTS_DIR })
    const pageJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/pages/index.json'), 'utf-8'))
    expect(pageJson.usingComponents['p-scroll-view']).toBe('/proteus/p-scroll-view/index')
    expect(pageJson.usingComponents['p-list-view']).toBe('/proteus/p-list-view/index')
  })
})

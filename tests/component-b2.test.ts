// tests/component-b2.test.ts
// ★组件库落地评估 v2（B2）：基础组件 a（p-view / p-text / p-image / p-button）
// 验证两件事：
//   1. 组件 SFC 走既有编译管线 → MP 四件套正确（wxml 标签映射 / properties / 事件 / 节流逻辑）
//   2. gen-routes 端到端：页面用 p-* 标签 → usingComponents /proteus/<tag>/index 自动解析
import { describe, it, expect, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'
import { runGenRoutes } from '../packages/plugin-vite/src/gen-routes'
import type { ProteusConfig } from '../packages/plugin-vite/src/config'

const COMPONENTS_DIR = path.resolve('src/components')
const FRAMEWORK_COMPONENTS_DIR = path.resolve('src/components')

function readSfc(tag: string): string {
  return fs.readFileSync(path.join(COMPONENTS_DIR, tag, 'index.vue'), 'utf-8')
}

function compileComponent(tag: string) {
  return compileVueSfc(readSfc(tag), { isComponent: true, filename: `src/components/${tag}/index.vue` })
}

describe('p-view（通用容器）', () => {
  it('MP 产物：div → view + 插槽透传 + BaseProps properties', () => {
    const { wxml, js } = compileComponent('p-view')
    expect(wxml).toContain('<view')
    expect(wxml).toMatch(/class="[^"]*\bp-view\b/) // 合并后单 class 属性：scope class + p-view + :class 绑定
    expect(wxml).toContain('aria-label="{{ariaLabel}}"')
    expect(wxml).toContain('<slot')
    expect(js).toContain('Component({')
    expect(js).toContain('pid: { type: String, value: "" }')
    expect(js).toContain('disabled: { type: Boolean, value: false }')
    expect(js).toContain('ariaLabel: { type: String, value: "" }')
  })
})

describe('p-text（文本）', () => {
  it('MP 产物：span → text + selectable 透传', () => {
    const { wxml, js } = compileComponent('p-text')
    expect(wxml).toContain('<text')
    expect(wxml).toMatch(/class="[^"]*\bp-text\b/)
    expect(wxml).toContain('selectable="{{selectable ? \'true\' : \'\'}}"')
    expect(wxml).toContain('<slot')
    expect(js).toContain('selectable: { type: Boolean, value: false }')
  })
})

describe('p-image（图片）', () => {
  it('MP 产物：img → image + mode/lazy-load/placeholder 映射 + bind:load/bind:error', () => {
    const { wxml, js } = compileComponent('p-image')
    expect(wxml).toContain('<image')
    expect(wxml).toMatch(/class="[^"]*\bp-image\b/)
    expect(wxml).toContain('src="{{src}}"')
    expect(wxml).toContain('mode="{{mode}}"')
    expect(wxml).toContain('lazy-load="{{lazyLoad ? \'true\' : \'\'}}"')
    expect(wxml).toContain('bind:load="onLoad"')
    expect(wxml).toContain('bind:error="onError"')
    // mode 的 Web 映射走 CSS 类（编译器 computed 仅支持箭头表达式体，块体被忽略）
    expect(wxml).toContain('p-image--')
    // 事件转发 triggerEvent
    expect(js).toContain("this.triggerEvent('load', e)")
    expect(js).toContain("this.triggerEvent('error', e)")
  })
})

describe('p-button（按钮）', () => {
  it('MP 产物：button 透传 + disabled 联动 + bindtap + throttle 防重复', () => {
    const { wxml, js } = compileComponent('p-button')
    expect(wxml).toContain('<button')
    expect(wxml).toMatch(/class="[^"]*\bp-button\b/)
    expect(wxml).toContain('disabled="{{disabled || loading}}"')
    expect(wxml).toContain('bindtap="onClick"')
    expect(js).toContain('throttle: { type: Number, value: 0 }')
    // 节流：时间戳防抖，emit → triggerEvent
    expect(js).toContain('this.data.throttle > 0')
    expect(js).toContain("this.triggerEvent('click', e)")
  })
})

describe('gen-routes 端到端（p-* 组件 usingComponents 自动解析）', () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-comp-b2-'))
  afterAll(() => {
    fs.rmSync(TMP, { recursive: true, force: true })
  })

  function makeConfig(extra: Partial<ProteusConfig> = {}): ProteusConfig {
    return {
      platform: 'mp-weixin',
      skyline: true,
      appid: 'wx0000000000',
      pagesDir: 'src/pages',
      routesOutput: 'src/router/auto-routes.ts',
      customRoute: { registerPresets: true, builders: {} },
      setDataBridge: { batchWindow: 16, perComponent: true },
      style: { px2rpx: true, rpxRatio: 2 },
      ...extra,
    }
  }

  function writeFixture(dir: string, rel: string, content: string): void {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }

  it('页面使用 p-view/p-text/p-button/p-image → page.json usingComponents 指向 /proteus/<tag>/index', () => {
    const root = path.join(TMP, 'demo')
    writeFixture(
      root,
      'src/pages/index.vue',
      `<template><p-view><p-text>hi</p-text></p-view><p-button>go</p-button><p-image src="x" /></template>\n<route>\n{\n  "meta": { "title": "组件演示" }\n}\n</route>\n`,
    )

    runGenRoutes({ config: makeConfig(), root, frameworkComponentsDir: FRAMEWORK_COMPONENTS_DIR })

    const pageJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/pages/index.json'), 'utf-8'))
    expect(pageJson.usingComponents['p-view']).toBe('/proteus/p-view/index')
    expect(pageJson.usingComponents['p-text']).toBe('/proteus/p-text/index')
    expect(pageJson.usingComponents['p-button']).toBe('/proteus/p-button/index')
    expect(pageJson.usingComponents['p-image']).toBe('/proteus/p-image/index')
  })

  it('未注册的 p- 前缀标签 → 警告且不进 usingComponents（防拼写错误静默）', () => {
    const root = path.join(TMP, 'typo')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFixture(root, 'src/pages/index.vue', `<template><pv-button>go</pv-button></template>\n`)
    runGenRoutes({ config: makeConfig(), root, frameworkComponentsDir: FRAMEWORK_COMPONENTS_DIR })
    const pageJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/pages/index.json'), 'utf-8'))
    expect(pageJson.usingComponents ?? {}).toEqual({})
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pv-button'))
    warnSpy.mockRestore()
  })
})

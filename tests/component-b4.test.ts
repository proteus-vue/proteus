// tests/component-b4.test.ts
// ★组件库落地评估 v2（B4）：p-input / p-textarea（表单）+ 事件归一 runtime/event
// 事件契约：`:value` + `@input`（载荷 { value } 跨端归一，替代 v-model——MP 自定义组件 v-model 仅覆盖原生 input/textarea）
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compileVueSfc } from '../packages/compiler/src'
import { runGenRoutes } from '../packages/plugin-vite/src/gen-routes'
import type { ProteusConfig } from '../packages/plugin-vite/src/config'
import { eventField, eventValue, eventScrollTop } from '../src/components/runtime/event'
import { resolveSharedModule } from '../packages/plugin-vite/src/plugin'

const COMPONENTS_DIR = path.resolve('src/components')
const FRAMEWORK_COMPONENTS_DIR = path.resolve('src/components')

function compileComponent(tag: string) {
  const sfc = fs.readFileSync(path.join(COMPONENTS_DIR, tag, 'index.vue'), 'utf-8')
  return compileVueSfc(sfc, {
    isComponent: true,
    filename: `src/components/${tag}/index.vue`,
    // 模拟插件 module-plan B0：相对共享模块 → require（独立编译需显式传入）
    moduleImports: [{ source: '../runtime/event', requirePath: './runtime/event' }],
  })
}

describe('runtime/event 事件归一（跨端安全）', () => {
  it('MP 形态：e.detail.value 优先（input/scrollTop）', () => {
    expect(eventValue({ detail: { value: 'hi' } })).toBe('hi')
    expect(eventScrollTop({ detail: { scrollTop: 120 } })).toBe(120)
  })
  it('Web 形态：e.target.value / e.target.scrollTop 兜底', () => {
    expect(eventValue({ target: { value: 'web' } })).toBe('web')
    expect(eventScrollTop({ target: { scrollTop: 88 } })).toBe(88)
  })
  it('缺失/非字符串 → 安全兜底（不抛错）', () => {
    expect(eventValue({})).toBe('')
    expect(eventValue(null)).toBe('')
    expect(eventValue({ detail: { value: 5 } })).toBe('')
    expect(eventScrollTop(undefined)).toBe(0)
  })
  it('eventField 通用读取：detail 优先于 target', () => {
    expect(eventField({ detail: { x: 1 }, target: { x: 2 } }, 'x')).toBe(1)
    expect(eventField({ target: { y: 't' } }, 'y')).toBe('t')
  })
})

describe('p-input（输入框）', () => {
  it('MP 产物：input 透传 + value/type/maxlength/placeholder/focus + 事件归一转发', () => {
    const { wxml, js } = compileComponent('p-input')
    expect(wxml).toContain('<input')
    expect(wxml).toContain('value="{{value}}"')
    expect(wxml).toContain('type="{{type}}"')
    expect(wxml).toContain('maxlength="{{maxlength}}"')
    expect(wxml).toContain('placeholder="{{placeholder}}"')
    expect(wxml).toContain('focus="{{focus}}"')
    expect(wxml).toContain('bindinput="onInput"')
    expect(wxml).toContain('bindconfirm="onConfirm"')
    expect(wxml).toContain('bindfocus="onFocus"')
    expect(wxml).toContain('bindblur="onBlur"')
    // 共享模块 require + 载荷归一 { value }
    expect(js).toContain("const { eventValue } = require('./runtime/event')")
    expect(js).toContain("this.triggerEvent('input', { value: eventValue(e) })")
    expect(js).toContain("this.triggerEvent('confirm', { value: eventValue(e) })")
  })
})

describe('p-textarea（多行文本域）', () => {
  it('MP 产物：textarea 透传 + value/placeholder + 事件归一转发', () => {
    const { wxml, js } = compileComponent('p-textarea')
    expect(wxml).toContain('<textarea')
    expect(wxml).toContain('value="{{value}}"')
    expect(wxml).toContain('maxlength="{{maxlength}}"')
    expect(wxml).toContain('bindinput="onInput"')
    expect(wxml).toContain('bindconfirm="onConfirm"')
    expect(js).toContain("const { eventValue } = require('./runtime/event')")
    expect(js).toContain("this.triggerEvent('input', { value: eventValue(e) })")
  })
})

describe('p-list-view 事件归一（B3 组件接入 eventScrollTop，Web 滚动安全）', () => {
  it('onScroll 用 eventScrollTop（不再直读 e.detail.scrollTop）', () => {
    const sfc = fs.readFileSync(path.join(COMPONENTS_DIR, 'p-list-view', 'index.vue'), 'utf-8')
    const { js } = compileVueSfc(sfc, {
      isComponent: true,
      filename: 'src/components/p-list-view/index.vue',
      moduleImports: [{ source: '../runtime/event', requirePath: './runtime/event' }],
    })
    expect(js).toContain('eventScrollTop(e)')
    expect(js).not.toContain('e.detail.scrollTop')
  })
})

describe('resolveSharedModule 框架资产重定位（appDir 之外 → proteus/ 前缀）', () => {
  it('框架组件引 runtime/event → relNoExt 重定位为 proteus/runtime/event（emitFile 不允许 ../ 越界）', () => {
    const root = path.resolve('.')
    const appDir = path.join(root, 'examples')
    const frameworkDir = path.join(root, 'src/components')
    const r = resolveSharedModule(appDir, path.join(frameworkDir, 'p-input/index.vue'), '../runtime/event', frameworkDir)
    expect(r?.relNoExt).toBe('proteus/runtime/event')
    expect(r?.relNoExt).not.toMatch(/^\.\.\//)
  })

  it('app 内共享模块不受影响（保持相对 appDir 路径）', () => {
    const root = path.resolve('.')
    const appDir = path.join(root, 'examples')
    const r = resolveSharedModule(appDir, path.join(appDir, 'pages/a.vue'), '../utils/format')
    expect(r?.relNoExt).toBe('utils/format')
  })
})

describe('gen-routes 端到端（p-input / p-textarea 自动解析）', () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-comp-b4-'))
  afterAll(() => {
    fs.rmSync(TMP, { recursive: true, force: true })
  })
  const root = path.join(TMP, 'demo')
  const pageDir = path.join(root, 'src/pages')
  fs.mkdirSync(pageDir, { recursive: true })

  it('页面用 p-input/p-textarea → usingComponents /proteus/<tag>/index', () => {
    fs.writeFileSync(
      path.join(pageDir, 'index.vue'),
      `<template><p-input :value="name" @input="onName" /><p-textarea :value="bio" @input="onBio" /></template>\n<route>\n{\n  "meta": { "title": "表单" }\n}\n</route>\n`,
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
    expect(pageJson.usingComponents['p-input']).toBe('/proteus/p-input/index')
    expect(pageJson.usingComponents['p-textarea']).toBe('/proteus/p-textarea/index')
  })
})

// tests/component-b6.test.ts
// ★组件库落地评估 v2（B6）：p-nav-bar（普通态）/ p-skeleton / p-error-boundary
// + 编译器反黑盒：未映射 onXxx 钩子显式警告（onErrorCaptured 平台限制）
import { describe, it, expect, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compileVueSfc, transformScriptToPage } from '../packages/compiler/src'
import { runGenRoutes } from '../packages/plugin-vite/src/gen-routes'
import type { ProteusConfig } from '../packages/plugin-vite/src/config'

const COMPONENTS_DIR = path.resolve('src/components')
const FRAMEWORK_COMPONENTS_DIR = path.resolve('src/components')

function compileComponent(tag: string) {
  const sfc = fs.readFileSync(path.join(COMPONENTS_DIR, tag, 'index.vue'), 'utf-8')
  return compileVueSfc(sfc, { isComponent: true, filename: `src/components/${tag}/index.vue` })
}

describe('p-nav-bar（导航栏普通态）', () => {
  it('MP 产物：title/back/fixed + left/right 插槽 + back emit', () => {
    const { wxml, js } = compileComponent('p-nav-bar')
    expect(wxml).toContain('<view')
    expect(wxml).toContain('class="p-nav-bar"')
    expect(wxml).toContain('{{ title }}')
    expect(wxml).toContain('wx:if="{{back}}"')
    expect(wxml).toContain('bind:tap="onBackTap"')
    expect(wxml).toContain('<slot')
    expect(wxml).toContain('name="left"')
    expect(wxml).toContain('name="right"')
    expect(js).toContain('back: { type: Boolean, value: false }')
    expect(js).toContain("this.triggerEvent('back')")
  })
})

describe('p-skeleton（骨架屏）', () => {
  it('MP 产物：visible 门控 + lines 数组 v-for + shimmer keyframes', () => {
    const { wxml, wxss } = compileComponent('p-skeleton')
    expect(wxml).toContain('wx:if="{{visible}}"')
    expect(wxml).toContain('wx:for="{{lines}}"')
    expect(wxml).toContain("width:{{w + '%'}}")
    expect(wxml).toContain('wx:else')
    expect(wxss).toContain('@keyframes proteus-shimmer')
  })
})

describe('p-error-boundary（错误兜底）', () => {
  it('MP 产物：error 门控 + fallback 文案 + 透传插槽；onErrorCaptured 剥离（无 Vue 运行时）', () => {
    const { wxml, js } = compileComponent('p-error-boundary')
    expect(wxml).toContain('wx:if="{{error}}"')
    expect(wxml).toContain('{{ fallbackText }}')
    expect(wxml).toContain('<slot')
    expect(wxml).toContain('name="fallback"')
    expect(wxml).toContain('wx:else')
    // onErrorCaptured 剥离：产物无残留调用（Web 端保留原生语义）
    expect(js).not.toContain('onErrorCaptured')
  })
})

describe('编译器反黑盒：未映射 onXxx 钩子显式警告（B6）', () => {
  it('onErrorCaptured(() => {}) → 警告（不再静默剥离）', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const src = 'const error = ref(false)\nonErrorCaptured(() => {\n  error.value = true\n  return false\n})'
    const { js, warnings } = transformScriptToPage(src, { px2rpx: true, rpxRatio: 2 }, { isComponent: true })
    expect(warnings.join()).toContain('onErrorCaptured')
    expect(js).not.toContain('onErrorCaptured')
    spy.mockRestore()
  })

  it('方法定义 onInput(e) / 普通调用不误报', () => {
    const src = 'function onInput(e) {\n  log(e)\n}\nfunction tap() {\n  onInput(1)\n}'
    const { warnings } = transformScriptToPage(src, { px2rpx: true, rpxRatio: 2 }, { isComponent: true })
    expect(warnings.join()).not.toContain('onInput')
  })
})

describe('gen-routes 端到端（B6 组件自动解析）', () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-comp-b6-'))
  afterAll(() => {
    fs.rmSync(TMP, { recursive: true, force: true })
  })
  const root = path.join(TMP, 'demo')
  const pageDir = path.join(root, 'src/pages')
  fs.mkdirSync(pageDir, { recursive: true })

  it('页面用 p-nav-bar/p-skeleton/p-error-boundary → usingComponents /proteus/<tag>/index', () => {
    fs.writeFileSync(
      path.join(pageDir, 'index.vue'),
      `<template><p-nav-bar title="标题" back /><p-skeleton :visible="loading" /><p-error-boundary><p-text>内容</p-text></p-error-boundary></template>\n`,
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
    for (const tag of ['p-nav-bar', 'p-skeleton', 'p-error-boundary']) {
      expect(pageJson.usingComponents[tag]).toBe(`/proteus/${tag}/index`)
    }
  })
})

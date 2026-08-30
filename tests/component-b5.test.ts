// tests/component-b5.test.ts
// ★组件库落地评估 v2（B5）：弹层体系 p-mask / p-popup / p-toast / p-loading
// 可见性驱动 = B3 props 源 watch（Web Vue watch / MP observers）；转场 = CSS animation（Worklet 标注 v0.6）
import { describe, it, expect, afterAll } from 'vitest'
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

function compileComponentWxss(tag: string): string {
  return compileComponent(tag).wxss
}

describe('p-mask（遮罩）', () => {
  it('MP 产物：wx:if visible + opacity + bindtap → close 事件', () => {
    const { wxml, js } = compileComponent('p-mask')
    expect(wxml).toContain('wx:if="{{visible}}"')
    expect(wxml).toContain('style="opacity:{{opacity}}"')
    expect(wxml).toContain('bind:tap="onTap"')
    expect(js).toContain('closeOnTap: { type: Boolean, value: true }')
    expect(js).toContain("this.triggerEvent('close')")
  })
})

describe('p-popup（弹层）', () => {
  it('MP 产物：shown 门控 + position 类 + 插槽 + visible observers + leave→emit close', () => {
    const { wxml, js } = compileComponent('p-popup')
    // wxml：shown 门控 + 面板类（position + phase）
    expect(wxml).toContain('wx:if="{{shown}}"')
    expect(wxml).toContain('p-popup-panel--')
    expect(wxml).toContain('<slot')
    // js：visible prop 源 watch → observers（enter 置 shown/phase）
    expect(js).toContain('observers: {')
    expect(js).toContain('visible(n, o) {')
    expect(js).toContain("this.setData({ shown: true })")
    expect(js).toContain("this.setData({ phase: 'enter' })")
    // js：leave 动画 → setTimeout → emit close（多行箭头 RHS 修复后产物完整）
    expect(js).toContain("this.setData({ phase: 'leave' })")
    expect(js).toContain('setTimeout(() => {')
    expect(js).toContain("this.triggerEvent('close')")
    // wxss：转场 keyframes 进 WXSS（fade/slide）
    const wxss = compileComponentWxss('p-popup')
    expect(wxss).toContain('@keyframes proteus-popup-in')
    expect(wxss).toContain('@keyframes proteus-popup-fade-in')
  })
})

describe('p-toast（轻提示）', () => {
  it('MP 产物：wx:if visible + 自动关闭定时器（duration）→ emit close', () => {
    const { wxml, js } = compileComponent('p-toast')
    expect(wxml).toContain('wx:if="{{visible}}"')
    expect(wxml).toContain('{{ text }}')
    expect(js).toContain('observers: {')
    expect(js).toContain('clearTimeout(this.data.timer)')
    expect(js).toContain('setTimeout(() => {')
    expect(js).toContain("this.triggerEvent('close')")
    const wxss = compileComponentWxss('p-toast')
    expect(wxss).toContain('@keyframes proteus-toast-in')
  })
})

describe('p-loading（加载中）', () => {
  it('MP 产物：wx:if visible + spinner + 可选 text', () => {
    const { wxml, wxss } = compileComponent('p-loading')
    expect(wxml).toContain('wx:if="{{visible}}"')
    expect(wxml).toMatch(/class="[^"]*\bp-loading-spinner\b/)
    expect(wxml).toContain('wx:if="{{text}}"')
    expect(wxss).toContain('@keyframes proteus-loading-spin')
  })
})

describe('gen-routes 端到端（弹层组件自动解析）', () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-comp-b5-'))
  afterAll(() => {
    fs.rmSync(TMP, { recursive: true, force: true })
  })
  const root = path.join(TMP, 'demo')
  const pageDir = path.join(root, 'src/pages')
  fs.mkdirSync(pageDir, { recursive: true })

  it('页面用 p-popup/p-toast/p-loading/p-mask → usingComponents /proteus/<tag>/index', () => {
    fs.writeFileSync(
      path.join(pageDir, 'index.vue'),
      `<template><p-mask :visible="a" /><p-popup :visible="b" @close="b=false"><p-text>内容</p-text></p-popup><p-toast :visible="c" text="hi" /><p-loading :visible="d" text="加载" /></template>\n`,
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
    for (const tag of ['p-mask', 'p-popup', 'p-toast', 'p-loading']) {
      expect(pageJson.usingComponents[tag]).toBe(`/proteus/${tag}/index`)
    }
  })
})

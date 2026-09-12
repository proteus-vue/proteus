// tests/component-b6.test.ts
// ★组件库落地评估 v2（B6）：p-nav-bar（普通态）/ p-skeleton / p-error-boundary
// + 编译器反黑盒：未映射 onXxx 钩子显式警告（onErrorCaptured 平台限制）
import { describe, it, expect, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compileVueSfc, transformScriptToPage } from '@proteus-vue/compiler'
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
    expect(wxml).toMatch(/class="[^"]*\bp-nav-bar\b/)
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

// ★C2 颗粒度对齐（2026-09-11）：新增真实组件 MP 产物（对齐小程序同名组件）
describe('p-progress / p-label / p-page-container（C2 新增）', () => {
  it('p-progress：percent 门控 + 状态类 + 纯 CSS 进度（MP 安全）', () => {
    const { wxml, wxss } = compileComponent('p-progress')
    expect(wxml).toContain('<view')
    expect(wxml).toMatch(/class="[^"]*\bp-progress\b/)
    // 无 wx/document/window 直调（MP 安全）
    expect(wxml).not.toMatch(/\bwx\./)
    expect(wxss).toBeDefined()
  })

  it('p-label：for 关联控件（对齐小程序 <label for>）', () => {
    const { wxml } = compileComponent('p-label')
    // label → label 标签保留（小程序原生支持 for）
    expect(wxml).toMatch(/<label/)
    expect(wxml).toContain('for=')
  })

  it('p-page-container：teleport → root-portal（Skyline 顶层）+ 遮罩结构', () => {
    const { wxml } = compileComponent('p-page-container')
    expect(wxml).toContain('p-page-container')
    // teleport 编译为 root-portal（对齐 p-drawer/p-popover）
    expect(wxml).toContain('root-portal')
  })
})

describe('p-selection（局部文本选区——★批 H）', () => {
  it('MP 产物：selectionchange 事件 + 类 + 插槽 + props', () => {
    const { wxml, js } = compileComponent('p-selection')
    expect(wxml).toMatch(/class="[^"]*\bp-selection\b/)
    expect(wxml).toContain('bind:selectionchange="onSelectionChange"')
    expect(wxml).toContain('<slot')
    expect(js).toContain('disableContextMenu: {')
    expect(js).toContain("this.triggerEvent('selectionchange'")
  })
})

describe('p-keyboard-accessory（键盘上方工具栏——★批 H）', () => {
  it('MP 产物：可见门控类 + 插槽 + maxHeight 属性', () => {
    const { wxml, js } = compileComponent('p-keyboard-accessory')
    expect(wxml).toMatch(/class="[^"]*\bp-keyboard-accessory\b/)
    expect(wxml).toContain('p-keyboard-accessory--visible')
    expect(wxml).toContain('<slot')
    expect(js).toContain('maxHeight: {')
    expect(js).toContain('value: 200')
  })
})

describe('p-camera（相机——★批 I）', () => {
  it('MP 产物：<camera wx:if> + <video wx:else> 双分支 + 原生事件', () => {
    const { wxml, js } = compileComponent('p-camera')
    expect(wxml).toContain('<camera wx:if="{{isMp}}"')
    expect(wxml).toContain('device-position="{{devicePosition}}"')
    expect(wxml).toContain('bind:initdone="onInitDone"')
    expect(wxml).toContain('<video wx:else')
    expect(wxml).toContain('<slot')
    expect(js).toContain('devicePosition: {')
    expect(js).toContain('flash: {')
    expect(js).toContain("this.triggerEvent('initdone'")
  })
})

describe('p-ad（广告位——★批 J）', () => {
  it('MP 产物：<ad wx:if> + Web 占位 <view wx:else>', () => {
    const { wxml, js } = compileComponent('p-ad')
    expect(wxml).toContain('<ad wx:if="{{isMp}}"')
    expect(wxml).toContain('unit-id="{{unitId}}"')
    expect(wxml).toContain('<view wx:else')
    expect(wxml).toContain('<slot')
    expect(js).toContain('unitId: {')
  })
})

describe('p-webview（内嵌网页——★批 J）', () => {
  it('MP 产物：<web-view wx:if> + Web 容器 <view wx:else>（无 iframe 泄漏）', () => {
    const { wxml } = compileComponent('p-webview')
    expect(wxml).toContain('<web-view wx:if="{{isMp && srcIsUrl}}"')
    expect(wxml).toContain('src="{{src}}"')
    expect(wxml).toContain('<view wx:else')
    expect(wxml).not.toContain('<iframe') // 无 iframe 元素（注释提及不算）
  })

  it('★平台限制（真机实测 2026-09-12）：src 非 https URL 时 MP 端走诚实占位（<web-view> 不支持包内本地 HTML）', () => {
    const { wxml, js } = compileComponent('p-webview')
    // srcIsUrl 门控：MP 原生 web-view 仅在绝对 http(s) 地址时渲染
    expect(js).toMatch(/srcIsUrl/)
    expect(js).toContain('/^https?:\\/\\//i')
    // MP 非 URL 分支：诚实占位（含提示文案变量，不留白）
    expect(wxml).toContain('mpLocalHint')
    expect(wxml).toContain('wx:elif="{{isMp}}"')
  })
})

describe('p-map（地图——★批 J）', () => {
  it('MP 产物：<map wx:if> + 标记绑定 + Web 宿主槽位', () => {
    const { wxml, js } = compileComponent('p-map')
    expect(wxml).toContain('<map wx:if="{{isMp}}"')
    expect(wxml).toContain('latitude="{{latitude}}"')
    expect(wxml).toContain('markers="{{markers}}"')
    expect(wxml).toContain('bind:markertap="onMarkerTap"')
    expect(wxml).toContain('<slot')
    expect(js).toContain('latitude: {')
  })
})

// ★★真机 bug 回归锁（2026-09-12）：平台条件组件（camera/map/webview/ad）的 isMp 必须进 data——
//   直调 isMpRuntime() 会被编译器归 runtimeInit 实例属性（this.isMp），模板只能读 data →
//   wx:if="{{isMp}}" 恒 false → MP 端错走 Web 分支（真机渲染成 video/iframe 容器/空白，用户实测抓出）。
//   修法 = computed(() => isMpRuntime())（产物 ready() 里 setData 快照）。本测试锁「isMp 进 data」，
//   防止回归（原测试只断言 wxml 标签，漏了 js 侧 → bug 溜过）。
describe('★平台条件组件回归锁：isMp 必须进 data（模板可读）', () => {
  for (const tag of ['p-camera', 'p-map', 'p-webview', 'p-ad']) {
    it(`${tag}：产物将 isMp 快照进 data（非裸实例属性）`, () => {
      const { js, wxml } = compileComponent(tag)
      expect(wxml, `${tag} 应含 isMp 条件`).toContain('isMp')
      // 合法形态二选一（在整份 js 中，不切 lifecycle——setData 内 } 会截断）：
      //   ① this.setData({ isMp: isMpRuntime(), ... })  ② this.data.isMp = isMpRuntime() 且 setData({...isMp...})
      const viaSetData = /setData\(\{[^)]*isMp:\s*(isMpRuntime\(\)|this\.data\.isMp)/.test(js)
      const viaDataThenSet = /this\.data\.isMp = isMpRuntime\(\)/.test(js) && /setData\(\{[^}]*isMp/.test(js)
      expect(viaSetData || viaDataThenSet, `${tag} 未将 isMp 快照进 data`).toBe(true)
      // 反例：裸实例属性 this.isMp = isMpRuntime()（无 data 前缀）——本 bug 的形态
      expect(js, `${tag} 出现裸 this.isMp 赋值（应为 data/setData）`).not.toMatch(/this\.isMp\s*=\s*isMpRuntime/)
    })
  }
})

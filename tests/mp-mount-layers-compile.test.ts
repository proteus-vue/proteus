// tests/mp-mount-layers-compile.test.ts —— ★★★GP2-a/b/c/d：三层挂载的编译支持与硬约束（2026-10-03）
//
// 【这一批补的是什么】《全局挂载点与App根组件方案》的三层模型在编译器里**完全不存在**——
//   探针实测：`<app-root>` / `<global-layer>` 等被**原样透传**为无效标签 + **零警告**（静默），
//   且 App 壳还被套了页面滚动容器（它不是页面）。
//
// 【本批交出】
//   · **GP2-a 编译支持**：层标签**解壳**（逻辑容器不产元素——与 Transition/KeepAlive 同族）
//     + **声明收集**（可枚举）+ App 壳免滚动壳 + **保持文档序**（层间顺序由编译期拼接表达，
//     内核 z-order 真源 = 树序 ⇒ **零新指令**，见规格文档 §2.1）；
//   · **GP2-b/c/d 硬约束**：C1（只能在 App.vue 声明）· C2（Global 节点 ≤32）· C3（Global 禁路由动作），
//     均在 `compileVueSfc` 里 raise 成 **error**（与 LY1/SC2 同款纪律：开放这些会毁掉收敛体系）。
//
// 【判据】① 解壳与文档序 ② App 壳免滚动壳 ③ 可枚举性（mountLayers 字段）④ C1/C2/C3 正反例。

import { describe, it, expect } from 'vitest'
import { transformTemplateToWxml, validateMountLayerUsage } from '@proteus-vue/compiler'
import { GLOBAL_LAYER_NODE_LIMIT } from '@proteus-vue/contracts'

const run = (tpl: string, filename = 'App.vue'): ReturnType<typeof transformTemplateToWxml> =>
  transformTemplateToWxml(tpl, { px2rpx: false, rpxRatio: 2, filename })

const APP_TPL = `<app-root>
  <global-layer><view class="status-bar">status</view></global-layer>
  <page-layer><view class="shell">shell</view></page-layer>
  <overlay-layer><view class="toast">toast</view></overlay-layer>
</app-root>`

describe('★GP2-a · 三层挂载编译支持（解壳 / 文档序 / 免滚动壳 / 可枚举）', () => {
  it('★层标签**解壳**（不产无效标签）且**保持文档序**（层间顺序 = 编译期拼接，零新指令）', () => {
    const r = run(APP_TPL)
    const wxml = String((r as unknown as { wxml: string }).wxml)
    // 三个层标签都不该出现在产物里（无效标签）
    for (const tag of ['app-root', 'global-layer', 'page-layer', 'overlay-layer']) {
      expect(wxml, `${tag} 必须解壳（不产无效标签）`).not.toContain(`<${tag}`)
    }
    // ★文档序保持：global 的内容在最前、overlay 在最后（层间顺序由**树序**表达）
    const iStatus = wxml.indexOf('status')
    const iShell = wxml.indexOf('shell')
    const iToast = wxml.indexOf('toast')
    expect(iStatus, 'global 层内容在最前').toBeGreaterThanOrEqual(0)
    expect(iStatus).toBeLessThan(iShell)
    expect(iShell).toBeLessThan(iToast)
  })

  it('★App 壳**不包页面滚动容器**（它不是页面——套 scroll-view 会破坏三层语义）', () => {
    const r = run(APP_TPL)
    expect(String((r as unknown as { wxml: string }).wxml)).not.toContain('proteus-page-scroll')
    expect((r as unknown as { pageScrollWrapped?: boolean }).pageScrollWrapped, '不应标记为已包滚动壳').toBeFalsy()
  })

  it('★反向：普通页面**仍然**自动包滚动容器（App 壳判定不越界）', () => {
    const r = run(`<view class="page"><text>hi</text></view>`, 'pages/index.vue')
    const wxml = String((r as unknown as { wxml: string }).wxml)
    expect(wxml, '普通页面照常包滚动容器').toContain('proteus-page-scroll')
  })

  it('★可枚举性（C1/C2/C3 的实现基础）：mountLayers 登记声明与计数', () => {
    const r = run(APP_TPL) as unknown as {
      mountLayers?: Record<string, { declared: boolean; nodeCount: number; hasNavigation: boolean }>
      isAppShell?: boolean
    }
    expect(r.isAppShell).toBe(true)
    expect(r.mountLayers?.global).toMatchObject({ declared: true, nodeCount: 1, hasNavigation: false })
    expect(r.mountLayers?.page?.declared).toBe(true)
    expect(r.mountLayers?.overlay?.declared).toBe(true)
  })

  it('★反向：普通页面不产 mountLayers 声明（零开销）', () => {
    const r = run(`<view><text>x</text></view>`, 'pages/index.vue') as unknown as { mountLayers?: Record<string, unknown> }
    expect(Object.keys(r.mountLayers ?? {})).toHaveLength(0)
  })
})

describe('★GP2-b · C1：挂载层只能在 App.vue 声明', () => {
  it('★在普通页面声明 ⇒ 违规（C1）', () => {
    const v = validateMountLayerUsage(run(APP_TPL, 'pages/index.vue') as never, 'pages/index.vue')
    expect(v.map((x) => x.code)).toContain('C1')
    expect(v[0]!.hint, '修法要点明"禁用运行时动态挂载"').toContain('insertGlobal')
  })

  it('★在 App.vue 声明 ⇒ 合规（同一份模板，仅文件名不同）', () => {
    expect(validateMountLayerUsage(run(APP_TPL, 'App.vue') as never, 'App.vue')).toEqual([])
    // 路径前缀与大小写不敏感（契约同源）
    expect(validateMountLayerUsage(run(APP_TPL, 'src/app.vue') as never, 'src/app.vue')).toEqual([])
  })
})

describe('★GP2-c · C2：Global 层节点上限', () => {
  it(`★超过 ${GLOBAL_LAYER_NODE_LIMIT} 个节点 ⇒ 违规（C2），并提示 MP 的 N 倍驻留`, () => {
    const kids = Array.from({ length: GLOBAL_LAYER_NODE_LIMIT + 1 }, (_, i) => `<view class="g${i}" />`).join('')
    const tpl = `<app-root><global-layer>${kids}</global-layer></app-root>`
    const v = validateMountLayerUsage(run(tpl) as never, 'App.vue')
    expect(v.map((x) => x.code)).toContain('C2')
    expect(v[0]!.message).toContain(String(GLOBAL_LAYER_NODE_LIMIT))
    expect(v[0]!.hint, '提示必须含 MP 的 N 倍诚实口径').toContain('页面栈深度')
  })

  it('★恰好等于上限 ⇒ 合规（边界不越界）', () => {
    const kids = Array.from({ length: GLOBAL_LAYER_NODE_LIMIT }, (_, i) => `<view class="g${i}" />`).join('')
    const tpl = `<app-root><global-layer>${kids}</global-layer></app-root>`
    expect(validateMountLayerUsage(run(tpl) as never, 'App.vue')).toEqual([])
  })
})

describe('★GP2-d · C3：Global 层不得含页面级业务（路由动作）', () => {
  it('★Global 层内出现 navigator / router-link / a[href] ⇒ 违规（C3）', () => {
    for (const nav of ['<navigator url="/x">go</navigator>', '<router-link to="/x">go</router-link>', '<a href="/x">go</a>']) {
      const tpl = `<app-root><global-layer>${nav}</global-layer></app-root>`
      const v = validateMountLayerUsage(run(tpl) as never, 'App.vue')
      expect(v.map((x) => x.code), `${nav} 应触发 C3`).toContain('C3')
    }
  })

  it('★反向：Overlay/Page 层内的路由动作**不触发** C3（只在 Global 层禁止）', () => {
    const tpl = `<app-root><overlay-layer><navigator url="/x">go</navigator></overlay-layer></app-root>`
    expect(validateMountLayerUsage(run(tpl) as never, 'App.vue')).toEqual([])
  })

  it('★反向：Global 层内的**事件回调**不触发（C3 只禁路由动作，不禁交互）', () => {
    const tpl = `<app-root><global-layer><view @tap="onPlay">play</view></global-layer></app-root>`
    expect(validateMountLayerUsage(run(tpl) as never, 'App.vue')).toEqual([])
  })
})

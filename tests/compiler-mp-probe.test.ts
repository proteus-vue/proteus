// tests/compiler-mp-probe.test.ts
// ★2026-09-07 mp-conformance 探针矩阵（真机契约集中固化）
// 历轮真机 bug 修复的「产物形态契约」此前分散/缺失——本矩阵集中锁死关键 wxml/wxss/js 形态，
// 每条对应真机验证来源（编译器重构/回归即红——「修一次多端一次过」的产物级收口）：
//   P1 p-modal 面板底部定位（布局专项④）：静态类字面量 + scoped 匹配 + 无动态 panelClass
//   P2 p-modal 遮罩半透明静态化（布局专项①）：wxss rgba 静态，不依赖动态 style
//   P3 v-model 事件名单段（G12 候选 B）：页面 bind:update-{arg} + 组件 triggerEvent('update-{arg}')——零双冒号
//   P4 p-input 受控契约：:value + @input → value="{{}}" bindinput（无 modelValue/update 契约）
//   P5 p-slider MP 映射：模板原生 <slider> bindchange（无 <input type="range">）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'

const ROOT = path.resolve('.')
const opts = { px2rpx: true, rpxRatio: 2 }

function compileComponent(rel: string) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  return compileVueSfc(src, { file: rel, isComponent: true, ...opts })
}

describe('★mp-conformance 探针矩阵 P1/P2：p-modal 布局终案产物契约', () => {
  const r = compileComponent('src/components/p-modal/index.vue')
  const wxml = r.wxml ?? ''
  const wxss = r.wxss ?? ''

  it('P1a：panel 含静态 --sheet 类字面量（scoped hash 命中——非动态 panelClass）', () => {
    // 模板静态字面量 → 编译产物带 scoped 后缀且与 wxss 规则同名
    expect(wxml).toMatch(/class="[^"]*p-modal-panel--sheet-data-v-[\w]+/)
    // 不再依赖 JS computed panelClass 动态类（真机失配根因）
    expect(wxml).not.toContain('{{panelClass')
  })

  it('P1b：wxss 含同 scoped 后缀的 sheet 底部定位规则（left/right/bottom 0）', () => {
    const m = wxss.match(/\.p-modal-panel--sheet-data-v-[\w]+\s*\{[\s\S]*?\}/)
    expect(m).not.toBeNull()
    expect(m![0]).toContain('bottom: 0')
    expect(m![0]).toContain('left: 0')
  })

  it('P2：mask 半透明静态化（wxss rgba 静态——不依赖动态 style；真机全黑修复）', () => {
    expect(wxss).toMatch(/\.p-modal-mask-data-v-[\w]+\s*\{[\s\S]*?rgba\(0,\s*0,\s*0,\s*0\.5\)/)
    // 模板不再 style 绑定 opacity（此前动态 style 在 MP 不可靠 → 全黑）
    expect(wxml).not.toMatch(/p-modal-mask[^>]*style="/)
  })
})

describe('★mp-conformance 探针矩阵 P3：v-model 事件名单段（G12 候选 B）', () => {
  it('P3a：页面 v-model 产物 = 单段 bind:update-{arg}（零双冒号 bind:update:）', () => {
    const src = '<script setup lang="ts">import { ref } from "vue"\nconst show = ref(false)\nconst on = ref(false)</script>\n'
      + '<template><p-modal v-model:visible="show">x</p-modal><p-switch v-model="on"/></template>'
    const r = compileVueSfc(src, { filename: 'pages/probe3.vue', ...opts })
    expect(r.wxml).toContain('bind:update-visible="proteusUpdateVisibleModel"')
    expect(r.wxml).toContain('bind:update-modelValue')
    expect(r.wxml).not.toContain('bind:update:')
  })

  it('P3b：组件自身 emit → triggerEvent 单段（update-visible / update-modelValue，零 update: 冒号名）', () => {
    const modal = compileComponent('src/components/p-modal/index.vue')
    expect(modal.js).toContain("this.triggerEvent('update-visible', false)")
    expect(modal.js).not.toContain("triggerEvent('update:visible'")
    const sw = compileComponent('src/components/p-switch/index.vue')
    expect(sw.js).not.toContain("triggerEvent('update:")
  })
})

describe('★mp-conformance 探针矩阵 P4：p-input 受控契约（非 v-model）', () => {
  const r = compileComponent('src/components/p-input/index.vue')
  it('P4：原生 input value="{{value}}" + bindinput（emit input 载荷 { value }，无 update-modelValue 契约面）', () => {
    expect(r.wxml).toContain('value="{{value}}"')
    expect(r.wxml).toContain('bindinput="onInput"')
    expect(r.js).toContain("this.triggerEvent('input', { value:")
    expect(r.js).not.toContain('update-modelValue')
  })
})

describe('★mp-conformance 探针矩阵 P5：p-slider MP 映射（原生 slider 标签）', () => {
  const r = compileComponent('src/components/p-slider/index.vue')
  it('P5：模板原生 <slider bindchange> + update-modelValue 单段回传；无 <input type="range">', () => {
    expect(r.wxml).toMatch(/<slider[\s\S]*bindchange="onSliderChange"/)
    expect(r.wxml).not.toContain('type="range"')
    expect(r.js).toContain("this.triggerEvent('update-modelValue'")
  })
})

describe('★mp-conformance 探针矩阵 P6：复测页整体产物（vmodel-mp-test 四形态）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'examples/pages/vmodel-mp-test.vue'), 'utf8')
  const r = compileVueSfc(src, { file: 'pages/vmodel-mp-test.vue', isComponent: false, ...opts })
  it('P6：modal/switch/slider 单段事件 + p-input 受控 bindinput 同页共存', () => {
    expect(r.wxml).toContain('bind:update-visible=')
    expect(r.wxml).toContain('bind:update-modelValue=')
    expect(r.wxml).toContain('<p-input value="{{txt}}"')
    expect(r.wxml).toContain('bindinput="onTxtInput"')
    expect(r.wxml).not.toContain('bind:update:')
  })
})

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
    // ★2026-09-07 多组件 v-model 撞名修复：handler 名以 model 标识（show → proteusUpdateShowModel；on → proteusUpdateOnModel）
    expect(r.wxml).toContain('bind:update-visible="proteusUpdateShowModel"')
    expect(r.wxml).toContain('bind:update-modelValue="proteusUpdateOnModel"')
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

describe('★mp-conformance 探针矩阵 P7：p-drawer Skyline 遮罩命中契约（真机 2026-09-07）', () => {
  // 真机探针实证：skyline 下遮罩元素自身不参与命中测试（事件落根容器）→
  // 修法：事件挂可靠层（根容器收非面板区点击）+ 面板 catchtap 吞冒泡 + 遮罩纯视觉 + 显式四边定位
  const r = compileComponent('src/components/p-drawer/index.vue')
  const wxml = r.wxml ?? ''
  const wxss = r.wxss ?? ''
  const js = r.js ?? ''

  it('P7a：关闭事件挂根容器 bindtap（onMaskAreaTap），遮罩无任何事件绑定（纯视觉）', () => {
    expect(wxml).toMatch(/<view bindtap="onMaskAreaTap" class="p-drawer-root-data-v-["\w]+ /)
    const maskNode = wxml.match(/<view wx:if="\{\{modelValue && overlay\}\}"[^>]*class="p-drawer-mask[^"]*"[^>]*\/?>/) ?? ''
    expect(maskNode).not.toContain('bindtap')
    expect(maskNode).not.toContain('catchtap')
  })

  it('P7b：抽屉面板 catchtap 吞冒泡（@click.stop → noop），面板内点击不触发根关闭', () => {
    expect(wxml).toContain('catchtap="noop"')
    expect(js).toMatch(/noop\(\)/)
  })

  it('P7c：onMaskAreaTap 带 overlay 守卫并回传 update-modelValue false（无遮罩不响应外部点击）', () => {
    expect(js).toContain('if (!this.data.overlay || !this.data.modelValue) return')
    expect(js).toContain("this.triggerEvent('update-modelValue', false)")
  })

  it('P7d：mask 显式四边定位（skyline 不认 inset 简写 → 尺寸塌 0 透明；含 rgba 半透明背景）', () => {
    const m = wxss.match(/\.p-drawer-mask-data-v-[\w]+\s*\{[\s\S]*?\}/)
    expect(m).not.toBeNull()
    // 注释含「inset 简写」字样 → 断言属性形态（inset:）而非注释词
    expect(m![0]).not.toContain('inset:')
    expect(m![0]).toContain('top: 0')
    expect(m![0]).toContain('left: 0')
    expect(m![0]).toContain('right: 0')
    expect(m![0]).toContain('bottom: 0')
    expect(m![0]).toContain('rgba(0, 0, 0, 0.45)')
  })

  it('P7e：side 静态分支（p-drawer-left/--right 字面量 scoped）——right 侧不再落静态位置（动态 side 类 Skyline 无 scoped 匹配）', () => {
    const wxml = compileComponent('src/components/p-drawer/index.vue').wxml ?? ''
    expect(wxml).toMatch(/p-drawer-data-v-[\w]+ p-drawer-left-data-v-[\w]+/)
    expect(wxml).toMatch(/p-drawer-data-v-[\w]+ p-drawer-right-data-v-[\w]+/)
    expect(wxml).not.toContain('{{(side)')
  })
})

describe('★mp-conformance 探针矩阵 P8：弹层族关闭事件挂可靠命中层（p-drawer P7 同款批量）', () => {
  // 2026-09-07 批量：p-action-sheet / p-modal / p-popup / p-popover 关闭事件原绑遮罩元素
  // （skyline 下纯背景子节点不参与命中）→ 改挂全屏容器/layer + 面板 catch 吞冒泡 + 遮罩纯视觉
  it('P8a：p-action-sheet——layer 收 onCancel（wx:if modelValue），mask 无事件，panel catchtap=noop', () => {
    const r = compileComponent('src/components/p-action-sheet/index.vue')
    const wxml = r.wxml ?? ''
    expect(wxml).toMatch(/<view wx:if="\{\{modelValue\}\}" bindtap="onCancel" class="p-as-layer-data-v-[\w]+/)
    expect(wxml).toMatch(/<view class="p-as-mask-data-v-[\w]+[^"]*" \/>/)
    expect(wxml).toMatch(/catchtap="noop"[^>]*class="p-as-panel-data-v-/)
    expect(wxml).not.toMatch(/p-as-mask[^>]*bindtap/)
    expect(wxml).not.toMatch(/p-as-mask[^>]*catchtap/)
  })

  it('P8b：p-modal——关闭事件挂容器（onMaskTap），mask 无事件，panel catchtap=noop', () => {
    const r = compileComponent('src/components/p-modal/index.vue')
    const wxml = r.wxml ?? ''
    expect(wxml).toMatch(/<view wx:if="\{\{shown\}\}" bindtap="onMaskTap" class="p-modal-data-v-[\w]+/)
    expect(wxml).not.toMatch(/p-modal-mask[^>]*bindtap/)
    expect(wxml).not.toMatch(/p-modal-mask[^>]*catchtap/)
    expect(wxml).toMatch(/catchtap="noop"[^>]*class="p-modal-panel-data-v-/)
  })

  it('P8c：p-popup——关闭事件挂容器（onLayerTap），mask 无事件，面板 catch:tap=noop；位置类静态字面量（skyline 动态类/动态 style 不可靠 → 左上角，修复实证）', () => {
    const r = compileComponent('src/components/p-popup/index.vue')
    const wxml = r.wxml ?? ''
    const wxss = r.wxss ?? ''
    const js = r.js ?? ''
    expect(wxml).toMatch(/<view wx:if="\{\{shown\}\}" bind:tap="onLayerTap" class="p-popup-data-v-[\w]+/)
    expect(wxml).not.toMatch(/p-popup-mask[^>]*bindtap|p-popup-mask[^>]*bind:tap/)
    expect(wxml).toMatch(/catch:tap="noop"/)
    // 位置类静态字面量（三形态分支）——scoped 必命中；无动态拼接类/panelStyle 动态 style
    expect(wxml).toMatch(/class="p-popup-panel-data-v-[\w]+ p-popup-panel--bottom-data-v-[\w]+/)
    expect(wxml).toMatch(/class="p-popup-panel-data-v-[\w]+ p-popup-panel--top-data-v-[\w]+/)
    expect(wxml).toMatch(/class="p-popup-panel-data-v-[\w]+ p-popup-panel--center-data-v-[\w]+/)
    expect(wxml).not.toContain('style="{{panelStyle}}"')
    expect(wxml).not.toMatch(/p-popup-panel---data-v-[\w]+' \+ position/)
    expect(wxss).toMatch(/\.p-popup-panel--bottom-data-v-[\w]+\s*\{[\s\S]*?bottom: 0/)
    // ★MP 动画恢复：phase 类走 computed 裸类名（模板无类字面量 → 不插 scope 后缀）+ <style global> 规则
    expect(wxml).toContain('panelPhaseCls')
    expect(js).toContain('p-popup-panel--fade-')
    expect(wxss).toMatch(/\.p-popup-panel--enter \{\s*animation: proteus-popup-in/)
    expect(wxss).toMatch(/\.p-popup-panel--fade-enter \{\s*animation: proteus-popup-fade-in/)
  })

  it('P8d：p-popover——全屏 layer 收 close（无残留 mask 事件），显式四边定位，placement 静态四分支，常驻 overlay+visibility（skyline 终案：弃 wx:if/portal——wx:if 子树不渲染、portal 脱离破锚定）', () => {
    const r = compileComponent('src/components/p-popover/index.vue')
    const wxml = r.wxml ?? ''
    const wxss = r.wxss ?? ''
    expect(wxml).toMatch(/<view bindtap="close" class="p-popover-layer-data-v-[\w]+/)
    expect(wxml).not.toContain('p-popover-mask')
    const m = wxss.match(/\.p-popover-layer-data-v-[\w]+\s*\{[\s\S]*?\}/)
    expect(m).not.toBeNull()
    expect(m![0]).not.toContain('inset:')
    expect(m![0]).toContain('bottom: 0')
    // placement 静态分支（动态 placement 类 Skyline 无 scoped 匹配 → 面板左上角）
    for (const p of ['bottom', 'top', 'left', 'right']) {
      expect(wxml).toMatch(new RegExp(`p-popover-panel-data-v-[\\w]+ p-popover-${p}-data-v-[\\w]+`))
    }
    expect(wxml).not.toContain("+ placement")
    // ★★2026-09-08（正轨）：root-portal（官方同层节点）逃逸 Skyline 层叠——不再「弃 root-portal」；放置于 overlay 外层
    //   ★V4 实证：组件 json 含 componentFramework: glass-easel 则 root-portal 常驻内容渲染；wx:if 子树不可靠 → overlay 常驻+visibility
    expect(wxml).toMatch(/<root-portal class="\{\{rootClass\}\}">/)
    expect(wxml).not.toContain('wx:if="{{modelValue}}"')
    expect(wxml).toMatch(/class="p-popover-overlay-data-v-[\w]+ \{\{/)
    expect(wxss).toMatch(/\.p-popover-overlay-data-v-[\w]+\s*\{[\s\S]*?visibility: hidden/)
    expect(wxss).toMatch(/\.p-popover-overlay--on-data-v-[\w]+\s*\{[\s\S]*?visibility: visible/)
  })
})

describe('★mp-conformance 探针矩阵 P8e：p-popover 方案 A spike 契约（measureRect + fixed 像素坐标 + 回退）', () => {
  // 方案 A（Skyline 层叠解药）：打开时 adapter.measureRect('#'+uid) 测 trigger → computePopoverPosition 算
  //   fixed 视口坐标 → panelStyle 字符串（position:fixed;left;top）→ 浮层叠顶层；measureRect 失败 → panelStyle=''
  //   → 回退静态 .p-popover-{placement} 绝对锚定（终案）。契约锁：产物含 measureRect + setData panelStyle + uid。
  const r = compileComponent('src/components/p-popover/index.vue')
  const wxml = r.wxml ?? ''
  const js = r.js ?? ''

  it('P8e1：trigger 带静态 data-role（非 scoped hash）供 measureRect 页面级 selector 查询命中', () => {
    // 不加 :id（MP 编译器丢弃模块 let/实例 uid const/ref → popoverSeq ReferenceError 真机崩）——data-role 常驻可查
    expect(wxml).toMatch(/data-role="proteus-popover-trigger"[^>]*class="p-popover-trigger-data-v-[\w]+/)
    expect(wxml).not.toContain("id=\"{{triggerId}}\"")
  })

  it('P8e2：面板 style 绑定 panelStyle（方案 A fixed+坐标串；回退空串→静态锚定）', () => {
    // 四分支均绑定 style="{{panelStyle}}"（wxml 属性序：style 在前 class 在后）
    expect((wxml.match(/style="\{\{panelStyle\}\}"/g) ?? []).length).toBe(4)
    // 保留静态 placement 类（回退锚定；未改成动态 class——编译器插半截 scope 后缀坑）
    for (const p of ['bottom', 'top', 'left', 'right']) {
      expect(wxml).toMatch(new RegExp(`p-popover-panel-data-v-[\\w]+ p-popover-${p}-data-v-[\\w]+`))
    }
    expect(wxml).not.toContain("+ placement")
  })

  it('P8e3：js 含 measureRect 测量 + setData panelStyle（fixed+坐标串）', () => {
    // 编译产物属性经 esbuild 可能去掉空格（setData({ panelStyle: 'position:fixed;left:' }}）——用宽松子串
    expect(js).toContain('.measureRect(')
    expect(js).toContain("setData({ panelStyle: 'position:fixed;left:'")
    // 回退（measureRect 失败/缺失 → panelStyle 空串 → 静态锚定）
    expect(js).toContain("setData({ panelStyle: '' })")
  })

  it('P8e4：TRIGGER_SELECTOR 作为 data 字段（非模块 let——MP 编译器丢弃模块 let 致 ReferenceError），measureRect 引用它', () => {
    // data 字段声明（[data-role="proteus-popover-trigger"]——宽松子串，引号转义形态不定）
    expect(js).toContain('TRIGGER_SELECTOR:')
    expect(js).toContain('data-role')
    expect(js).toContain('proteus-popover-trigger')
    // ★2026-09-08：measureRect scope 用组件实例 this（MP 方法内 this=组件实例；adapter 经 .in(this) 下探组件内 trigger）
    //   ★用户决策 1（b）：getCurrentInstance 归 unsupported 反黑盒；组件内「拿实例」走框架语义 API（此处为 MP 原生 this）
    //   ★不再用模板 ref popoverRoot（MP 模板 ref 永不绑定→this.data.popoverRoot 恒 undefined→.in(undefined) 页面级查询失效）
    expect(js).toMatch(/measureRect\(TRIGGER_SELECTOR,\s*this/)
  })
})

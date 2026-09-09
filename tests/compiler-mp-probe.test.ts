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
    // ★★2026-09-08（teleport 对齐）：组件写标准 <teleport>，编译器转 <root-portal>（官方同层节点逃逸层叠）——
    //   组件源码不再裸写平台标签（teleport 对齐有真实消费者）；teleport 内容（overlay+panel）包进 root-portal
    expect(wxml).toMatch(/<root-portal>/)
    expect(wxml.replace(/<!--[\s\S]*?-->/g, '')).not.toContain('<teleport')
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

  it('P8e1：trigger 带 id + :class 绑定查询类（无 scope hash——selectorQuery 可命中；Skyline 不认属性选择器）', () => {
    // ★2026-09-08 二轮修复：旧 data-role 属性选择器 Skyline 不认 + 静态类被 scoped hash 查不到 → 左上角。
    //   现契约：静态 id（.in(scope) 组件内唯一）+ :class 绑定运行时查询类（classInterp 不加 suffix → DOM 类无 hash）
    expect(wxml).toMatch(/id="proteus-popover-trigger"/)
    expect(wxml).toMatch(/\{\{triggerQueryCls\}\}/)
    expect(wxml).not.toContain('data-role="proteus-popover-trigger"')
    expect(wxml).not.toContain('id="{{triggerId}}"')
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

  it('P8e4：selector 内联字面量（顶层 const 裸引用在方法体不被改写 → ReferenceError 缺口绕过；登记 compiler 待修）', () => {
    // ★2026-09-08 真机实证：顶层 const TRIGGER_SELECTOR 内联进 data，但方法体裸引用不被改写 →
    //   ReferenceError 被 catch 吞 → panelStyle 空 → 左上角（诊断 ERR:TRIGGER_SELECTOR is not defined）。
    //   现契约：selector 直接内联字面量进 measureRect 调用（绕过缺口；编译器缺口登记待修）
    expect(js).toContain("measureRect('.proteus-popover-trigger-query', this)")
    expect(js).toContain('proteus-popover-trigger-query')
  })
})

describe('★mp-conformance 探针矩阵 P9：具名插槽 multipleSlots 注入（#500 双渲染器一致根因）', () => {
  // 微信自定义组件默认单插槽——不注入 options.multipleSlots 则 <slot name> 与 slot="name" 不按名路由
  // （p-zone 选槽错乱 / p-sidebar nav 泄漏进默认插槽真机根因）；Page 不注入（无插槽语义）
  it('P9a：Component 产物注入 options.multipleSlots + <slot name> 按名输出', () => {
    const src = '<template><view><slot name="header"/><slot/></view></template>'
    const r = compileVueSfc('<script setup lang="ts"></script>\n' + src, { filename: 'probe9.vue', isComponent: true, ...opts })
    expect(r.js).toContain('options: { multipleSlots: true },')
    expect(r.wxml).toContain('<slot name="header"')
    expect(r.wxml).toContain('<slot')
  })
  it('P9b：Page 产物不注入 multipleSlots', () => {
    const r = compileVueSfc('<template><view>x</view></template>', { filename: 'probe9p.vue', isComponent: false, ...opts })
    expect(r.js).not.toContain('multipleSlots')
  })
})

describe('★mp-conformance 探针矩阵 P10：v-show 复合表达式括号（#501 WebView 亦错的基础语义）', () => {
  // hidden="{{!expr}}" 无括号 → !mode === 'x' 按 (!mode)==='x' 解析 → p-sidebar nav 恒可见真机根因；
  // 契约：复合表达式包 !(…)；裸标识符保持无括号（旧产物形态兼容）
  it('P10a：复合表达式 hidden="{{!(…)}}"', () => {
    const r = compileVueSfc('<script setup lang="ts">const mode = "a"</script>\n<template><view v-show="mode === \'side-rail\' || mode === \'collapsed-open\'">x</view></template>', { filename: 'probe10.vue', ...opts })
    expect(r.wxml).toContain("hidden=\"{{!(mode === 'side-rail' || mode === 'collapsed-open')}}\"")
  })
  it('P10b：裸标识符 hidden="{{!show}}"（无括号形态锁定）', () => {
    const r = compileVueSfc('<script setup lang="ts">const show = true</script>\n<template><view v-show="show">x</view></template>', { filename: 'probe10b.vue', ...opts })
    expect(r.wxml).toContain('hidden="{{!show}}"')
  })
})

describe('★mp-conformance 探针矩阵 P11：?? / ?. ES5 tripwire（#504 语言转译交还 babel）', () => {
  // 真机上传期 SyntaxError（?? Unexpected token）——Node --check 门禁永远抓不到；契约：产物零 ??/?. 残留
  it('P11：方法体 ?? / ?. 产物零残留（babel ES5 转写——顶层 const 走静态求值路径不经 babel，探针锁方法体通道）', () => {
    const r = compileVueSfc('<script setup lang="ts">const a: { b?: string | null } = {}\nfunction f() { return a?.b ?? "x" }</script>\n<template><view>{{ f() }}</view></template>', { filename: 'probe11.vue', ...opts })
    expect(r.js).not.toMatch(/\?\?|\?\./)
    expect(r.js).toMatch(/=== void 0 \? .* : "x"/)
  })
})

describe('★mp-conformance 探针矩阵 P12：非有限数 setData 序列化反黑盒（#502 p-modal 样式全丢根因）', () => {
  // 微信 setData 数据须可 JSON 序列化——Infinity/NaN 整次 setData 被放弃/字段静默变 null（同次 maskStyle/panelClass 全丢）
  it('P12：含非有限数的 const 编译期显式警告（引导 MAX_SAFE_INTEGER）', () => {
    const r = compileVueSfc('<script setup lang="ts">const LIMIT = Infinity</script>\n<template><view /></template>', { filename: 'probe12.vue', ...opts })
    expect(r.warnings.some((w: string) => /非有限数|MAX_SAFE_INTEGER/.test(w))).toBe(true)
  })
  it('P12b：MAX_SAFE_INTEGER 字面量不警告（推荐形态畅通）', () => {
    const r = compileVueSfc('<script setup lang="ts">const LIMIT = Number.MAX_SAFE_INTEGER</script>\n<template><view /></template>', { filename: 'probe12b.vue', ...opts })
    expect(r.warnings.some((w: string) => /非有限数/.test(w))).toBe(false)
  })
})

describe('★mp-conformance 探针矩阵 P13：:style 对象派生自动序列化（#500 对象绑定双渲染器静默失效根因）', () => {
  // style 属性仅收字符串（双渲染器一致）——对象绑定 = 布局全死；契约：computed 派生 expr 自动包 __proteusStyleString
  it('P13：:style 绑定同名 computed → js 注入 __proteusStyleString + wxml style="{{}}"', () => {
    const r = compileVueSfc(
      '<script setup lang="ts">import { computed } from "vue"\nconst boxStyle = computed(() => ({ display: "flex", gap: "8rpx" }))</script>\n'
      + '<template><view :style="boxStyle">x</view></template>',
      { filename: 'probe13.vue', ...opts },
    )
    expect(r.js).toMatch(/boxStyle: __proteusStyleString\(/)
    expect(r.wxml).toContain('style="{{boxStyle}}"')
    expect(r.js).toContain('function __proteusStyleString(')
  })
})

describe('★mp-conformance 探针矩阵 P14：p-safe env/max 诚实边界（#501 Skyline 无 max 长度函数）', () => {
  // 避让逻辑（env(safe-area-inset-*) + max(env,Npx) 兜底）在 @proteus-vue/fluid resolveSafeAreaStyle 共享模块——
  // MP 产物无模块系统 → 组件产物不含 env/max 实现（unresolved import 诚实警告）；契约锁：safeStyle 走自动序列化 + hinge 边界
  const r = compileComponent('src/components/p-safe/index.vue')
  it('P14a：safeStyle 走 __proteusStyleString（对象绑定自动序列化通道；链式 init 双形态）', () => {
    expect(r.js).toMatch(/__proteusStyleString\(this\.proteusCalcSafeStyle\(\)\)/)
    expect(r.wxml).toContain('style="{{safeStyle}}"')
  })
  it('P14b：产物不含 env( 实现；resolveSafeAreaStyle 裸引用由打包层接线 _proteus/fluid.js（@proteus-vue/* scope import 剥离无警告）', () => {
    expect(r.js).not.toContain('env(safe-area-inset')
    expect(r.js).toMatch(/resolveSafeAreaStyle\(/)
  })
  it('P14c：hinge 避让 displayMode 逻辑在位（MP 逻辑层无 matchMedia → displayMode 恒 standard 诚实边界）', () => {
    expect(r.js).toMatch(/displayMode === 'fold'/)
  })
})

describe('★mp-conformance 探针矩阵 P15：p-aspect 盒模型假设（#500 降级 hack 宽高全丢根因）', () => {
  // padding-top hack 依赖「高度 0 + padding 撑盒」——渲染端默认 border-box 则总高恒 0；契约：显式 content-box
  // + 内层 p-aspect-inner 承载 slot 与内联定位（MP 产物通配/子选择器被剔除 → .p-aspect-fallback > * 全局规则退役）
  const r = compileComponent('src/components/p-aspect/index.vue')
  it('P15a：降级 padding hack 显式 box-sizing content-box + paddingTop 百分比', () => {
    expect(r.js).toMatch(/boxSizing\s*=\s*['"]content-box['"]/)
    expect(r.js).toMatch(/paddingTop\s*=\s*100\s*\/\s*ratio/)
  })
  it('P15b：内层 p-aspect-inner 节点承载 innerStyle + slot（子选择器降级通道退役）', () => {
    expect(r.wxml).toMatch(/class="p-aspect-inner/)
    expect(r.wxml).toContain('style="{{innerStyle}}"')
    expect(r.js).toMatch(/innerStyle: __proteusStyleString\(/)
  })
  it('P15c：aspectOk 探测分支在位（原生 aspect-ratio 与降级 hack 双形态）', () => {
    expect(r.js).toMatch(/aspectOk/)
    expect(r.js).toMatch(/p-aspect-fallback/)
  })
})

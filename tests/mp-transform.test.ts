// tests/mp-transform.test.ts
// P4 转换函数单测（文档 P6-2 提前落地）：直接调用三个纯转换函数，验证映射表
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  transformTemplateToWxml,
  transformScriptToPage,
  transformStyleToWxss,
  compileVueSfc,
  validateJs,
  validateWxml,
} from '../packages/compiler/src'

const opts = { px2rpx: true, rpxRatio: 2 }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('v-show（v0.3 指令补全）', () => {
  it('v-show → hidden 属性（display:none 语义，元素始终渲染）', () => {
    const { wxml } = transformTemplateToWxml('<p v-show="show">a</p>', opts)
    expect(wxml).toContain('hidden="{{!show}}"')
    expect(wxml).toContain('class="proteus-p"')
  })

  it('v-show 不再警告（原为 limitation 规则，已升级 implemented）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    transformTemplateToWxml('<p v-show="show">a</p>', opts)
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('v-show'))
  })
})

describe('computed 读路径（v0.3）', () => {
  const SRC = 'const count = ref(0)\nconst double = computed(() => count.value * 2)\nfunction add() {\n  count.value++\n}\nfunction setN() {\n  count.value = 5\n}'

  it('data 不含 computed 字段（派生字段不进初始 data）', () => {
    const { js } = transformScriptToPage(SRC, opts)
    const dataLine = js.split('\n').find((l) => l.includes('count: 0'))
    expect(dataLine).toBeTruthy()
    expect(js).not.toContain('double: undefined')
  })

  it('onLoad 初始化：首次渲染前计算派生字段', () => {
    const { js } = transformScriptToPage(SRC, opts)
    expect(js).toContain('this.setData({ double: this.data.count * 2 })')
  })

  it('依赖写入 setData 合并重算：先更新 this.data 再 setData（派生读到新值）', () => {
    const { js } = transformScriptToPage(SRC, opts)
    // 自增（后置）：先 this.data.count 更新，setData 对象里 count + double
    expect(js).toContain('this.data.count = (this.data.count === undefined || this.data.count === null ? 0 : this.data.count) + 1; this.setData({ count: this.data.count, double: this.data.count * 2 })')
    // 赋值：同样先写 this.data
    expect(js).toContain('this.data.count = 5; this.setData({ count: this.data.count, double: this.data.count * 2 })')
  })

  it('无写入的 ref（只读）不产生 setData', () => {
    const { js } = transformScriptToPage('const a = ref(1)\nconst b = computed(() => a.value + 1)', opts)
    expect(js).toContain('this.setData({ b: this.data.a + 1 })')
    expect(js.split('setData').length).toBeGreaterThanOrEqual(2) // onLoad 初始化 + 无其他
  })

  it('依赖未在顶层 data 定义 → 编译期警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    transformScriptToPage('const double = computed(() => count.value * 2)', opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('依赖 count 未在顶层 data 中定义'))
  })

  it('块体 computed（computed(() => { return ... })）→ 编译期警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { js } = transformScriptToPage('const c = ref(1)\nconst d = computed(() => { return c.value + 1 })', opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('仅支持箭头简写'))
    expect(js).not.toContain('d:')
  })

  it('模板插值直接渲染派生字段（{{ double }} 无需额外转换）', () => {
    const result = compileVueSfc('<script setup lang="ts">const count = ref(0)\nconst double = computed(() => count.value * 2)</script>\n<template><p>{{ double }}</p></template>')
    expect(result.wxml).toContain('{{ double }}')
    expect(result.js).toContain('this.setData({ double: this.data.count * 2 })')
  })
})

describe('scoped CSS（v0.3）', () => {
  const SFC = '<template>\n  <div class="card">\n    <p class="title">hi</p>\n  </div>\n</template>\n<style scoped>\n.card { padding: 8px; }\n.card .title { color: red; }\n</style>'

  it('模板元素附加作用域属性 + 选择器追加 [data-v-xxx]', () => {
    const result = compileVueSfc(SFC, { filename: 'scoped-demo.vue' })
    expect(result.wxml).toContain('data-v-')
    expect(result.wxml).toContain('<view data-v-')
    expect(result.wxss).toContain('.card[data-v-')
    expect(result.wxss).toContain('.card .title[data-v-')
  })

  it('scopeId 稳定（同文件同属性名），且产物自校验通过', () => {
    const a = compileVueSfc(SFC, { filename: 'scoped-demo.vue' })
    const b = compileVueSfc(SFC, { filename: 'scoped-demo.vue' })
    const idA = a.wxml.match(/data-v-[a-f0-9]+/)?.[0]
    const idB = b.wxml.match(/data-v-[a-f0-9]+/)?.[0]
    expect(idA).toBeTruthy()
    expect(idA).toBe(idB)
  })

  it(':deep() 去包装（内容保留）', () => {
    const result = compileVueSfc('<template><div class="a">x</div></template>\n<style scoped>\n.a :deep(.b) { color: red; }\n</style>', { filename: 'deep-demo.vue' })
    expect(result.wxss).toContain('.a .b[')
    expect(result.wxss).not.toContain(':deep')
  })

  it('非 scoped style 不生成作用域属性', () => {
    const result = compileVueSfc('<template><div class="a">x</div></template>\n<style>\n.a { color: red; }\n</style>', { filename: 'plain-demo.vue' })
    expect(result.wxml).not.toContain('data-v-')
    expect(result.wxss).not.toContain('[data-v-')
  })
})

describe(':class 数组语法（v0.3）', () => {
  it('数组 → 逐项拼接（字符串/对象/简单变量/三元）', () => {
    const { wxml } = transformTemplateToWxml('<p :class="[base, { active: on }, \'fixed\', cond ? \'a\' : \'b\']">x</p>', opts)
    expect(wxml).toContain("{{((base)?(base)+' ':'')+(on?'active ':'')+'fixed '+((cond ? 'a' : 'b')?(cond ? 'a' : 'b')+' ':'')}}")
  })

  it('数组项不支持形式 → 编译期警告并跳过该项', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { wxml } = transformTemplateToWxml('<p :class="[foo.bar(), ok]">x</p>', opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('数组项'))
    expect(wxml).toContain('ok')
  })
})

describe('transformTemplateToWxml（template → wxml）', () => {
  it('标准标签映射：div→view / span,p,h1→text / img→image', () => {
    const { wxml } = transformTemplateToWxml('<div><span>hi</span><p>p</p><h1>t</h1><img :src="url" /></div>', opts)
    expect(wxml).toContain('<view>')
    expect(wxml).toContain('<text>hi</text>')
    expect(wxml).toContain('<text class="proteus-p">p</text>')
    expect(wxml).toContain('<text class="proteus-h1">t</text>')
    expect(wxml).toContain('<image src="{{url}}" />')
  })

  it('语义标签自动附加基础类，与静态 class / :class 共存', () => {
    const { wxml } = transformTemplateToWxml(
      '<h1 class="title">a</h1><p :class="{ active: on }">b</p><h2>c</h2><div class="plain">d</div>',
      opts,
    )
    expect(wxml).toContain('<text class="proteus-h1 title">a</text>')
    expect(wxml).toContain('<text class="proteus-p {{(on?\'active \':\'\')}}">b</text>')
    expect(wxml).toContain('<text class="proteus-h2">c</text>')
    // 非语义标签（div）不附加基础类
    expect(wxml).toContain('<view class="plain">d</view>')
  })

  it('v-if / v-else → wx:if / wx:else', () => {
    const { wxml } = transformTemplateToWxml('<p v-if="show">a</p><p v-else>b</p>', opts)
    expect(wxml).toContain('wx:if="{{show}}"')
    expect(wxml).toContain('wx:else')
  })

  it('v-for → wx:for / wx:for-item / wx:for-index（:key 映射 wx:key）', () => {
    const { wxml } = transformTemplateToWxml('<div v-for="(item, idx) in list" :key="idx">{{ item }}</div>', opts)
    expect(wxml).toContain('wx:for="{{list}}"')
    expect(wxml).toContain('wx:for-item="item"')
    expect(wxml).toContain('wx:for-index="idx"')
    expect(wxml).toContain('wx:key="idx"')
  })

  it('事件映射：@click→bindtap / @click.stop→catchtap / @input→bindinput', () => {
    const { wxml } = transformTemplateToWxml(
      '<button @click="handleTap">go</button><a @click.stop="stopFn">s</a><input @input="onInput" />',
      opts,
    )
    expect(wxml).toContain('bindtap="handleTap"')
    expect(wxml).toContain('catchtap="stopFn"')
    expect(wxml).toContain('bindinput="onInput"')
  })

  it('v-model → value + bindinput，并收集绑定名', () => {
    const { wxml, vModelBindings } = transformTemplateToWxml('<input v-model="text" />', opts)
    expect(wxml).toContain('value="{{text}}"')
    expect(wxml).toContain('bindinput="proteusOnTextInput"')
    expect(vModelBindings).toEqual(['text'])
  })

  it('v-html → rich-text（不附加基础类）', () => {
    const { wxml } = transformTemplateToWxml('<div v-html="html"></div>', opts)
    expect(wxml).toContain('<rich-text nodes="{{html}}" />')
  })

  it(':class 对象语法 → 三元拼接', () => {
    const { wxml } = transformTemplateToWxml('<div :class="{ active: isActive }">x</div>', opts)
    expect(wxml).toContain("isActive?'active '")
  })

  it(':src / :style 绑定 → {{ }}', () => {
    const { wxml } = transformTemplateToWxml('<div :style="{ color: c }">x</div><img :src="img" />', opts)
    expect(wxml).toContain('style="color:{{c}}"')
    expect(wxml).toContain('src="{{img}}"')
  })

  it('导航链接：<a href> → view bindtap proteusNavigateTo + data-url（并标记 usesNavigate）', () => {
    const { wxml, usesNavigate } = transformTemplateToWxml('<a href="/pages/user/profile">go</a>', opts)
    expect(wxml).toContain('bindtap="proteusNavigateTo"')
    expect(wxml).toContain('data-url="/pages/user/profile"')
    expect(wxml).toContain('<view')
    expect(wxml).toContain('class="proteus-a"')
    expect(usesNavigate).toBe(true)
  })

  it('<router-link to> 与 route-type → data-url / data-route-type；对象形式 :to 告警', () => {
    const { wxml } = transformTemplateToWxml(
      `<router-link to="/pages/x" route-type="halfScreen">x</router-link>`,
      opts,
    )
    expect(wxml).toContain('data-url="/pages/x"')
    expect(wxml).toContain('data-route-type="halfScreen"')
    expect(wxml).toContain('bindtap="proteusNavigateTo"')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    transformTemplateToWxml(`<router-link :to="{ name: 'x' }">x</router-link>`, opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('对象形式暂不支持'))
  })

  it('<a @click> 仍按事件映射（不作为导航链接）', () => {
    const { wxml, usesNavigate } = transformTemplateToWxml('<a href="/x" @click="fn">go</a>', opts)
    expect(wxml).toContain('bindtap="fn"')
    expect(usesNavigate).toBe(false)
  })

  it('文本插值保留为 {{ }}', () => {
    const { wxml } = transformTemplateToWxml('<p>{{ msg }}</p>', opts)
    expect(wxml).toContain('{{ msg }}')
  })
})

describe('transformScriptToPage（script → Page 构造器）', () => {
  it('ref/reactive/字面量 const → data', () => {
    const { js } = transformScriptToPage(
      "import { ref } from 'vue'\nconst title = ref('Proteus')\nconst count = ref(0)\nconst imgUrl = '/logo.png'",
      opts,
    )
    expect(js).toContain('Page({')
    expect(js).toContain('title: "Proteus"')
    expect(js).toContain('count: 0')
    expect(js).toContain('imgUrl: "/logo.png"')
  })

  it('顶层函数 → methods（对象方法简写）', () => {
    const { js } = transformScriptToPage('function greet(name) { return "hi " + name }', opts)
    expect(js).toContain('greet(name) {')
    expect(js).toContain('"hi " + name')
    // 对象字面量中必须是方法简写，不能是裸 function 声明
    expect(js).not.toContain('  function greet')
  })

  it('生命周期映射：onMounted→onReady / onUnmounted→onUnload', () => {
    const { js } = transformScriptToPage(
      "onMounted(() => {\n  console.log('ready')\n})\nonUnmounted(() => {\n  console.log('bye')\n})",
      opts,
    )
    expect(js).toContain('onReady() {')
    expect(js).toContain("console.log('ready')")
    expect(js).toContain('onUnload() {')
  })

  it('方法内 ref 写入重写为 setData（++/--/赋值/读取，不用 ?? 运算符）', () => {
    const { js } = transformScriptToPage(
      [
        'const count = ref(0)',
        'const title = ref("x")',
        'function inc() { count.value++ }',
        'function dec() { count.value-- }',
        'function setTitle() { title.value = "y" }',
        'function read() { return count.value }',
      ].join('\n'),
      opts,
    )
    expect(js).toContain('this.setData({ count: (this.data.count === undefined || this.data.count === null ? 0 : this.data.count) + 1 })')
    expect(js).toContain('this.setData({ count: (this.data.count === undefined || this.data.count === null ? 0 : this.data.count) - 1 })')
    expect(js).toContain('this.setData({ title: "y" })')
    expect(js).toContain('return this.data.count')
    // 不残留裸的 .value 与 ?? 运算符（真机预览 SyntaxError: Unexpected token ?）
    expect(js).not.toMatch(/\bcount\.value\b/)
    expect(js).not.toMatch(/\btitle\.value\b/)
    expect(js).not.toContain('??')
  })

  it('生命周期体内 ref 写入同样重写', () => {
    const { js } = transformScriptToPage('const n = ref(0)\nonMounted(() => {\n  n.value = 5\n})', opts)
    expect(js).toContain('this.setData({ n: 5 })')
  })

  it('v-model handler 注入：proteusOnXxxInput(e) { this.setData(...) }', () => {
    const { js } = transformScriptToPage('', opts, { vModelBindings: ['text'] })
    expect(js).toContain('proteusOnTextInput(e) { this.setData({ text: e.detail.value }) }')
  })

  it('usesNavigate → 自动注入 proteusNavigateTo handler（方法名避开 __ 前缀）', () => {
    const { js } = transformScriptToPage('', opts, { usesNavigate: true })
    expect(js).toContain('proteusNavigateTo(e) {')
    expect(js).not.toContain('__navigateTo')
    expect(js).toContain('wx.navigateTo(nav)')
    expect(js).toContain('ds.routeType')
  })

  it('导航 url 保留前导 /（微信 navigateTo 相对路径会解析成 pages/pages/... 报错）', () => {
    const { js } = transformScriptToPage('', opts, { usesNavigate: true })
    expect(js).toContain('const url = String(ds.url || "")')
    expect(js).not.toContain('replace(/^[/]/')
  })

  it('生成代码避免数组解构/对象展开（微信 ES5 转译 babel helper 问题）', () => {
    const { js } = transformScriptToPage('', opts, { usesNavigate: true, vModelBindings: ['text'] })
    // onLoad 用索引循环，不用 for (const [k, v] of ...)
    expect(js).toContain('const keys = Object.keys(options || {})')
    expect(js).not.toContain('for (const [k, v]')
    // 导航不用对象展开
    expect(js).not.toContain('...opts')
    expect(js).not.toContain('...(')
  })

  it('全链路调试日志：debug=true 注入 [proteus][环节] 日志，默认构建零日志', () => {
    const dbg = transformScriptToPage('', opts, { usesNavigate: true, debug: true, file: 'pages/index' })
    expect(dbg.js).toContain("[proteus][page] onLoad pages/index")
    expect(dbg.js).toContain("[proteus][page] onReady pages/index")
    expect(dbg.js).toContain("[proteus][nav] tap")
    expect(dbg.js).toContain("[proteus][nav] navigateTo success")
    expect(dbg.js).toContain("[proteus][nav] navigateTo fail")
    const plain = transformScriptToPage('', opts, { usesNavigate: true, file: 'pages/index' })
    expect(plain.js).not.toContain('[proteus]')
  })

  it('多行对象数组 ref → data 完整提取（字符串内括号不干扰，★showcase 修复）', () => {
    const { js } = transformScriptToPage(
      [
        "import { ref } from 'vue'",
        'const cards = ref([',
        "  { title: '缓出/缓入曲线', desc: '进入 easeOutCubic / 退出 easeInCubic' },",
        "  { title: '遮罩 barrierColor', desc: 'rgba(0,0,0,0.8) + 点击关闭' },",
        '])',
      ].join('\n'),
      opts,
    )
    expect(js).toContain('cards: [{"title":"缓出/缓入曲线","desc":"进入 easeOutCubic / 退出 easeInCubic"},{"title":"遮罩 barrierColor","desc":"rgba(0,0,0,0.8) + 点击关闭"}]')
    expect(js).not.toContain('cards: undefined')
  })

  it('多行普通数组 / 带分号初始值同样支持', () => {
    const { js } = transformScriptToPage(
      [
        'const tags = [',
        "  'a',",
        "  'b',",
        ']',
        "const title = ref('x');",
      ].join('\n'),
      opts,
    )
    expect(js).toContain('tags: ["a","b"]')
    expect(js).toContain('title: "x"')
  })

  it('函数体/生命周期体内的局部 const 不提取为 data', () => {
    const { js } = transformScriptToPage(
      [
        'const top = ref(1)',
        'function foo() {',
        '  const hidden = 2',
        '  return hidden',
        '}',
        "onMounted(() => {",
        '  const inner = ref(3)',
        '  inner.value = 5',
        '})',
      ].join('\n'),
      opts,
    )
    expect(js).toContain('top: 1')
    expect(js).not.toContain('hidden:')
    expect(js).not.toContain('inner:')
  })

  it('多行方法体内 const 不误伤（缩进判断）', () => {
    const { js } = transformScriptToPage(
      [
        'const a = 1',
        'function handler() {',
        '  const b = [',
        '    1,',
        '    2,',
        '  ]',
        '  return b',
        '}',
      ].join('\n'),
      opts,
    )
    expect(js).toContain('a: 1')
    expect(js).not.toContain('b:')
  })

  it('组件（isComponent）→ Component 构造器', () => {
    const { js } = transformScriptToPage('const name = ref("x")', opts, { isComponent: true })
    expect(js).toContain('Component({')
    expect(js).not.toContain('Page({')
  })
})

describe('compileVueSfc（整包编译入口）', () => {
  it('SFC → wxml/js/wxss 一次产出', () => {
    const sfc = [
      '<route>{ "meta": { "title": "x" } }</route>',
      '<script setup lang="ts">',
      "import { ref } from 'vue'",
      "const title = ref('hi')",
      '</script>',
      '<template>',
      '<div class="a"><h1>{{ title }}</h1><img :src="url" /></div>',
      '</template>',
      '<style>.a { padding: 16px; }</style>',
    ].join('\n')
    const { wxml, js, wxss, warnings } = compileVueSfc(sfc, { filename: 'pages/test/index' })
    expect(wxml).toContain('<view class="a">')
    expect(wxml).toContain('<image src="{{url}}" />')
    expect(js).toContain('Page({')
    expect(js).toContain('title: "hi"')
    expect(js).toContain('// pages/test/index（Proteus mp-transform 编译产物）')
    expect(wxss).toContain('32rpx')
    expect(Array.isArray(warnings)).toBe(true)
  })

  it('isComponent → Component 构造器', () => {
    const sfc = '<script setup lang="ts">const n = ref(1)</script><template><div>{{ n }}</div></template>'
    const { js } = compileVueSfc(sfc, { isComponent: true })
    expect(js).toContain('Component({')
  })
})

describe('transformStyleToWxss（style → wxss）', () => {
  it('px → rpx（含小数）', () => {
    const css = transformStyleToWxss('.a { padding: 48px 1.5px; }', opts)
    expect(css).toContain('96rpx')
    expect(css).toContain('3rpx')
    expect(css).not.toContain('48px')
  })

  it('标签选择器映射：语义标签 → 基础类（.links a → .links .proteus-a / h1 → .proteus-h1），div → view', () => {
    const css = transformStyleToWxss('.links a { color: #1a7af8; }\nh1 { font-size: 32px; }\np { margin: 0; }\ndiv > p { padding: 4px; }', opts)
    expect(css).toContain('.links .proteus-a { color: #1a7af8; }')
    expect(css).toContain('.proteus-h1 { font-size: 64rpx; }')
    expect(css).toContain('.proteus-p { margin: 0; }')
    expect(css).toContain('view > .proteus-p { padding: 8rpx; }')
    expect(css).not.toContain('.links a')
    expect(css).not.toContain('.links view')
  })

  it('多对一映射不撞选择器：.card h3 与 .card p 独立（★showcase 卡片 h3 被染灰回归）', () => {
    const css = transformStyleToWxss(
      '.card h3 { margin: 0 0 4px; font-size: 16px; }\n.card p { margin: 0; color: #666; font-size: 13px; }',
      opts,
    )
    expect(css).toContain('.card .proteus-h3 { margin: 0 0 8rpx; font-size: 32rpx; }')
    expect(css).toContain('.card .proteus-p { margin: 0; color: #666; font-size: 26rpx; }')
    // 两条规则不再合并为同选择器（否则后写 .card p 的 color:#666 会污染 h3）
    expect(css).not.toContain('.card text {')
  })

  it('div 与 a 同映射 view 也隔离：.x div → .x view、.x a → .x .proteus-a', () => {
    const css = transformStyleToWxss('.x div { color: blue; }\n.x a { color: red; }', opts)
    expect(css).toContain('.x view { color: blue; }')
    expect(css).toContain('.x .proteus-a { color: red; }')
  })

  it('注入 Web UA 语义基础样式（对齐 HTML 标准附录 D：font-size 固定 rpx + margin 单边 em）', () => {
    const css = transformStyleToWxss('', opts)
    expect(css).toContain('.proteus-h1 { display: block; font-size: 64rpx; font-weight: 700; margin: 0 0 0.67em; }')
    expect(css).toContain('.proteus-h2 { display: block; font-size: 48rpx; font-weight: 700; margin: 0 0 0.83em; }')
    expect(css).toContain('.proteus-p { display: block; margin: 0 0 1em; }')
    expect(css).toContain('.proteus-a { color: #1a7af8; text-decoration: underline; }')
    // margin 用 em（相对自身字号，与 Web UA 同比例），不经过 px2rpx；rpx 字号不被二次转换
    expect(css).not.toContain('margin: 24rpx 0')
    expect(css).not.toContain('font-size: 128rpx')
    // 基础类自身不被标签选择器重写误伤
    expect(css).not.toContain('.proteus-h1 { display: block; font-size: 128rpx')
  })

  it('伪类/伪函数：a:hover → .proteus-a:hover、:not(h1) → :not(.proteus-h1)、a.link → .proteus-a.link', () => {
    const css = transformStyleToWxss('a:hover { opacity: 0.5; }\n:not(h1) { color: gray; }\na.link { display: block; }', opts)
    expect(css).toContain('.proteus-a:hover { opacity: 0.5; }')
    expect(css).toContain(':not(.proteus-h1) { color: gray; }')
    expect(css).toContain('.proteus-a.link { display: block; }')
  })

  it('属性选择器保留：input[type="text"] → input[type="text"]（input→input 不变，属性内容不误伤）', () => {
    const css = transformStyleToWxss('input[type="text"] { border: 1px solid; }', opts)
    expect(css).toContain('input[type="text"] { border: 2rpx solid; }')
    expect(css).not.toContain('view[type="text"]')
  })

  it('类名/ID/长标识符不误伤：.a / #input / .tag-a / .data-input / .my-class 保持原样', () => {
    const css = transformStyleToWxss(
      '.a { color: red; }\n#input { color: blue; }\n.tag-a { color: green; }\n.data-input { color: black; }\n.my-class { color: white; }',
      opts,
    )
    expect(css).toContain('.a { color: red; }')
    expect(css).toContain('#input { color: blue; }')
    expect(css).toContain('.tag-a { color: green; }')
    expect(css).toContain('.data-input { color: black; }')
    expect(css).toContain('.my-class { color: white; }')
  })

  it('声明块内容不重写：content: "a" 的引号内容保留', () => {
    const css = transformStyleToWxss('view::before { content: "a"; }', opts)
    expect(css).toContain('view::before { content: "a"; }')
  })

  it('@media / @keyframes 骨架不被破坏', () => {
    const css = transformStyleToWxss(
      '@media (min-width: 600px) { h1 { color: red; } }\n@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
      opts,
    )
    expect(css).toContain('@media (min-width: 1200rpx) { .proteus-h1 { color: red; } }')
    expect(css).toContain('@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }')
  })

  it('float 触发编译期警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    transformStyleToWxss('.a { float: left; }', opts)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('float'))
  })
})

describe('产物自校验（反编译黑盒）', () => {
  it('validateJs：非法 JS 被检出', () => {
    expect(validateJs('Page({ data: {').ok).toBe(false)
    expect(validateJs('Page({ data: { a: 1 } })').ok).toBe(true)
  })

  it('validateWxml：标签不配对被检出', () => {
    expect(validateWxml('<view><text>a</view>').ok).toBe(false)
    expect(validateWxml('<view><text>a</text></view>').ok).toBe(true)
    // 行号注释（含标签文本）不应干扰校验
    expect(validateWxml('<!-- @3 div --><view />').ok).toBe(true)
  })

  it('compileVueSfc：合法输入不抛错（校验钩子生效）', () => {
    const sfc = '<script setup>const x = ref(1)</script><template><div>{{ x }}</div></template>'
    expect(() => compileVueSfc(sfc, { filename: 'pages/ok' })).not.toThrow()
  })

  it('annotateLines：产物注入源码行号注释（dev 调试）', () => {
    const sfc = ['<template>', '<div class="a">', '<h1>t</h1>', '</div>', '</template>'].join('\n')
    const { wxml } = compileVueSfc(sfc, { filename: 'pages/line', annotateLines: true })
    expect(wxml).toContain('<!-- @2 div -->')
    expect(wxml).toContain('<!-- @3 h1 -->')
    // 默认关闭：不影响正式产物
    const normal = compileVueSfc(sfc, { filename: 'pages/line' })
    expect(normal.wxml).not.toContain('<!-- @')
  })
})

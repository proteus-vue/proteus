// tests/compiler-validate-wxml-platform.test.ts
// ★#505 G2：wxml 产物按平台标准校验（蓝本 = glass-easel 官方 parser 错误码）——
//   DataBindingNotAllowed（wx:key 禁数据绑定）/ DuplicatedAttribute / AvoidUppercaseLetters /
//   UnsupportedSyntax（绑定表达式含 ?.）/ InvalidAttribute（wx:key·for-item·index 无 for 悬挂；wx:else/elif 悬挂）/ DuplicatedStylePropertyNames（纯静态 style 重复键）。
//   产物正常形态永不命中，命中即编译器 bug（G1 wx:key 防回归 + 历史 class 双属性真机坑 + 大写标签映射漏 + ?. 透传坑 + codegen 重构回归）。
import { describe, it, expect } from 'vitest'
import {
  compileVueSfc,
  transformTemplateToWxml,
  transformScriptToPage,
  scanWxmlPlatformIssues,
  validateWxmlPlatform,
  assertValidResult,
  CompilerError,
} from '@proteus-vue/compiler'

const opts = { px2rpx: true, rpxRatio: 2 }

describe('★#505 G2 scanWxmlPlatformIssues：官方错误码蓝本七检查', () => {
  it('DataBindingNotAllowed：wx:key 含 {{}} → 命中（官方：wx:key 禁用数据绑定）', () => {
    const issues = scanWxmlPlatformIssues('<view wx:for="{{list}}" wx:key="{{item.id}}">x</view>')
    expect(issues.some((i) => i.code === 'DataBindingNotAllowed' && i.message.includes('wx:key'))).toBe(true)
  })

  it('DuplicatedAttribute：class 双属性 → 命中（历史真机坑：微信仅保留其一）', () => {
    const issues = scanWxmlPlatformIssues('<view class="a" class="b">x</view>')
    expect(issues.some((i) => i.code === 'DuplicatedAttribute' && i.message.includes('class'))).toBe(true)
  })

  it('AvoidUppercaseLetters：大写标签名 → 命中（属性名豁免——camelCase 自定义属性合法）', () => {
    const issues = scanWxmlPlatformIssues('<PModal :prop="x">x</PModal>')
    expect(issues.some((i) => i.code === 'AvoidUppercaseLetters' && i.message.includes('PModal'))).toBe(true)
    // camelCase 属性（modelValue/viewBox 类）是合法绑定，不命中
    expect(scanWxmlPlatformIssues('<p-switch modelValue="{{x}}" />')).toEqual([])
  })

  it('★2026-09-07 官方深扒：UnsupportedSyntax——绑定表达式含 ?. 可选链命中（官方 expr.rs 运算符表无 ?.）', () => {
    // 属性绑定形态 {{ a?.b }} → 命中
    const attr = scanWxmlPlatformIssues('<view hidden="{{!a?.b}}">x</view>')
    expect(attr.some((i) => i.code === 'UnsupportedSyntax' && i.message.includes('?.'))).toBe(true)
    // 文本插值形态同样命中（表达式经平台解析）
    const text = scanWxmlPlatformIssues('<view>{{ a?.list[0]?.name }}</view>')
    expect(text.some((i) => i.code === 'UnsupportedSyntax')).toBe(true)
    // ★2026-09-09 真机证据推翻官方文档：wcc 实测拒绝 {{a ?? b}}（model-demo 模拟器启动失败实证）——
    //   ?? 加入 UnsupportedSyntax（fail-closed）；? 三元后跟 . 数字（a? .5）非可选链——不误报
    expect(scanWxmlPlatformIssues('<view hidden="{{a ?? b}}">x</view>').some((i) => i.code === 'UnsupportedSyntax' && i.message.includes('??'))).toBe(true)
  })

  it('正常产物零命中（kebab 标签 + 引号值含 = / 冒号 / wx:key 静态字段）', () => {
    const wxml = '<view class="a b" style="color:{{c}}" wx:for="{{list}}" wx:for-item="item" wx:key="id" bind:tap="fn">x</view>'
    expect(scanWxmlPlatformIssues(wxml)).toEqual([])
  })

  it('注释与闭标签不误报', () => {
    expect(scanWxmlPlatformIssues('<!-- <PModal wx:key="{{x}}"> --></view>')).toEqual([])
  })

  it('★2026-09-07 官方深扒二轮：InvalidAttribute——wx:key / wx:for-item 无 wx:for 悬挂命中（官方 ForList 仅 for 存在时消费）', () => {
    const r = scanWxmlPlatformIssues('<view wx:key="id">x</view>')
    expect(r.some((i) => i.code === 'InvalidAttribute' && i.message.includes('wx:key'))).toBe(true)
    const r2 = scanWxmlPlatformIssues('<view wx:for-item="it" wx:for-index="i">x</view>')
    expect(r2.some((i) => i.code === 'InvalidAttribute' && i.message.includes('wx:for-item'))).toBe(true)
    // 有 wx:for 的正常形态零命中（wx:key 恒随 for）
    expect(scanWxmlPlatformIssues('<view wx:for="{{list}}" wx:for-item="it" wx:for-index="i" wx:key="id">x</view>')).toEqual([])
  })

  it('★2026-09-07 官方深扒二轮：InvalidAttribute——wx:else/elif 悬挂命中（官方分支组要求紧跟 if 链），配对链零误报', () => {
    // 悬挂：wx:else 前兄弟不是 wx:if/elif
    const r = scanWxmlPlatformIssues('<view>a</view><view wx:else>b</view>')
    expect(r.some((i) => i.code === 'InvalidAttribute' && i.message.includes('wx:else'))).toBe(true)
    // 悬挂：wx:elif 在 wx:else 之后（链已闭合）
    const r2 = scanWxmlPlatformIssues('<view wx:if="{{a}}">1</view><view wx:else>2</view><view wx:elif="{{b}}">3</view>')
    expect(r2.some((i) => i.code === 'InvalidAttribute' && i.message.includes('wx:elif'))).toBe(true)
    // 配对链零命中（if → elif → else，跨行/自闭合均合法）
    expect(scanWxmlPlatformIssues('<view wx:if="{{a}}">1</view>\n<view wx:elif="{{b}}">2</view>\n<view wx:else>3</view>')).toEqual([])
    expect(scanWxmlPlatformIssues('<view wx:if="{{a}}" /><view wx:else />')).toEqual([])
    // 注释夹在链中不破坏配对
    expect(scanWxmlPlatformIssues('<view wx:if="{{a}}">1</view><!-- 中间 --><view wx:else>2</view>')).toEqual([])
  })

  it('★2026-09-07 三轮取证：DuplicatedStylePropertyNames——纯静态 style 重复键命中（官方仅对 Value::Static 拆分查重），动态/引号分号不误报', () => {
    // 静态重复键 → 命中
    const r = scanWxmlPlatformIssues('<view style="color:red;color:blue">x</view>')
    expect(r.some((i) => i.code === 'DuplicatedStylePropertyNames' && i.message.includes('color'))).toBe(true)
    // 合法静态多键 → 零命中
    expect(scanWxmlPlatformIssues('<view style="color:red;background:#fff">x</view>')).toEqual([])
    // 动态/混合 style（含 {{}}）→ 官方不静态查重，跳过零命中
    expect(scanWxmlPlatformIssues('<view style="{{styleStr}}">x</view>')).toEqual([])
    expect(scanWxmlPlatformIssues('<view style="color:{{c}}">x</view>')).toEqual([])
    // 引号内分号不误拆（font-family 值含 ;）
    expect(scanWxmlPlatformIssues("<view style=\"font-family:'A;B',sans-serif;color:red\">x</view>")).toEqual([])
  })
})

describe('★#505 G2 validateWxmlPlatform + assertValidResult 接线', () => {
  it('validateWxmlPlatform：违规 → ok:false + 官方错误码', () => {
    const r = validateWxmlPlatform('<view wx:key="{{x}}">y</view>')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('[DataBindingNotAllowed]')
  })

  it('assertValidResult：wxml 平台违规 → 抛 CompilerError 指明文件', () => {
    const bad = { wxml: '<view wx:key="{{x}}">y</view>', js: 'Page({})', wxss: '', warnings: [] }
    expect(() => assertValidResult(bad, 'pages/bad.vue')).toThrowError(CompilerError)
    try {
      assertValidResult(bad, 'pages/bad.vue')
    } catch (e) {
      expect(String(e)).toContain('wxml 产物平台标准违规')
      expect(String(e)).toContain('DataBindingNotAllowed')
    }
  })
})

describe('★#505 G2 端到端：compileVueSfc 正常产物过 wxml 平台校验（零误报）', () => {
  it('复杂页面（v-for + key + 事件 + style 绑定）产物过平台校验', () => {
    const r = compileVueSfc(
      '<script setup lang="ts">import { ref } from "vue"\nconst cards = ref([{ id: 1, title: "a" }])</script>\n'
        + '<template><view v-for="c in cards" :key="c.id" class="card"><text @tap="onTap" style="color:{{c.color}}">{{ c.title }}</text></view></template>',
      { filename: 'pages/g2.vue', ...opts },
    )
    // 产物 wx:key 已剥前缀为静态字段（G1）——平台校验零命中（compileVueSfc 内部 assertValidResult 已含 wxml 平台段）
    expect(r.wxml).toContain('wx:key="id"')
    expect(scanWxmlPlatformIssues(r.wxml)).toEqual([])
  })

  it('wxml 产物经 transformTemplateToWxml 单独调用同样零命中', () => {
    const { wxml } = transformTemplateToWxml('<div class="page"><h1>Title</h1><p v-if="ok" class="x">hi</p></div>', opts)
    expect(scanWxmlPlatformIssues(wxml)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★2026-09-20 外部实战报告第二十四节（**真机黑屏根因**）回归锁：
//   三类 WXML 违规此前**完全静默**通过框架校验（`validateJs` 只看 JS、平台校验不覆盖
//   表达式语法与标签合法性）→ 微信 wxml 编译器直接拒绝 → 外部工程整屏黑屏、排查多轮。
//   判据（报告原文）：「build:mp 退出码 0、产物齐全、usingComponents 全通，但微信编译器直接拒绝」。
// ─────────────────────────────────────────────────────────────────────────────
describe('★WXML 三类静默违规（F-32 真机黑屏根因）', () => {
  const opts3 = { filename: 't.vue', px2rpx: true, rpxRatio: 2 }

  it('① 模板字面量（反引号 / ${}）→ 必须报 TemplateLiteralInExpression（WXML 表达式不支持）', () => {
    const src = '<script setup>\nconst x = ref(1)\n</script>\n<template><view :title="`a ${x} b`">t</view></template>'
    expect(() => compileVueSfc(src, opts3), '含模板字面量的绑定必须在编译期被拦截').toThrow(/TemplateLiteralInExpression/)
    // 对照：预计算到 script（报告给出的正当修法）→ 通过
    const fixedSrc = '<script setup>\nconst x = ref(1)\nconst t = computed(() => `a ${x.value} b`)\n</script>\n<template><view :title="t">t</view></template>'
    expect(() => compileVueSfc(fixedSrc, opts3), '预计算后应通过').not.toThrow()
  })

  it('② `<template>` 带 v-if 且含子元素 → 必须报 TemplateChildNodes（WXML 的 template 是定义块）', () => {
    const src = '<script setup>\nconst ok = ref(true)\n</script>\n<template><view><template v-if="ok"><view>a</view><view>b</view></template></view></template>'
    expect(() => compileVueSfc(src, opts3), '<template v-if> 片段容器必须在编译期被拦截').toThrow(/TemplateChildNodes/)
    // 对照：改用真实节点（报告给出的正当修法）→ 通过
    const fixedSrc = '<script setup>\nconst ok = ref(true)\n</script>\n<template><view><view v-if="ok"><view>a</view><view>b</view></view></view></template>'
    expect(() => compileVueSfc(fixedSrc, opts3), '改为 <view v-if> 后应通过').not.toThrow()
  })

  it('③ 常见 HTML 标签自动映射为 WXML 等价结构（不再原样进产物）', () => {
    const pairs: Array<[string, string]> = [
      ['<details><summary>s</summary></details>', 'view'],
      ['<strong>t</strong>', 'text'],
      ['<pre>code</pre>', 'text'],
      ['<table><tr><td>c</td></tr></table>', 'view'],
      ['<select><option>a</option></select>', 'view'],
      ['<header>h</header>', 'view'],
      ['<ul><li>i</li></ul>', 'view'],
      ['<br/>', 'view'],
    ]
    for (const [frag, expected] of pairs) {
      const src = `<script setup>\nconst dummy = 1\n</script>\n<template><view>${frag}</view></template>`
      const r = compileVueSfc(src, opts3)
      // 原标签不得残留
      const tagName = /^<([a-z]+)/.exec(frag)?.[1] ?? ''
      expect(r.wxml, `<${tagName}> 不应原样进产物`).not.toMatch(new RegExp(`<${tagName}[\\s>]`))
      expect(r.wxml, `<${tagName}> 应映射为 <${expected}>`).toContain(`<${expected}`)
    }
  })

  it('③ 未映射的 HTML 标签 → 报 UnknownHtmlTag（而非静默原样输出）', () => {
    // `scanWxmlPlatformIssues` 是**产物侧兜底**：作用于已生成的 wxml（不经过 TAG_MAP 映射）。
    // 故直接喂一个含 HTML 标签的 wxml，模拟「映射表遗漏 / 未来新增 HTML 标签」的形态。
    const wxml = '<view><header>h</header><details><summary>s</summary></details></view>'
    const issues = scanWxmlPlatformIssues(wxml)
    expect(issues.map((i) => i.code)).toContain('UnknownHtmlTag')
    // kebab-case 自定义组件不受影响（避免误伤）
    expect(scanWxmlPlatformIssues('<view><my-widget /></view>').map((i) => i.code)).not.toContain('UnknownHtmlTag')
    expect(scanWxmlPlatformIssues('<view><p-view /></view>').map((i) => i.code)).not.toContain('UnknownHtmlTag')
  })

  it('正常产物零命中（回归边界——校验不得误报）', () => {
    const src = '<script setup>\nconst ok = ref(true)\nconst n = ref(1)\n</script>\n<template><view class="page"><text v-if="ok">{{ n }}</text><view v-for="i in [1,2]" :key="i"><text>{{ i }}</text></view><p-view>x</p-view></view></template>'
    const r = compileVueSfc(src, opts3)
    const codes = scanWxmlPlatformIssues(r.wxml).map((i) => i.code)
    expect(codes).toEqual([])
  })
})

// ★2026-09-20 外部实战报告 F-31：store 识别依赖**未文档化的硬编码命名**
//   （变量名必须为 `store` **且** 工厂名匹配 `use*Store()`）——
//   而 Pinia 官方对变量名/工厂名无任何约定（`const s = useSession()` 完全合法）
//   → 外部工程**全工程 store 绑定静默失效**（模板拿不到值、零告警）。
//   修法：放宽（唯一候选即可）+ 未识别时**告警**（静默失败一律归框架）。
describe('★store 识别（F-31）：放宽判据 + 未识别时告警', () => {
  const O = { px2rpx: true, rpxRatio: 2 } as never
  const binds = { storeBindings: ['projects'] } as never

  it('精确形态（store + useXxxStore）仍识别，且**不产生 store 识别告警**', () => {
    const r = transformScriptToPage('const store = usePlayerStore()\nconst dummy = 1', O, { file: 't.vue', ...(binds as object) } as never)
    expect(r.js, '应生成 store 订阅').toMatch(/\$subscribe|__proteusStoreUnsub/)
    // 注意：此处只断言「无 store 识别失败告警」——runtimeInit 另有一条「函数调用初始化」告警属既有行为
    const ws = (r.warnings ?? []).join('\n')
    expect(ws, '精确匹配不应报「未能识别出 store」').not.toMatch(/未能识别出 store/)
  })

  it('★放宽：变量名非 store、但只有唯一 useXxxStore() 候选 → 仍识别（变量名不再是门槛）', () => {
    const r = transformScriptToPage('const s = usePlayerStore()\nconst dummy = 1', O, { file: 't.vue', ...(binds as object) } as never)
    expect(r.js, '唯一候选应被识别').toMatch(/\$subscribe|__proteusStoreUnsub/)
  })

  it('★未识别时**必须告警**（不能静默失效）', () => {
    const r = transformScriptToPage('const s = useSession()\nconst dummy = 1', O, { file: 't.vue', ...(binds as object) } as never)
    const ws = (r.warnings ?? []).join('\n')
    expect(ws, '模板引用了 store 字段但未识别出 store → 必须告警').toMatch(/store/)
    expect(ws).toMatch(/useXxxStore|变量名为 store|不会生效/)
  })

  it('未引用 store 字段时不报「未能识别出 store」（回归边界）', () => {
    const r = transformScriptToPage('const s = useSession()\nconst dummy = 1', O, { file: 't.vue' } as never)
    expect((r.warnings ?? []).join('\n')).not.toMatch(/未能识别出 store/)
  })
})

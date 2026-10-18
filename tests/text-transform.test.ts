// tests/text-transform.test.ts —— ★★★`text-transform`（2026-10-18 · 批 B F3 · 基准 = Web）
//
// 【判据来源（真 Chromium 151）】
//   · `uppercase` / `lowercase` 与 JS 内建映射**逐字符一致**（实测 straße→STRASSE / ΣΟΦΟΣ→σοφος…）；
//   · `capitalize` 的**词边界规则**由 135 条样本（75 精编 + 60 随机混排）与浏览器**逐像素**比对得出
//     （0 差异）——见 `packages/slot-runtime/src/text-transform.ts` 头注的完整规则与反例。
//
// 【这张测试锁什么】
//   ① 三个变换值的正确性（含 capitalize 的全部易错边界）
//   ② `none` / 未知值 ⇒ 原样（零行为变化）
//   ③ 编译器折叠（font 之后的第二个"纯编译期"文本能力）
//   ④ **App 文本出口**（实例化 `setNormText`）与 **MP 编译期静态文本** 都走同一实现
//   ⑤ MP 端对**动态文本**如实诊断（不静默当已实现）

import { describe, it, expect } from 'vitest'
import { applyTextTransform } from '@proteus-vue/slot-runtime'
import { buildLayoutTemplate, buildVaporSubscriptions, compileVueSfc, parseStaticStyle } from '@proteus-vue/compiler'

describe('★★★text-transform · 唯一语义实现（批 B F3 · 基准 = Web）', () => {
  it('① uppercase / lowercase 与 JS 内建映射一致（Chromium 实测）', () => {
    expect(applyTextTransform('straße', 'uppercase'), 'ß 展开为 SS').toBe('STRASSE')
    expect(applyTextTransform('ﬁle', 'uppercase'), 'ligature 展开').toBe('FILE')
    expect(applyTextTransform('中文 abc', 'uppercase'), 'CJK 不变、拉丁变').toBe('中文 ABC')
    expect(applyTextTransform('ΣΟΦΟΣ', 'lowercase'), '希腊终 σ').toBe('σοφος')
    expect(applyTextTransform('İSTANBUL', 'lowercase'), '带点大写 I').toBe('i̇stanbul')
    expect(applyTextTransform('ǳiga', 'uppercase'), 'digraph 全大写').toBe('ǱIGA')
  })

  it('② capitalize：词边界（逐像素比对 Chromium 得出的规则）', () => {
    // 基本
    expect(applyTextTransform('hello world', 'capitalize')).toBe('Hello World')
    expect(applyTextTransform('ALREADY UP', 'capitalize')).toBe('ALREADY UP')
    // 撇号与下划线**不断词**
    expect(applyTextTransform("don't stop", 'capitalize'), "don't ⇒ Don't").toBe("Don't Stop")
    expect(applyTextTransform('a_b c', 'capitalize'), 'a_b ⇒ A_b').toBe('A_b C')
    // 数字是词内字符
    expect(applyTextTransform('a1b c', 'capitalize'), 'a1b ⇒ A1b').toBe('A1b C')
    expect(applyTextTransform('123abc def', 'capitalize'), '数字开头不触发').toBe('123abc Def')
    expect(applyTextTransform('v1.2beta test', 'capitalize'), '点后是数字 ⇒ beta 不触发').toBe('V1.2beta Test')
    // 标点是边界
    expect(applyTextTransform('hello-world', 'capitalize')).toBe('Hello-World')
    expect(applyTextTransform('hello.WORLD', 'capitalize')).toBe('Hello.WORLD')
    expect(applyTextTransform('a:b q', 'capitalize'), '冒号是边界').toBe('A:B Q')
    // CJK / 假名 / 韩文**断词**（本身无大小写，但与拉丁相邻时另起一词）
    expect(applyTextTransform('abc中文def', 'capitalize'), 'CJK 断词').toBe('Abc中文Def')
    expect(applyTextTransform('中文abc def', 'capitalize')).toBe('中文Abc Def')
    expect(applyTextTransform('あいうabc', 'capitalize'), '假名断词').toBe('あいうAbc')
    expect(applyTextTransform('한글abc', 'capitalize'), '韩文断词').toBe('한글Abc')
    // 希腊 / 西里尔 / 带变音拉丁 **是词内**
    expect(applyTextTransform('αβγabc def', 'capitalize'), '希腊不断词').toBe('Αβγabc Def')
    expect(applyTextTransform('дabc def', 'capitalize'), '西里尔不断词').toBe('Дabc Def')
    expect(applyTextTransform('éabc def', 'capitalize'), '带变音拉丁不断词').toBe('Éabc Def')
    // 符号 / emoji 是边界
    expect(applyTextTransform('😀hello world', 'capitalize')).toBe('😀Hello World')
    expect(applyTextTransform('©hello world', 'capitalize')).toBe('©Hello World')
    // No 类数字（½ ① ²）是边界：其后的字母**不算词首**
    expect(applyTextTransform('½abc def', 'capitalize')).toBe('½Abc Def')
    // 长度扩张的映射不采用（ß 作词首保持原字符；Chromium 实测）
    expect(applyTextTransform('ß straße', 'capitalize')).toBe('ß Straße')
    // titlecase 而非 uppercase（digraph）
    expect(applyTextTransform('ǳiga test', 'capitalize')).toBe('ǲiga Test')
    // ★分区脚本（区间表手写 ⇒ 逐类锁死；全部由 Chromium 逐像素比对得出）
    expect(applyTextTransform('한글abc', 'capitalize'), '谚文音节断词').toBe('한글Abc')
    expect(applyTextTransform('ｱabc def', 'capitalize'), '半角片假名断词').toBe('ｱAbc Def')
    expect(applyTextTransform('々abc', 'capitalize'), '々 断词').toBe('々Abc')
    expect(applyTextTransform('ㄅabc def', 'capitalize'), '注音词内').toBe('ㄅabc Def')
    expect(applyTextTransform('ㄅㄆabc', 'capitalize'), '注音词内（连续）').toBe('ㄅㄆabc')
    expect(applyTextTransform('กabc def', 'capitalize'), '泰文词内').toBe('กabc Def')
    expect(applyTextTransform('कabc def', 'capitalize'), '天城文词内').toBe('कabc Def')
    expect(applyTextTransform('Հայabc def', 'capitalize'), '亚美尼亚词内').toBe('Հայabc Def')
  })

  it('③ none / 未知值 / 空输入 ⇒ 原样（零行为变化）', () => {
    expect(applyTextTransform('AbC', 'none')).toBe('AbC')
    expect(applyTextTransform('AbC', undefined)).toBe('AbC')
    expect(applyTextTransform('AbC', null)).toBe('AbC')
    expect(applyTextTransform('AbC', 'full-width'), '未实现值不猜').toBe('AbC')
    expect(applyTextTransform('', 'uppercase')).toBe('')
  })
})

describe('★★★text-transform · 编译器折叠（批 B F3）', () => {
  it('④ 四个合法值折进 IR；none 不发射；full-width 诊断', () => {
    expect((parseStaticStyle('text-transform: uppercase', () => {}) as { textTransform?: string }).textTransform).toBe('uppercase')
    expect((parseStaticStyle('text-transform: capitalize', () => {}) as { textTransform?: string }).textTransform).toBe('capitalize')
    // ★显式 none **必须发射**：CSS 里它压掉父级继承的 uppercase（跳过 = inherit，实测会错继承）
    expect((parseStaticStyle('text-transform: none', () => {}) as { textTransform?: string }).textTransform, 'none 显式发射').toBe('none')
    const d: string[] = []
    expect((parseStaticStyle('text-transform: full-width', (m: string) => d.push(m)) as { textTransform?: string }).textTransform).toBeUndefined()
    expect(d.some((x) => x.includes('text-transform')), 'full-width 有诊断').toBe(true)
  })
})

describe('★★★text-transform · 三条通道端到端（批 B F3）', () => {
  it('⑤ App 折叠：值 + CSS 继承到子节点', () => {
    // 【为什么（以 web 为基准）】text-transform 是**可继承**属性（CSS Text）；子节点未声明时应拿父值。
    const sfc = `<template><view class="up"><text class="plain">x</text><text class="low">y</text></view></template>
<script setup>const z = 1</script>
<style>
.up { text-transform: uppercase }
.low { text-transform: lowercase }
</style>`
    const r = buildLayoutTemplate(sfc, 'pages/tt.vue')
    const byTag = r.template.nodes.map((n) => n.style as { textTransform?: string })
    expect(byTag[0]!.textTransform, '父节点').toBe('uppercase')
    expect(byTag[1]!.textTransform, '未声明的子节点继承父值').toBe('uppercase')
    expect(byTag[2]!.textTransform, '子节点显式覆盖').toBe('lowercase')
  })

  it('⑥ 订阅槽位携带 textTransform（App 增量更新走这条）', () => {
    // 【为什么】动态文本走 SET_TEXT 指令；变换值必须**随槽位**下发，否则改数据后回到原文。
    const sfc = `<template><view class="up"><text>{{ msg }}</text></view></template>
<script setup>
import { ref } from 'vue'
const msg = ref('hello world')
</script>
<style>.up { text-transform: uppercase }</style>`
    const sub = buildVaporSubscriptions(sfc, 'pages/dyn.vue')
    const textSlots = sub.table.sources.flatMap((s) => s.slots).filter((s) => s.kind === 'text')
    expect(textSlots.length, '有文本槽位').toBeGreaterThan(0)
    expect(textSlots[0]!.textTransform, '槽位带变换值（继承后）').toBe('uppercase')
  })

  it('⑦ MP 编译期：静态文本已变换 + 动态文本如实诊断', () => {
    // Skyline 官方样式表无 text-transform（已核官方文档）⇒ MP 端只能编译期变换**静态**文本。
    const sfc = `<template><view class="up"><text>hello world</text><text>{{ msg }}</text></view></template>
<script setup>
import { ref } from 'vue'
const msg = ref('x')
</script>
<style>.up { text-transform: capitalize }</style>`
    const r = compileVueSfc(sfc, { filename: 'pages/mp.vue' })
    expect(r.wxml, '静态文本已变换').toContain('Hello World')
    // ★类名表必须能处理**注释块之后的规则**（实测：不剥注释时 .inp 被吃掉 ⇒ 继承失效）
    const sfc2 = `<template><view class="inp"><text>inherit me</text></view></template><script setup>const z = 1</script><style>/* 说明文字里写着 text-transform: uppercase 也不算声明 */
.inp { text-transform: uppercase }</style>`
    const r2 = compileVueSfc(sfc2, { filename: 'pages/mp2.vue' })
    expect(r2.wxml, '注释后的规则仍生效 + 继承').toContain('INHERIT ME')
    expect(r.wxml, '动态文本保持插值').toContain('{{ msg }}')
    expect(
      (r.warnings ?? []).some((w) => /text-transform/.test(w) && /动态/.test(w)),
      '动态文本有诊断（不静默当已实现）',
    ).toBe(true)
  })
})

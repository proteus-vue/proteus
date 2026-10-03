// tests/vapor-directives.test.ts —— ★★★P3-5 **宿主指令（v-animate）**判据（2026-10-03）
//
// 【这一批补的是什么（P3-5 自定义指令）】Vue 的自定义指令 = **用户脚本**
//   （`directive.mounted(el, binding)`），而 Vapor 端上**不执行 script**（架构分工）
//   ⇒ 不能"支持任意自定义指令"，但可以把指令的**意图**收敛成**闭集注册表**：
//   注册表内的名字 → 映射到**已有宿主能力**；表外的名字 → 精确诊断（说明"指令体不会运行"+ 给替代路径）。
//   首批一条：`v-animate`（映射到内核动画通道 `animStart`——与 `<Transition>` 同一套，零新增平台能力）。
//
// 【判据打在三处】① 编译：预设 → **通道规格**（不是只记名字；与 TRANSITION_PRESETS 同源）；
//   ② 值语义（`directiveShouldPlay` 纯函数：mounted/updated/falsy 三态）；
//   ③ 诊断形态（表外指令 / 未知预设 / 修饰符 / 行内 / 值表达式编不出——五类都有精确文案）。

import { describe, it, expect } from 'vitest'
import { buildLayoutTemplate } from '@proteus-vue/compiler'
import { HOST_DIRECTIVE_NAMES, HOST_DIRECTIVE_SPECS, isHostDirective, directiveShouldPlay } from '@proteus-vue/slot-runtime'

const sfc = (tpl: string, script = 'const pulse = ref(false)\nconst x = ref(1)\nconst list = ref([{ id: 1 }])\n'): string =>
  `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

describe('★P3-5 宿主指令 · 注册表（唯一事实来源在运行时包）', () => {
  it('注册表至少含 v-animate，且声明带参数语义与说明', () => {
    expect(HOST_DIRECTIVE_NAMES).toContain('animate')
    expect(isHostDirective('animate')).toBe(true)
    expect(isHostDirective('focus')).toBe(false)
    const spec = HOST_DIRECTIVE_SPECS.animate!
    expect(spec.argKind).toBe('anim-preset')
    expect(spec.argHint).toContain('fade')
    expect(spec.desc).toContain('<Transition>')  // 语义与过渡同源（审计可查）
  })
})

describe('★P3-5 宿主指令 · 编译（预设 → 通道规格）', () => {
  it('`v-animate:fade="pulse"` ⇒ 通道规格 + 值程序（与 TRANSITION_PRESETS 同源）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view><p-text v-animate:fade="pulse">a</p-text></p-view>`), 'p.vue')
    const d = t.template.nodes[1]!.directives!
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ name: 'animate', preset: 'fade', arg: 'fade' })
    // ★关键：**通道规格**在（不是只记名字——只记名字 = 无处可播）
    expect(d[0]!.channels!.length).toBeGreaterThan(0)
    expect(d[0]!.channels![0]).toEqual({ kind: 4, from: 0, to: 1 })  // fade = kind 4 / 0→1
    expect(d[0]!.valueSrc).toBe('pulse')
    expect(d[0]!.value).toBeTruthy()
    // 预设合法 ⇒ 无诊断
    expect(t.diagnostics.map((x) => x.code)).not.toContain('VAPOR_DIRECTIVE_UNKNOWN_ARG')
  })

  it('无参数 ⇒ 缺省 fade；无值 ⇒ 无 value（恒真语义）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view><p-text v-animate>a</p-text></p-view>`), 'p.vue')
    const d = t.template.nodes[1]!.directives![0]!
    expect(d.preset).toBe('fade')
    expect(d.value).toBeUndefined()
  })

  it('★五类诊断各就各位（表外 / 未知预设 / 修饰符 / 行内 / 值编不出）', () => {
    const codes = (tpl: string, script?: string): string[] =>
      buildLayoutTemplate(sfc(tpl, script), 'p.vue').diagnostics.map((d) => d.code)

    // ① 表外指令（端上不执行 script ⇒ 指令体不会运行）
    const c1 = codes(`<p-view><p-text v-focus>a</p-text></p-view>`)
    expect(c1).toContain('VAPOR_DIRECTIVE_NOT_REGISTERED')
    // ② 未知预设
    const c2 = codes(`<p-view><p-text v-animate:nope="x">a</p-text></p-view>`)
    expect(c2).toContain('VAPOR_DIRECTIVE_UNKNOWN_ARG')
    // ③ 修饰符（无定义语义——已忽略但要可见）
    const c3 = codes(`<p-view><p-text v-animate:fade.mod="x">a</p-text></p-view>`)
    expect(c3).toContain('VAPOR_DIRECTIVE_MODIFIERS')
    // ④ 行内（v-for 里）
    const c4 = codes(`<p-view><p-text v-for="it in list" :key="it.id" v-animate="x">a</p-text></p-view>`)
    expect(c4).toContain('VAPOR_DIRECTIVE_IN_LIST')
    // ⑤ 值表达式编不出（调用表达式）
    const c5 = codes(`<p-view><p-text v-animate:fade="f()">a</p-text></p-view>`)
    expect(c5).toContain('VAPOR_DIRECTIVE_VALUE_UNSUPPORTED')
  })

  it('★诊断文案：表外指令要说清"为什么不支持"与"能用什么"', () => {
    const d = buildLayoutTemplate(sfc(`<p-view><p-text v-focus>a</p-text></p-view>`), 'p.vue')
      .diagnostics.find((x) => x.code === 'VAPOR_DIRECTIVE_NOT_REGISTERED')!
    expect(d.message).toContain('不执行 script')
    expect(d.hint).toContain('v-animate')   // 列出注册表里可用的名字
  })

  it('★反向：无指令的模板不产出 directives 字段（既有产物逐字节不变）', () => {
    const t = buildLayoutTemplate(sfc(`<p-view><p-text>a</p-text></p-view>`), 'p.vue')
    expect(t.template.nodes.every((n) => n.directives === undefined)).toBe(true)
  })
})

describe('★P3-5 宿主指令 · 值语义（directiveShouldPlay 纯函数）', () => {
  it('首评 truthy ⇒ 播（mounted 语义）', () => {
    expect(directiveShouldPlay(undefined, true, false)).toBe(true)
    expect(directiveShouldPlay(undefined, 1, false)).toBe(true)
  })

  it('★首评 falsy ⇒ 不播（falsy 一律不播）', () => {
    expect(directiveShouldPlay(undefined, false, false)).toBe(false)
    expect(directiveShouldPlay(undefined, 0, false)).toBe(false)
    expect(directiveShouldPlay(undefined, '', false)).toBe(false)
  })

  it('★值变化且 truthy ⇒ 播（updated 语义）', () => {
    expect(directiveShouldPlay(false, true, true)).toBe(true)
    expect(directiveShouldPlay(0, 1, true)).toBe(true)
  })

  it('★同值 ⇒ 不播（updated 只在**变化**时触发——防每帧重复播放）', () => {
    expect(directiveShouldPlay(true, true, true)).toBe(false)
    expect(directiveShouldPlay(1, 1, true)).toBe(false)
  })

  it('★变化为 falsy ⇒ 不播（e 轮：pulse true→false）', () => {
    expect(directiveShouldPlay(true, false, true)).toBe(false)
  })
})

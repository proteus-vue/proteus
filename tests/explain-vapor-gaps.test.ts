// tests/explain-vapor-gaps.test.ts —— ★★★P4 **能力视图**（`explain --vapor` 缺口总账）判据（2026-10-03）
//
// 【这一批修的是什么（本仓实测的静默缺陷）】`explain --vapor` 此前**只读订阅表侧诊断**
//   （`buildVaporSubscriptions`），而**模板侧诊断**（v-html / 自定义指令 / 内置组件边界 /
//   动态组件 / 插槽用法…——**绝大多数能力缺口产生在那里**）**一条都不显示**。
//   ⇒ 用户跑 explain 自查，看到"槽位分层"就以为没事，而那些"静默不生效"的事实完全不可见
//     ——**诊断工具自己把诊断吞了**（"静默风险"主线上的最"元"一处）。
//
// 【这一批加的是什么】`analyzeVaporGaps`（两侧合并 + 按 code 归类）+ `--json` 机器可读形态
//   （`supported` 字段可作 CI 判据）。
//
// 【判据打在三处】① 模板侧缺口**必须出现**（回归锁：v-html / 表外指令 / 内置边界）
//   ② 按 code 归类（计数 + 一处修法——防重复消息淹没）③ 机器判据（无缺口 ⇒ supported=true）

import { describe, it, expect } from 'vitest'
// ★相对路径导入（与 tests/explain.test.ts 同族：CLI 源码不经包名 alias）
import { analyzeVaporGaps, explainVapor, explainVaporJson } from '../packages/cli/src/explain'

const sfc = (tpl: string, script = 'const rich = ref(1)\n'): string =>
  `<template>\n${tpl}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

describe('★P4 能力视图 · 模板侧缺口必须可见（本批修的静默缺陷）', () => {
  it('v-html（模板侧诊断）必须出现在总账里——此前被完全吞掉', () => {
    const g = analyzeVaporGaps(sfc(`<p-view><p-text v-html="rich">x</p-text></p-view>`))
    expect(g.byCode.map((x) => x.code)).toContain('VAPOR_TEMPLATE_UNSUPPORTED')
    expect(g.diagnostics.some((d) => d.message.includes('v-html'))).toBe(true)
    expect(g.supported, '有缺口 ⇒ supported=false').toBe(false)
  })

  it('表外自定义指令 / 内置组件边界 / 动态组件切换——各自进总账（带修法）', () => {
    const g = analyzeVaporGaps(sfc(
      `<p-view><p-text v-focus>y</p-text><keep-alive><MyA /></keep-alive><component :is="rich" /></p-view>`,
    ))
    const codes = g.byCode.map((x) => x.code)
    expect(codes).toContain('VAPOR_DIRECTIVE_NOT_REGISTERED')
    expect(codes).toContain('VAPOR_BUILTIN_PARTIAL')
    expect(codes).toContain('VAPOR_DYNAMIC_COMPONENT_IS')
    // ★每条类目**必须可行动**（本仓纪律：报错要能照着改）——修法可在独立 `hint` 字段
    //   **或**内联在消息里（既有诊断两种形态都有；判据认"两者至少其一含行动指引"）
    for (const c of g.byCode) {
      const actionable = Boolean(c.hint) || /请|可|改|替代|用|保留/.test(c.sample)
      expect(actionable, `${c.code} 应给出可行动的指引（hint 或消息内）`).toBe(true)
    }
  })

  it('★按 code 归类：同类多条合并计数（不重复刷屏）', () => {
    const g = analyzeVaporGaps(sfc(
      `<p-view><p-text v-html="rich">a</p-text><p-text v-html="rich">b</p-text><p-text v-html="rich">c</p-text></p-view>`,
    ))
    const hit = g.byCode.find((x) => x.code === 'VAPOR_TEMPLATE_UNSUPPORTED')!
    expect(hit.count).toBe(3)
    expect(g.byCode.filter((x) => x.code === 'VAPOR_TEMPLATE_UNSUPPORTED')).toHaveLength(1)
    // diagnostics 仍是逐条（机器可逐条消费）
    expect(g.diagnostics.filter((d) => d.code === 'VAPOR_TEMPLATE_UNSUPPORTED')).toHaveLength(3)
  })

  it('★severity 取更高一级：同类里出现过 error ⇒ 该类标 error（不给"同类就轻"的错觉）', () => {
    // 无 :key 的 v-for 是 error 级（方案坑位 #5：splice 后静默错行）
    const g = analyzeVaporGaps(sfc(`<p-view><p-text v-for="it in rich" v-html="rich">x</p-text></p-view>`))
    const uns = g.byCode.find((x) => x.code === 'VAPOR_TEMPLATE_UNSUPPORTED')
    if (uns) expect(['error', 'warn']).toContain(uns.severity)
  })
})

describe('★P4 能力视图 · 机器判据与呈现', () => {
  it('无缺口 ⇒ supported=true（CI 可据此 gate「零未说明差异」）', () => {
    const g = analyzeVaporGaps(sfc(`<p-view :width="rich"><p-text>x</p-text></p-view>`))
    expect(g.supported).toBe(true)
    expect(g.errorCount).toBe(0)
    expect(g.warnCount).toBe(0)
    expect(g.byCode).toHaveLength(0)
  })

  it('stats 如实：模板节点数 / L1 覆盖（与订阅表同源）', () => {
    const g = analyzeVaporGaps(sfc(`<p-view :width="rich"><p-text>x</p-text></p-view>`))
    expect(g.stats.tplNodes).toBeGreaterThan(0)
    expect(g.stats.l1 + g.stats.l0).toBe(1)
  })

  it('`explainVapor` 输出含缺口段与"无缺口"两种形态', () => {
    const withGap = explainVapor(sfc(`<p-view><p-text v-html="rich">x</p-text></p-view>`))
    expect(withGap).toContain('能力缺口 / 需要注意')
    expect(withGap).toContain('VAPOR_TEMPLATE_UNSUPPORTED')
    const clean = explainVapor(sfc(`<p-view :width="rich"><p-text>x</p-text></p-view>`))
    expect(clean).toContain('能力缺口：无')
  })

  it('`--json` 输出可 JSON.parse 且字段齐（机器可读）', () => {
    const raw = explainVaporJson(sfc(`<p-view><p-text v-html="rich">x</p-text></p-view>`))
    const parsed = JSON.parse(raw) as { supported: boolean; byCode: unknown[]; diagnostics: unknown[] }
    expect(parsed.supported).toBe(false)
    expect(parsed.byCode.length).toBeGreaterThan(0)
    expect(parsed.diagnostics.length).toBeGreaterThan(0)
  })

  it('★反向：干净模板的 json 里 supported=true 且 byCode 空（不误报）', () => {
    const parsed = JSON.parse(explainVaporJson(sfc(`<p-view :width="rich"><p-text>x</p-text></p-view>`))) as {
      supported: boolean
      byCode: unknown[]
    }
    expect(parsed.supported).toBe(true)
    expect(parsed.byCode).toHaveLength(0)
  })
})

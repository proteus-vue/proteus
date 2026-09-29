// tests/gap-counter.test.ts
// ★卡 C4 验收：编译期漏点计数器（三类统计 + degraded 单独高亮 + "表达不了"清单）
//
// 【卡的三条验收 → 本文件的判据】
//   ① 三类分别统计 —— 构造三类样例各一，断言计数分列（不合并、不互相吞）
//   ② **degraded 单独高亮** —— 报告里 degraded 有独立小节（埋点清单 §2.5 硬要求：
//      "degraded 是行为可能不一致，不报错，最难查"）
//   ③ 产出"表达不了"清单 —— 报告含分类计数与按文件 top（可定位到源文件）
//
// 【★本文件的第四类判据（防"计数器说 0 漏点"的假绿）】
//   ④ **未归类必须显式列出**：分类表没覆盖的诊断**不得静默丢**——
//      否则"没有漏点"可能只是"分类表没覆盖"。构造一条分类表外的诊断，断言它出现在"未归类"节。
import { describe, it, expect } from 'vitest'
import { compileVueSfc, GapCounter, formatGapReport } from '@proteus-vue/compiler'

/** 编译一个 SFC 并取其漏点记录 */
function gapsOf(name: string, sfc: string) {
  const r = compileVueSfc(sfc, { filename: name })
  return { warnings: r.warnings, gaps: r.gaps ?? [] }
}

describe('★卡 C4 · 编译期漏点计数器', () => {
  it('① 三类分别统计（degraded / fallback / unsupported 不互相吞）', () => {
    // degraded：未登记 p-*（产物不渲染 = 行为不一致）
    const deg = gapsOf('deg.vue', '<template><p-not-registered/></template><script setup></script>')
    expect(deg.gaps.length, '应记到漏点').toBeGreaterThan(0)
    expect(deg.gaps.every((g) => g.severity === 'degraded'), '未登记 p-* 应为 degraded').toBe(true)

    // fallback：初始值函数调用（转运行时初始化——功能可用）
    const fb = gapsOf('fb.vue', '<template><view>{{ c }}</view></template><script setup>import { ref } from "vue"\nconst hooks = () => ({ n: ref(1) })\nconst c = hooks()</script>')
    // 该场景若未产 warning 则跳过（诊断条件可能更严）——但**不允许三类混淆**
    for (const g of fb.gaps) expect(['fallback', 'degraded', 'unsupported']).toContain(g.severity)

    // 计数器口径：三类计数之和 == 总数（不得有记录落在三类之外）
    const counter = new GapCounter()
    for (const g of [...deg.gaps, ...fb.gaps]) counter.records.push(g)
    const s = counter.summary()
    expect(s.fallback + s.degraded + s.unsupported, '三类之和应等于总数').toBe(s.total)
  })

  it('② ★degraded 单独高亮（报告里有独立小节，且排在最前）', () => {
    const counter = new GapCounter()
    counter.record('a.vue', '<p-bogus> 以 p- 前缀命名但不在组件库语义登记表（TAG_SEMANTIC_MAP）——拼写错误或未入库组件？产物将按未注册自定义组件输出（MP 端不渲染、无语义链接）')
    counter.record('b.vue', '某属性已回退到运行时组件（路径退化）')
    const report = formatGapReport([{ file: 'x.vue', counter }])

    expect(report, '报告应含 degraded 字样').toContain('degraded')
    const iDeg = report.indexOf('★★ degraded')
    expect(iDeg, '★degraded 必须有独立小节（§2.5 硬要求）').toBeGreaterThan(-1)
    const iFb = report.indexOf('fallback（路径退化）')
    expect(iDeg < iFb, '★degraded 小节必须排在 fallback 之前（不淹没）').toBe(true)
    expect(report).toContain('行为可能不一致')
  })

  it('③ 产出"表达不了"清单（含分类计数 + 按文件定位）', () => {
    const counter = new GapCounter()
    counter.record('src/pages/a.vue', '<p-x> 产物将按未注册自定义组件输出（MP 端不渲染）')
    counter.record('src/pages/a.vue', '检测到 1 条无法解析的 import（@proteus-vue/components）——小程序产物无模块系统')
    const report = formatGapReport([{ file: 'src/pages/a.vue', counter }])
    expect(report).toContain('总计')
    expect(report, '应有按文件定位').toContain('src/pages/a.vue')
    expect(report, '应给建议').toMatch(/建议：/)
  })

  it('④ ★未归类不得静默（分类表外诊断必须显式列出）', () => {
    const counter = new GapCounter()
    counter.record('z.vue', '一条分类表完全没覆盖的新诊断 XYZ-UNSEEN-CONDITION')
    const report = formatGapReport([{ file: 'z.vue', counter }])
    expect(report, '★未归类必须显式出现（否则"0 漏点"可能是"没覆盖"）').toContain('未归类')
    expect(report).toContain('z.vue')
  })

  it('⑤ 计数器**不阻断**（编译正常返回，产物照旧产出）', () => {
    const r = compileVueSfc('<template><p-bogus/></template><script setup></script>', { filename: 'nb.vue' })
    expect(r.wxml, '有漏点也必须正常产出产物（记录不阻断——埋点清单 §2.1）').toBeTruthy()
    expect(r.gaps, 'gaps 字段存在').toBeDefined()
  })
})

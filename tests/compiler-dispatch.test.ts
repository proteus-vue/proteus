// tests/compiler-dispatch.test.ts
// ★阶段三分派层验证（底线循环 ① 完全形态）：
//   AI 覆盖规则的 apply() → 编译输出即时变化，无需改框架代码（规则注册表升级为分派层）
import { describe, it, expect } from 'vitest'
import { compileVueSfc, transformStyleToWxss, formatTransformCatalog } from '../packages/compiler/src'
import { getTransformRule, executeRule, listTransformRules } from '../packages/compiler/src/transforms/registry'
import type { RuleContext } from '../packages/compiler/src/transforms/types'

describe('分派层 executeRule', () => {
  it('已登记 apply 的规则可经分派层执行', () => {
    const ctx: RuleContext = { input: '.a { width: 10px; }', options: { rpxRatio: 2 } }
    executeRule('style/px-to-rpx', ctx)
    expect(ctx.output).toBe('.a { width: 20rpx; }')
  })

  it('未登记 apply 的规则 → 抛错并提示跳读 source（描述层规则）', () => {
    // 找一条无 apply 的规则（注册表大部分规则仍为描述层）
    const noApply = listTransformRules().find((r) => !r.apply)
    expect(noApply).toBeDefined()
    expect(() => executeRule(noApply!.id, { input: 'x' })).toThrow(/未登记 apply/)
  })

  it('未知规则 ID → 抛错（防笔误）', () => {
    expect(() => executeRule('style/not-exist', { input: 'x' })).toThrow(/未知规则 ID/)
  })

  it('formatTransformCatalog 标注已分派规则', () => {
    const catalog = formatTransformCatalog()
    expect(catalog).toContain('已分派 apply')
  })
})

describe('★底线循环 ①：AI 覆盖规则 apply → 新能力即生效', () => {
  it('覆盖 px-to-rpx 的 apply（自定义换算）→ 编译输出即时变化', () => {
    const rule = getTransformRule('style/px-to-rpx')!
    const original = rule.apply
    try {
      // ★模拟 AI 写的新规则实现：px → vw 风格（750 设计稿 1px = 0.1333vw），替换原 rpx 换算
      rule.apply = (ctx) => {
        const input = ctx.input as string
        ctx.output = input.replace(/(\d+(?:\.\d+)?)px\b/g, (_m: string, n: string) => `${(Number(n) / 7.5).toFixed(2)}vw`)
      }
      const wxss = transformStyleToWxss('.a { width: 75px; }', { px2rpx: true, rpxRatio: 2 })
      expect(wxss).toContain('width: 10.00vw') // AI 规则生效（原逻辑输出 150rpx）
    } finally {
      rule.apply = original // 恢复（防污染其他测试）
    }
  })

  it('覆盖 scope-attr 的 apply（改属性名）→ 模板输出即时变化', () => {
    const rule = getTransformRule('template/scope-attr')!
    const original = rule.apply
    try {
      // ★模拟 AI 改规则：作用域属性从 data-v-xxx 改为 scoped-xxx
      rule.apply = (ctx) => {
        const input = ctx.input as { tag: string; scopeId: string }
        ctx.output = input.scopeId.replace(/^data-/, 'scoped-')
      }
      const src = '<template><div class="x"></div></template><style scoped>.a {}</style>'
      const result = compileVueSfc(src, { filename: 'dispatch-test.vue' })
      expect(result.wxml).toContain('scoped-v-')
      expect(result.wxml).not.toContain('data-v-')
    } finally {
      rule.apply = original
    }
  })

  it('覆盖后恢复：原规则行为不变', () => {
    const wxss = transformStyleToWxss('.a { width: 10px; }', { px2rpx: true, rpxRatio: 2 })
    expect(wxss).toContain('width: 20rpx')
  })
})

// tests/css-profile-boundary.test.ts
// ★VC2-b：编译期静态校验（官方 Skyline 支持格式白名单）——单测
//
// 【这份测试在防什么】`overflow: scroll` / `display: grid` 这类"Web 端照常渲染、
//   Skyline 端静默降级"的写法，必须在编译期报错（卡片 VC2-b 的核心诉求）。
//   本档覆盖：越界报错 + 值域/建议四要素 + escape hatch（含空理由不放行）+ 动态值跳过 + 空绿防护。
import { describe, it, expect } from 'vitest'
import { checkProfileBoundary, formatProfileBoundaryViolation, SKYLINE_BOUNDARY_RULES } from '@proteus-vue/css-compat'

describe('VC2-b · Profile 边界校验（Skyline 官方支持格式白名单）', () => {
  it('① 生成的规则集非空（防"零违规 = 没判"的空绿）', () => {
    expect(SKYLINE_BOUNDARY_RULES.length, '边界规则应 ≥ 10 条（官方属性表的纯枚举 formats 派生）').toBeGreaterThanOrEqual(10)
    for (const r of SKYLINE_BOUNDARY_RULES) {
      expect(r.id).toMatch(/^CSS-PB-/)
      expect(r.accept.length).toBeGreaterThanOrEqual(2)
      expect(r.suggestion.length, `${r.id} 建议不应为空`).toBeGreaterThan(0)
      expect(r.source).toContain('官方')
    }
  })

  it('② 越界值报错：overflow: scroll（官方只认 hidden/visible）', () => {
    const r = checkProfileBoundary(`.a { overflow: scroll; }`)
    expect(r.checked, '应判过 1 条静态声明').toBe(1)
    expect(r.violations).toHaveLength(1)
    const v = r.violations[0]!
    expect(v.prop).toBe('overflow')
    expect(v.end).toBe('skyline')
    expect(v.accept).toContain('hidden')
    expect(v.suggestion.length).toBeGreaterThan(0)
    // 卡片要求四要素（属性名 / 越界的端 / 值域 / 替代方案）都在格式化文案里
    const line = formatProfileBoundaryViolation(v)
    expect(line).toContain('overflow')
    expect(line).toContain('skyline')
    expect(line).toContain('hidden')
  })

  it('③ 越界值报错：display: grid（官方只认 none/flex/block）', () => {
    const r = checkProfileBoundary(`.a { display: grid; }`)
    expect(r.violations.some((v) => v.prop === 'display' && v.value === 'grid')).toBe(true)
  })

  it('④ 合法值不报：overflow: hidden / display: flex', () => {
    const r = checkProfileBoundary(`.a { overflow: hidden; display: flex; position: absolute; }`)
    expect(r.checked).toBe(3)
    expect(r.violations).toEqual([])
  })

  it('⑤ 大小写与空白归一：DISPLAY:  Flex 不误报', () => {
    const r = checkProfileBoundary(`.a { DISPLAY:  Flex ; }`)
    expect(r.violations).toEqual([])
  })

  it('⑥ escape hatch：proteus-allow-profile 注释放行且计入 escapes（可审计）', () => {
    const css = `/* proteus-allow-profile: 业务确需 scroll，真机已验证可接受 */
.a { overflow: scroll; }`
    const r = checkProfileBoundary(css)
    expect(r.violations).toEqual([])
    expect(r.escapes, '豁免应计数（卡片要求可被扫描统计）').toBe(1)
  })

  it('⑦ escape hatch 空理由**不放行**（不静默）', () => {
    const css = `/* proteus-allow-profile: */
.a { overflow: scroll; }`
    const r = checkProfileBoundary(css)
    expect(r.violations.length, '空理由视为未声明——仍报错').toBe(1)
    expect(r.escapes).toBe(0)
  })

  it('⑧ 动态值跳过（var()/calc()/模板插值——运行期兜底）', () => {
    const r = checkProfileBoundary(`.a { overflow: var(--o); display: calc(1px + 1px); }`)
    expect(r.checked, '动态值不进 checked').toBe(0)
    expect(r.violations).toEqual([])
  })

  it('⑨ 行号正确（第 3 行的越界声明报 line=3）', () => {
    const css = `.a { color: red; }\n.b { color: blue; }\n.c { overflow: scroll; }`
    const r = checkProfileBoundary(css)
    expect(r.violations[0]!.line).toBe(3)
  })

  it('⑩ 不可判属性（含 <占位符> 的 formats）不产生规则（宁漏勿误）', () => {
    // width 的 formats 含 <length> 占位符 ⇒ 不应有 CSS-PB-width 规则
    expect(SKYLINE_BOUNDARY_RULES.some((r) => r.prop === 'width')).toBe(false)
  })
})

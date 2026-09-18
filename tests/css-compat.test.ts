// tests/css-compat.test.ts
// ★G-21 css-compat B1：--strict-css 校验（CSS001-012）+ 编译期重写 + css-compat-report
import { describe, expect, it } from 'vitest'
import {
  buildCssCompatReport,
  lintStyleCss,
  rewriteStyleCss,
  extractStyleBlocks,
  CSS_RULES,
} from '@proteus-vue/css-compat'

const codes = (css: string, opts?: Parameters<typeof lintStyleCss>[1]) => lintStyleCss(css, opts).map((v) => v.code)

describe('CSS001-012 校验（02-strict-css-lint.md）', () => {
  it('CSS001 float', () => {
    expect(codes('.a { float: left; }')).toContain('CSS001')
  })

  it('CSS002 display: inline/inline-block', () => {
    expect(codes('.a { display: inline; }')).toContain('CSS002')
    expect(codes('.a { display: inline-block; }')).toContain('CSS002')
    expect(codes('.a { display: flex; }')).not.toContain('CSS002')
  })

  it('CSS003 通用选择器 *', () => {
    expect(codes('* { margin: 0; }')).toContain('CSS003')
    expect(codes('.a [data-x] { color: red; }')).not.toContain('CSS003') // 属性选择器内不误伤
  })

  it('CSS004 属性选择器 [attr]', () => {
    expect(codes('.a[data-v] { color: red; }')).toContain('CSS004')
  })

  it('CSS005 元素选择器', () => {
    expect(codes('div { color: red; }')).toContain('CSS005')
    expect(codes('span.btn { color: red; }')).toContain('CSS005')
    expect(codes('.div { color: red; }')).not.toContain('CSS005') // 类名不误伤
  })

  it('CSS006 深层后代组合（超 2 级）', () => {
    expect(codes('.a .b .c { color: red; }')).toContain('CSS006')
    expect(codes('.a .b { color: red; }')).not.toContain('CSS006')
    expect(codes('.a > .b > .c { color: red; }')).toContain('CSS006')
    // ★多行选择器（行首缩进）不误计为组合符（CSS006 19 层误报 bug 回归）
    expect(codes('.fade-enter-active,\n  .fade-leave-active { color: red; }')).not.toContain('CSS006')
  })

  it('CSS007 z-index', () => {
    expect(codes('.a { z-index: 10; }')).toContain('CSS007')
    // ★B1 保守实现无法判定跨父级（精确判定需 IR 上下文）→ strict 下也降级 warn 提示
    const v = lintStyleCss('.a { z-index: 10; }')
    expect(v.find((x) => x.code === 'CSS007')?.severity).toBe('warn')
  })

  it('CSS008 calc()/vh/vw（strict 报错；非 strict 降级 warn + fixable）', () => {
    expect(codes('.a { width: calc(100% - 20px); }')).toContain('CSS008')
    expect(codes('.a { height: 100vh; }')).toContain('CSS008')
    expect(codes('.a { width: calc(100px + 20px); }', { strict: false })).toContain('CSS008')
    const v = lintStyleCss('.a { height: 100vh; }', { strict: false })
    expect(v.find((x) => x.code === 'CSS008')?.severity).toBe('warn')
    // ★min-height: 100vh 弹性安全用法豁免（不会遮挡输入框，仅 height/width 误报）
    expect(codes('.a { min-height: 100vh; }')).not.toContain('CSS008')
    expect(codes('.a { width: 100vw; }')).toContain('CSS008')
  })

  it('CSS009 裸 backdrop-filter', () => {
    expect(codes('.a { backdrop-filter: blur(20px); }')).toContain('CSS009')
  })

  it('CSS010 :nth-child 复杂表达式（:first/:last 豁免）', () => {
    expect(codes('.a:nth-child(2n) { color: red; }')).toContain('CSS010')
    expect(codes('.a:first-child { color: red; }')).not.toContain('CSS010')
    expect(codes('.a:last-child { color: red; }')).not.toContain('CSS010')
  })

  it('CSS011 box-shadow rgba', () => {
    expect(codes('.a { box-shadow: 0 2px 8px rgba(0,0,0,0.5); }')).toContain('CSS011')
  })

  it('CSS012 @media 非白名单（dark/sm/md/lg 豁免）', () => {
    expect(codes('@media (prefers-color-scheme: dark) { .a { color: #fff; } }')).not.toContain('CSS012')
    expect(codes('@media (max-width: 600px) { .a { color: #fff; } }')).toContain('CSS012')
  })

  it('规则注册表 12 条（防漂移：02 表全量）', () => {
    expect(CSS_RULES.map((r) => r.code)).toEqual(
      ['CSS001', 'CSS002', 'CSS003', 'CSS004', 'CSS005', 'CSS006', 'CSS007', 'CSS008', 'CSS009', 'CSS010', 'CSS011', 'CSS012'],
    )
  })
})

describe('编译期重写（03-compile-time-rewrite.md）', () => {
  it('calc 数值折叠（同单位）', () => {
    const { css, rewritten } = rewriteStyleCss('.a { width: calc(100px - 20px); }')
    expect(css).toContain('width: 80px')
    expect(rewritten.calc).toBe(1)
  })

  it('calc 混合单位不折叠（引导 p-*）', () => {
    const { css, rewritten } = rewriteStyleCss('.a { width: calc(100% - 32px); }')
    expect(css).toContain('calc(100% - 32px)')
    expect(rewritten.calc).toBe(0)
  })

  it('vh/vw → %', () => {
    const { css, rewritten } = rewriteStyleCss('.page { height: 100vh; }')
    expect(css).toContain('height: 100%')
    expect(rewritten.vh).toBe(1)
  })

  it('rgba → #RRGGBBAA（alpha 换算）', () => {
    const { css, rewritten } = rewriteStyleCss('.a { color: rgba(0, 0, 0, 0.5); }')
    expect(css).toContain('#00000080') // 0.5*255=127.5 → 128 → 0x80
    expect(rewritten['rgba-to-argb']).toBe(1)
  })
})

describe('css-compat-report（03 §三 结构）', () => {
  it('结构完整 + 计数正确', () => {
    const css = `
      * { margin: 0; }
      .card { float: left; width: calc(100px - 20px); height: 100vh; backdrop-filter: blur(20px); }
    `
    const report = buildCssCompatReport(css)
    expect(report.rewritten.calc).toBe(1)
    expect(report.rewritten.vh).toBe(1)
    expect(report.forbidden.float).toBe(1)
    expect(report.forbidden.universalSelector).toBe(1)
    expect(report.semanticComponents['p-glass']).toBe(1)
    expect(report.bundleCssBytes).toBeGreaterThan(0)
    expect(report.violations.some((v) => v.code === 'CSS001')).toBe(true)
    expect(report.violations.some((v) => v.code === 'CSS003')).toBe(true)
  })

  it('合法 CSS → 零违规（仅语义建议级提示可能存在时也应为空）', () => {
    const report = buildCssCompatReport('.a { display: flex; justify-content: center; gap: 8px; }')
    expect(report.violations.filter((v) => v.severity === 'error')).toHaveLength(0)
  })
})

describe('SFC <style> 提取（CLI 扫描 .vue）', () => {
  it('提取 style 块 + scoped/lang 元信息', () => {
    const blocks = extractStyleBlocks(
      `<template><view class="a" /></template>\n<script setup lang="ts"></script>\n<style scoped>.a { color: red; }</style>`,
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0].content).toContain('.a { color: red; }')
    expect(blocks[0].scoped).toBe(true)
    expect(blocks[0].lang).toBeNull()
  })

  it('多 style 块（含 lang="scss"）', () => {
    const blocks = extractStyleBlocks(
      `<template></template>\n<style>.a { color: red; }</style>\n<style lang="scss">$c: blue; .b { color: $c; }</style>`,
    )
    expect(blocks).toHaveLength(2)
    expect(blocks[1].lang).toBe('scss')
  })
})

// tests/router-check.test.ts
// proteus router:check —— 路由迁移检查器（docs/proteus-router-plan 08-migration Step 1）
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRoutes, formatRouterCheck } from '../packages/cli/src/router-check'
import { parseRouterCheckArgs } from '../packages/cli/src/args'

const FIX = fileURLToPath(new URL('./fixtures/router-plan', import.meta.url))

describe('router:check 迁移检查', () => {
  it('合规页面 → ok + 迁移就绪报告（★约定式路由：无 <route> 块页面也推导收录）', () => {
    const result = checkRoutes(path.join(FIX, 'pages'))
    expect(result.ok).toBe(true)
    expect(result.pageCount).toBe(5) // home / home/profile / user/index / user/order + private（无块推导收录，决策 #112/#113）
    expect(result.errors).toHaveLength(0)
    expect(result.summary.some((s) => s.includes('path 前缀推导') || s.includes('根路由'))).toBe(true) // 嵌套树 trace
    expect(result.summary.some((s) => s.includes('private'))).toBe(true) // 无块页面推导收录 trace
    const report = formatRouterCheck(result)
    expect(report).toContain('router:check ✓')
    expect(report).toContain('<route> 块可选')
  })

  it('非法 <route> → 校验失败 + 精确 loc 报错（页面 .vue 零改动修正提示）', () => {
    const result = checkRoutes(path.join(FIX, 'errors/bad-name'))
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/bad-name/)
    const report = formatRouterCheck(result)
    expect(report).toContain('✗')
    expect(report).toContain('文件:行号')
  })

  it('parseRouterCheckArgs：缺省当前目录 / 显式目录 / 多余参数报错', () => {
    expect(parseRouterCheckArgs([]).pagesDir).toBe(path.resolve('.'))
    expect(parseRouterCheckArgs(['./examples/pages']).pagesDir).toBe(path.resolve('./examples/pages'))
    expect(() => parseRouterCheckArgs(['a', 'b'])).toThrow(/多余参数/)
  })
})

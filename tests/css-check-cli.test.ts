// tests/css-check-cli.test.ts
// ★G-21 css-compat B1：CLI css:check（扫描 .vue/.css → --strict-css 校验 + 重写统计 + 报告落盘）
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCssCheck, formatCssCheck } from '../packages/cli/src/css-check'

function makeTmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-css-check-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return dir
}

describe('CLI css:check（G-21 B1）', () => {
  it('扫描目录 .vue/.css：违规统计 + 重写统计', () => {
    const dir = makeTmp({
      'pages/index.vue': `<template><view class="a" /></template>\n<style scoped>.a { height: 100vh; float: left; }</style>`,
      'styles/btn.css': `.btn { width: calc(100px - 20px); color: rgba(0,0,0,0.5); }`,
      'ignore.ts': 'export const x = 1', // 非样式文件跳过
    })
    try {
      const result = runCssCheck(dir, { strict: true, fix: false })
      expect(result.files).toHaveLength(2)
      // index.vue：float（CSS001 error）+ vh（CSS008 error）
      const page = result.files.find((f) => f.file.endsWith('index.vue'))
      expect(page?.report.violations.map((v) => v.code)).toEqual(expect.arrayContaining(['CSS001', 'CSS008']))
      // btn.css：calc 折叠 + rgba 重写统计
      const btn = result.files.find((f) => f.file.endsWith('btn.css'))
      expect(btn?.report.rewritten.calc).toBe(1)
      expect(btn?.report.rewritten['rgba-to-argb']).toBe(1)
      expect(result.total.errorCount).toBeGreaterThan(0)
      expect(result.ok).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('合法 CSS → ok=true + 文本报告格式', () => {
    const dir = makeTmp({
      'a.vue': `<template></template>\n<style>.a { display: flex; justify-content: center; }</style>`,
    })
    try {
      const result = runCssCheck(dir, { strict: true, fix: false })
      expect(result.ok).toBe(true)
      const text = formatCssCheck(result)
      expect(text).toContain('--strict-css 校验 1 个文件')
      expect(text).toContain('✅')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('strict=false 降级：error → warn 不阻断', () => {
    const dir = makeTmp({
      'a.css': `.a { float: left; }`,
    })
    try {
      const strict = runCssCheck(dir, { strict: true, fix: false })
      expect(strict.ok).toBe(false)
      const loose = runCssCheck(dir, { strict: false, fix: false })
      expect(loose.ok).toBe(true)
      expect(loose.total.warnCount).toBe(1) // CSS001 降级 warn
      expect(loose.total.errorCount).toBe(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

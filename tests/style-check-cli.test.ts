// tests/style-check-cli.test.ts
// ★G-31 style-safety B1：CLI style:check（模板 :style 绑定 → STS001-006 静态校验）
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runStyleCheck, formatStyleCheck } from '../packages/cli/src/style-check'

function makeTmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-style-check-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return dir
}

describe('CLI style:check（G-31 B1，08 §2 STS 报错码）', () => {
  it('白名单合法 + 语义组件/禁止属性/未知属性分类', () => {
    const dir = makeTmp({
      'a.vue': `<template>
        <view :style="{ width: w, opacity: 0.5, 'backdrop-filter': 'blur(10px)', display: 'inline-flex', boxShadow: '0 2px' }" />
      </template>`,
    })
    try {
      const result = runStyleCheck(dir, { platform: 'web' })
      const codes = result.violations.map((v) => v.code)
      expect(codes).toContain('STS003') // backdrop-filter → 语义组件
      expect(codes).toContain('STS004') // display → 禁用
      expect(codes).toContain('STS001') // boxShadow 不在白名单
      // width（动态 w）+ opacity 静态合法：无违规
      expect(codes.filter((c) => c === 'STS002')).toHaveLength(0)
      expect(result.ok).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('动态源 :style（变量/三元）→ STS006 提示（不阻断）', () => {
    const dir = makeTmp({
      'b.vue': `<template><view :style="styleObj" /></template>`,
    })
    try {
      const result = runStyleCheck(dir, { platform: 'web' })
      expect(result.violations.map((v) => v.code)).toEqual(['STS006'])
      expect(result.ok).toBe(true) // STS006 是提示非错误
      expect(formatStyleCheck(result)).toContain('动态源提示 1')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('静态值类型校验 STS002（opacity 越界 / width 非法字符串）', () => {
    const dir = makeTmp({
      'c.vue': `<template><view :style="{ opacity: 2, width: 'abc' }" /></template>`,
    })
    try {
      const result = runStyleCheck(dir, { platform: 'web' })
      expect(result.violations.map((v) => v.code)).toEqual(['STS002', 'STS002'])
      expect(result.stats.staticChecked).toBe(2)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('无 :style 的合法文件 → 零违规', () => {
    const dir = makeTmp({
      'ok.vue': `<template><view class="a" @tap="go" /></template>`,
    })
    try {
      const result = runStyleCheck(dir, { platform: 'web' })
      expect(result.violations).toHaveLength(0)
      expect(result.ok).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// tests/check-cli.test.ts
// ★G-33 cli-plus M1：proteus check 聚合门禁（03-strict-cli.md §1 一键全量）
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCheck, formatCheck } from '../packages/cli/src/check'
import { parseCheckArgs } from '../packages/cli/src/args'

function makeTmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-check-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return dir
}

describe('proteus check（G-33 M1 聚合）', () => {
  it('全绿项目 → 四域全过 + exit 语义', async () => {
    const dir = makeTmp({
      'pages/index.vue': `<template><view class="a" /></template>\n<style>.a { display: flex; gap: 8px; }</style>`,
      'app.json': JSON.stringify({ pages: ['pages/index'] }),
      'proteus.config.ts': `export default { platform: 'mp-weixin', skyline: true, appid: 'wx0000000000', pagesDir: 'pages', routesOutput: 'router/auto-routes.ts', customRoute: { registerPresets: true }, setDataBridge: { batchWindow: 16, perComponent: true }, style: { px2rpx: true, rpxRatio: 2 } }`,
    })
    try {
      const summary = await runCheck(dir, { strictCss: true, strictStyle: true, strictRouter: true, strictCli: true })
      expect(summary.ok).toBe(true)
      expect(summary.domains.map((d) => d.name).sort()).toEqual(['app-config', 'cli', 'css', 'router', 'style'])
      const text = formatCheck(summary)
      expect(text).toContain('全部通过')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('样式违规 → css 域失败（其余域不受影响）', async () => {
    const dir = makeTmp({
      'pages/index.vue': `<template><view class="a" /></template>\n<style>.a { float: left; }</style>`,
    })
    try {
      const summary = await runCheck(dir, { strictCss: true, strictStyle: true, strictRouter: true, strictCli: true })
      expect(summary.ok).toBe(false)
      const css = summary.domains.find((d) => d.name === 'css')
      expect(css?.ok).toBe(false)
      expect(css?.detail).toContain('CSS001')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('--no-strict-* 关闭对应域（可单独关 css 保留 style）', async () => {
    const dir = makeTmp({
      'pages/index.vue': `<template><view class="a" /></template>\n<style>.a { float: left; }</style>`,
    })
    try {
      const summary = await runCheck(dir, { strictCss: false, strictStyle: true, strictRouter: true, strictCli: true })
      // css 域被关闭 → 不出现；style 域仍检查
      expect(summary.domains.map((d) => d.name)).not.toContain('css')
      expect(summary.domains.map((d) => d.name)).toContain('style')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('parseCheckArgs：默认全开 + --no-* 关闭 + 多余参数报错', () => {
    expect(parseCheckArgs([])).toMatchObject({ root: path.resolve('.'), strictCss: true, strictStyle: true, strictRouter: true, strictCli: true })
    const off = parseCheckArgs(['--no-strict-css', '--no-strict-style', 'src'])
    expect(off).toMatchObject({ root: path.resolve('src'), strictCss: false, strictStyle: false, strictRouter: true, strictCli: true })
    expect(() => parseCheckArgs(['a', 'b'])).toThrow()
  })
})

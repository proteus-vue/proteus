// tests/mp-artifacts.test.ts
// ★小程序产物完整性门禁（scripts/audit-mp-artifacts.mjs）的自测——防「门禁脚本自身退化」。
//
// 背景（2026-09-19 真机暴露）：按需组件输出漏掉非 `p-` 前缀组件（pg-glass）→ 页面 json 声明了
//   `usingComponents["pg-glass"]` 但产物缺 js/wxml/wxss → 微信报「未找到组件」且**整个小程序启动失败**。
//   该缺陷此前无任何门禁覆盖（只有真机才暴露）→ 新增 `check:mp-artifacts`（引用闭环：声明 ⇒ 四件套）。
//   本文件用**临时产物体**驱动该脚本，锁住三类判据 + 两类破坏性。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'audit-mp-artifacts.mjs')

/** 造临时产物：files = 相对路径列表（内容占位），appJson = app.json 内容 */
function fixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-mpart-'))
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
  return dir
}

/** 跑门禁脚本 → { code, out } */
function run(dir: string): { code: number; out: string } {
  const r = spawnSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf8', cwd: ROOT })
  return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

const QUARTET = (base: string, body = 'x') => ({
  [`${base}.js`]: body,
  [`${base}.wxml`]: body,
  [`${base}.wxss`]: body,
  [`${base}.json`]: '{}',
})

describe('小程序产物完整性门禁（check:mp-artifacts）', () => {
  it('① 完整产物 → 通过（页面四件套 + usingComponents 引用齐全）', () => {
    const dir = fixture({
      'app.json': JSON.stringify({ pages: ['pages/index'] }),
      ...QUARTET('pages/index'),
      'pages/index.json': JSON.stringify({ usingComponents: { 'p-text': '/proteus/p-text/index' } }),
      ...QUARTET('proteus/p-text/index'),
    })
    const { code, out } = run(dir)
    expect(out).toContain('✅')
    expect(code).toBe(0)
  })

  it('② 页面缺四件套 → 失败（判据：声明的页面必须有 js/wxml/wxss/json）', () => {
    const dir = fixture({
      'app.json': JSON.stringify({ pages: ['pages/index'] }),
      'pages/index.js': 'x',
      'pages/index.json': '{}',
      // 缺 wxml / wxss
    })
    const { code, out } = run(dir)
    expect(code).toBe(1)
    expect(out).toMatch(/页面缺四件套.*pages\/index/)
  })

  it('★③ 组件引用缺文件 → 失败（pg-glass 缺陷形态的回归锁）', () => {
    const dir = fixture({
      'app.json': JSON.stringify({ pages: ['pages/glass'] }),
      ...QUARTET('pages/glass'),
      'pages/glass.json': JSON.stringify({ usingComponents: { 'pg-glass': '/proteus/pg-glass/index' } }),
      // ★只给了 json（正是 pg-glass 当时的产物形态：目录里只有一个 index.json）
      'proteus/pg-glass/index.json': '{}',
    })
    const { code, out } = run(dir)
    expect(code).toBe(1)
    expect(out).toMatch(/pg-glass.*缺.*js\/wxml\/wxss/)
  })

  it('④ 递归检查：组件自身引用的组件也须齐全（组件链）', () => {
    const dir = fixture({
      'app.json': JSON.stringify({ pages: ['pages/a'] }),
      ...QUARTET('pages/a'),
      'pages/a.json': JSON.stringify({ usingComponents: { 'p-outer': '/proteus/p-outer/index' } }),
      ...QUARTET('proteus/p-outer/index'),
      'proteus/p-outer/index.json': JSON.stringify({ usingComponents: { 'p-inner': '/proteus/p-inner/index' } }),
      // p-inner 缺失（只给 json）
      'proteus/p-inner/index.json': '{}',
    })
    const { code, out } = run(dir)
    expect(code).toBe(1)
    expect(out).toMatch(/p-inner.*缺/)
  })

  it('⑤ 两种路径写法都可解析（框架产出 = 绝对路径 `/proteus/...`；亦兼容相对根目录写法）', () => {
    // ★框架真实产出：collectComponents 统一生成 `/proteus/<tag>/index` 与 `/components/<tag>/index`（绝对路径）
    const dir = fixture({
      'app.json': JSON.stringify({ pages: ['pages/a'] }),
      ...QUARTET('pages/a'),
      'pages/a.json': JSON.stringify({ usingComponents: { 'p-abs': '/proteus/p-abs/index', 'p-rel': 'proteus/p-rel/index' } }),
      ...QUARTET('proteus/p-abs/index'),
      ...QUARTET('proteus/p-rel/index'),
    })
    expect(run(dir).code).toBe(0)
  })

  it('★⑤b 相对路径按「小程序根目录」解析（非引用文件目录——防解析基准写错致假红）', () => {
    // 若按「相对 json 所在目录」解析，`proteus/p-x/index` 会变成 `pages/proteus/p-x/index` → 假红
    const dir = fixture({
      'app.json': JSON.stringify({ pages: ['pages/a'] }),
      ...QUARTET('pages/a'),
      'pages/a.json': JSON.stringify({ usingComponents: { 'p-x': 'proteus/p-x/index' } }),
      ...QUARTET('proteus/p-x/index'),
    })
    const { code, out } = run(dir)
    expect(out, '不应误报 p-x 缺失').not.toMatch(/p-x.*缺/)
    expect(code).toBe(0)
  })

  it('★⑥ 产物缺失 → 失败且**不静默跳过**（避免「没构建就绿灯」的假绿）', () => {
    const { code, out } = run(path.join(os.tmpdir(), 'proteus-nonexistent-artifacts-dir'))
    expect(code).toBe(1)
    expect(out).toContain('产物不存在或未构建')
  })

  it('⑦ 分包页面同样受检（subPackages 展开）', () => {
    const dir = fixture({
      'app.json': JSON.stringify({ pages: ['pages/index'], subPackages: [{ root: 'sub', pages: ['pages/x'] }] }),
      ...QUARTET('pages/index'),
      // 分包页缺文件
      'sub/pages/x.json': '{}',
    })
    const { code, out } = run(dir)
    expect(code).toBe(1)
    expect(out).toMatch(/sub\/pages\/x/)
  })
})

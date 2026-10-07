// tests/website-anchor-collision.test.ts
// ★★★文档锚点 ↔ 站点壳 id 撞车门禁（决策 #647）
//
// 【背景（用户 2026-10-08 实测）】「配置参考页点 `app` 看到大片空白」——根因：生成页的字段标题
//   （`### app` → `<h3 id="app">`）与**站点挂载根** `<div id="app">` **id 撞车**；而站点壳的
//   `#app { min-height:100vh }` 会命中文档里的那个标题 → 把它撑成整屏（且页内 `#app` 锚点跳到挂载根）。
//   修法：挂载根改命名空间 id（`proteus-app`）——文档锚点是**公开契约**（可分享/可外链），
//   站点壳 id 是**内部实现**，撞车时让壳让位。
//
// 【本门禁守什么】站点壳 HTML 里的**任何元素 id** 都不得与任何文档页的**标题锚点 id** 相同
//   （同页共存即撞车：锚点跳错元素 / 壳样式误伤标题）。壳 id 必须**命名空间化**（如 `proteus-*`）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseMarkdown } from '../packages/docs/src/index'

const ROOT = path.resolve(__dirname, '..')
const WEBSITE = path.join(ROOT, 'website')

/** SPA 壳 HTML（只有 index.html 包住文档页；flexible-multi-device.html 是独立单页，不渲染文档） */
const SHELL_HTML = [path.join(WEBSITE, 'index.html')]
const DOC_DIRS = ['content', 'guides', 'framework', 'animation'].map((d) => path.join(WEBSITE, d))

function shellIds(): Set<string> {
  const ids = new Set<string>()
  for (const f of SHELL_HTML) {
    if (!fs.existsSync(f)) continue
    // ★先剥 HTML 注释再取 id（注释里出现的 id 文本不是元素 id——否则本门禁会被自己的说明注释误触发）
    const html = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1])
  }
  return ids
}

function walkMd(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkMd(p, out)
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}

describe('★★★文档锚点 ↔ 站点壳 id 撞车（决策 #647）', () => {
  it('壳 HTML 的每个元素 id 均命名空间化（不与文档标题锚点共用一个裸词）', () => {
    const ids = shellIds()
    const bare = [...ids].filter((id) => !id.includes('-'))
    expect(
      bare,
      `站点壳 id 必须是命名空间（含连字符，如 proteus-app）——裸词（如 app）会与文档标题锚点撞车：${bare.join(', ')}`,
    ).toEqual([])
  })

  it('无任何文档标题锚点 id 与壳 id 相同（同页共存会锚点跳错 / 壳样式误伤标题）', () => {
    const ids = shellIds()
    const clashes: string[] = []
    for (const dir of DOC_DIRS) {
      for (const file of walkMd(dir)) {
        const doc = parseMarkdown(fs.readFileSync(file, 'utf8'))
        for (const b of doc.blocks) {
          if (b.type === 'heading' && ids.has(b.id)) {
            clashes.push(`${path.relative(WEBSITE, file)} :: #${b.id}`)
          }
        }
      }
    }
    expect(clashes, `文档标题锚点与站点壳 id 撞车（改壳 id 命名空间，或改锚点 slug）：\n${clashes.join('\n')}`).toEqual([])
  })
})

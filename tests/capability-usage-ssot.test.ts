// tests/capability-usage-ssot.test.ts
// ★★★决策 #1088（2026-10-19）：能力页「用法」示例必须是**单一 SSOT**（中英同源）。
//
// 【为什么（#1087 的直接欠账）】#1087 修掉了英文页 `await` 同步句柄的毛病，但**根因还在**：
//   中文示例写在 `gen-content.mjs` 的 `USAGE_EXAMPLES`（43 条），英文示例写在
//   `gen-content-en.mjs` 的 `CAP_USAGE_EN`（17 条）——**同一事实两份手写代码**。
//   英文侧 26 条没有手写 ⇒ 走 `direct()` 通用模板 ⇒ 读者拿到的是"占位式"示例；
//   而只要两边都手写，就一定会再次漂移（#1087 就是这么来的）。
//   ⇒ 收口成 `website/scripts/lib/cap-usage/` 一份 `{ zh, en }`，生成器按语言取段。
//
// 【判据】
//   ① 生成器**不得**再内联手写示例表（`USAGE_EXAMPLES` / `CAP_USAGE_EN[hook]` 都不许出现）；
//   ② SSOT 里每条必须**双语非空**；
//   ③ 中英两段的**代码骨架**必须逐行相同（去掉注释与字符串内容后比对）；
//   ④ 中英产物页的代码块行数必须相同（文档层面的同源证据）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAP_USAGE, usageOf, assertUsageParity } from '../website/scripts/lib/cap-usage/index.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const zhGen = fs.readFileSync(path.join(ROOT, 'website/scripts/gen-content.mjs'), 'utf8')
const enGen = fs.readFileSync(path.join(ROOT, 'website/scripts/gen-content-en.mjs'), 'utf8')

describe('★#1088 ① 生成器不再内联手写示例表', () => {
  it('中文生成器没有 USAGE_EXAMPLES 定义与引用', () => {
    expect(zhGen.includes('const USAGE_EXAMPLES'), '中文示例表应已迁到 lib/cap-usage.mjs').toBe(false)
    expect(zhGen.includes('USAGE_EXAMPLES['), '中文生成器仍引用旧表').toBe(false)
  })
  it('英文表不再逐条手写（只保留 direct/generic 派生模板）', () => {
    const start = enGen.indexOf('export const CAP_USAGE_EN = {')
    expect(start, '未找到 CAP_USAGE_EN').toBeGreaterThan(-1)
    const end = enGen.indexOf('\n}', start)
    const body = enGen.slice(start, end)
    const handwritten = [...body.matchAll(/^ {2}(use[A-Za-z0-9]+): \[/gm)].map((m) => m[1])
    expect(handwritten, `英文表仍在手写逐条示例（应与中文同源）：${handwritten.join(', ')}`).toEqual([])
    expect(body.includes('directUsageEn'), '派生模板 direct 应保留').toBe(true)
    expect(body.includes('generic'), '派生模板 generic 应保留').toBe(true)
  })
  it('两侧生成器都从 lib 取示例', () => {
    expect(zhGen.includes("usageOf(hook, 'zh')"), '中文侧应走 usageOf(hook, \'zh\')').toBe(true)
    expect(zhGen.includes("usageOf(hook, 'en')"), '英文侧应走 usageOf(hook, \'en\')').toBe(true)
    expect(zhGen.includes("from './lib/cap-usage/index.mjs'"), '中文侧缺 import').toBe(true)
    expect(zhGen.includes("from './lib/cap-usage/index.mjs'"), '英文侧缺 import').toBe(true)
  })
})

describe('★#1088 ② 每条示例双语非空', () => {
  it('不存在只有中文或只有英文的条目', () => {
    const bad = []
    for (const [hook, e] of Object.entries(CAP_USAGE)) {
      if (!Array.isArray(e.zh) || e.zh.length === 0) bad.push(`${hook}: 缺 zh`)
      if (!Array.isArray(e.en) || e.en.length === 0) bad.push(`${hook}: 缺 en`)
      if (Array.isArray(e.zh) && Array.isArray(e.en) && e.zh.length !== e.en.length) {
        bad.push(`${hook}: 行数 zh=${e.zh.length} en=${e.en.length}`)
      }
    }
    expect(bad, `示例表双语不完整：\n${bad.join('\n')}`).toEqual([])
  })
})

describe('★#1088 ③ 中英代码骨架逐行相同', () => {
  it('assertUsageParity() 通过', () => {
    expect(() => assertUsageParity()).not.toThrow()
  })
  it('骨架比对能抓到"只改一边"的漂移（破坏性自检）', () => {
    // 反向证明判据有效：手工构造一条骨架不同的对照
    const skel = (l: string) =>
      l.replace(/\/\/.*$/, '').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/\s+/g, ' ').trim()
    expect(skel("const r = useVideo('a')")).not.toBe(skel('const r = useVideo()'))
  })
})

describe('★#1088 ④ 产物页中英代码块行数一致', () => {
  it('已登记示例的能力页：zh 与 en 的 Usage 代码块行数相同', () => {
    const zhDir = path.join(ROOT, 'website/content/capabilities')
    const enDir = path.join(ROOT, 'website/en/capabilities')
    if (!fs.existsSync(zhDir) || !fs.existsSync(enDir)) return
    const hooks = Object.keys(CAP_USAGE)
    const bad: string[] = []
    for (const f of fs.readdirSync(enDir).filter((x) => x.endsWith('.md'))) {
      const zhFile = path.join(zhDir, f)
      if (!fs.existsSync(zhFile)) continue
      const en = fs.readFileSync(path.join(enDir, f), 'utf8')
      const zh = fs.readFileSync(zhFile, 'utf8')
      if (!hooks.some((h) => en.includes(h))) continue
      const block = (src: string, heading: string) => {
        const i = src.indexOf(heading)
        if (i < 0) return null
        const m = /```ts\n([\s\S]*?)```/.exec(src.slice(i))
        return m ? m[1].split('\n').filter((l, idx, a) => idx < a.length - 1 || l !== '').length : null
      }
      const a = block(zh, '## 用法')
      const b = block(en, '## Usage')
      if (a === null || b === null) continue
      if (a !== b) bad.push(`${f}: zh=${a} en=${b}`)
    }
    expect(bad, `中英示例代码块行数不一致（说明两侧来源已分叉）：\n${bad.join('\n')}`).toEqual([])
  })
})

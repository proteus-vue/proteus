// tests/doc-content-shrink.test.ts
// ★★★#1125：**文档"内容缩水"门禁**的判据
//
// 【它防的是什么（本仓真实账）】
//   #1123 挖出 5 个生成器缺陷、#1124 挖出 2 个，**共同形态都是"文档静默变少或变空"**：
//     · 拆文件 ⇒ 源集合找不到 ⇒ 参数表整段消失（fetch.md 被删 38 行）
//     · 函数型属性被当方法跳过 ⇒ onChunk 消失
//     · 结果类型名写死 ⇒ `data` 类型变空
//     · readonly 不支持 ⇒ AbortSignalLike 属性表消失
//   ★而 `check:content` 只能比"文档与当前生成器是否一致"——**生成器自己退化时它照样说一致**。
//     ⇒ 必须有这条**独立于生成器逻辑**的判据：记住上次这些页有多大，变小就红。
//
// 【要证明什么】
//   ① **只对减少敏感**：增长永远合法（补内容不该被拦）；
//   ② **容忍小幅波动**：绝对差 ≤2 或相对 ≤10% 不报（避免文案微调就红）；
//   ③ 基线**只增不减**（缩水时保留旧值 ⇒ 不把缺陷写成新基线）；
//   ④ 门禁真的接上（`--check` 非 0 退出，且提示可操作）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

async function lib() {
  return (await import('../website/scripts/lib/content-shrink.mjs')) as unknown as {
    measureDoc: (s: string) => { tableRows: number; headings: number; codeBlocks: number; bodyLines: number }
    judgeShrink: (p: Record<string, number>, n: Record<string, number>, o?: Record<string, number>) => { shrunk: boolean; fields: string[]; detail: string }
    mergeBaseline: (p: Record<string, number> | undefined, n: Record<string, number>) => Record<string, number>
  }
}

const DOC = [
  '# 标题不进统计（h1 不算）',
  '',
  '## 参数',
  '',
  '| 参数 | 类型 |',
  '|---|---|',
  '| `url` | `string` |',
  '| `config` | `FetchConfig` |',
  '',
  '### `Coords`',
  '',
  '正文一行',
  '',
  '```ts',
  'useFetch(url)',
  '```',
].join('\n')

describe('★#1125 measureDoc · 结构性规模', () => {
  it('统计表格行 / h2-h4 小节 / 代码块 / 正文行', async () => {
    const { measureDoc } = await lib()
    const m = measureDoc(DOC)
    expect(m.tableRows).toBe(4)     // 表头 + 分隔 + 2 行 + 空行内的？（按 | 开头计）
    expect(m.headings).toBe(2)      // ## 参数 / ### Coords（h1 不算）
    expect(m.codeBlocks).toBe(2)    // ``` 开 + ```
    expect(m.bodyLines).toBeGreaterThan(0)
  })

  it('代码块内的表格行不计（避免把示例代码当结构）', async () => {
    const { measureDoc } = await lib()
    const withTableInCode = ['```', '| a | b |', '| c | d |', '```'].join('\n')
    expect(measureDoc(withTableInCode).tableRows).toBe(0)
  })
})

describe('★#1125 judgeShrink · 只对"变少"敏感', () => {
  const base = { tableRows: 100, headings: 20, codeBlocks: 5, bodyLines: 50 }

  it('★内容变多 ⇒ 不报（补内容永远合法）', async () => {
    const { judgeShrink } = await lib()
    const now = { tableRows: 120, headings: 25, codeBlocks: 6, bodyLines: 70 }
    expect(judgeShrink(base, now).shrunk).toBe(false)
  })

  it('★整段消失 ⇒ 报（参数表被吃掉那种）', async () => {
    const { judgeShrink } = await lib()
    const now = { tableRows: 40, headings: 20, codeBlocks: 5, bodyLines: 50 }
    const r = judgeShrink(base, now)
    expect(r.shrunk).toBe(true)
    expect(r.fields).toContain('tableRows')
    expect(r.detail, 'detail 要给出具体差值，便于定位').toMatch(/tableRows 100→40（-60）/)
  })

  it('小幅波动不报（绝对差 ≤2）', async () => {
    const { judgeShrink } = await lib()
    expect(judgeShrink(base, { ...base, tableRows: 98 }).shrunk).toBe(false)
    expect(judgeShrink(base, { ...base, tableRows: 99 }).shrunk).toBe(false)
  })

  it('相对 ≤10% 不报（避免文案微调就红）', async () => {
    const { judgeShrink } = await lib()
    // 100 → 95（-5%，绝对值 5 > 2，但未超 10%）
    expect(judgeShrink(base, { ...base, tableRows: 95 }).shrunk).toBe(false)
    // 100 → 85（-15%）⇒ 报
    expect(judgeShrink(base, { ...base, tableRows: 85 }).shrunk).toBe(true)
  })

  it('基线为 0 的指标不参与判红（本来就没有）', async () => {
    const { judgeShrink } = await lib()
    const b = { tableRows: 0, headings: 0, codeBlocks: 0, bodyLines: 0 }
    expect(judgeShrink(b, b).shrunk).toBe(false)
  })
})

describe('★#1125 mergeBaseline · 只增不减', () => {
  it('★缩水时保留旧值（不把缺陷写成新基线）', async () => {
    const { mergeBaseline } = await lib()
    const prev = { tableRows: 100, headings: 20, codeBlocks: 5, bodyLines: 50 }
    const now = { tableRows: 40, headings: 20, codeBlocks: 5, bodyLines: 50 }
    const merged = mergeBaseline(prev, now)
    expect(merged.tableRows, '★基线被缩水值覆盖了 ⇒ 下次就再也抓不住').toBe(100)
  })

  it('增长时更新基线', async () => {
    const { mergeBaseline } = await lib()
    const prev = { tableRows: 100, headings: 20, codeBlocks: 5, bodyLines: 50 }
    const merged = mergeBaseline(prev, { ...prev, tableRows: 130 })
    expect(merged.tableRows).toBe(130)
  })

  it('无基线时以当前值为基线', async () => {
    const { mergeBaseline } = await lib()
    const now = { tableRows: 10, headings: 2, codeBlocks: 1, bodyLines: 5 }
    expect(mergeBaseline(undefined, now)).toEqual(now)
  })
})

describe('★#1125 门禁接线（生成器真的会判红）', () => {
  const GEN = 'website/scripts/gen-content.mjs'

  it('★writeDoc 里必须做缩水比对（否则这道门禁不存在）', () => {
    const s = read(GEN)
    expect(s, '未引入 judgeShrink').toMatch(/judgeShrink/)
    expect(s, 'writeDoc 未调 measureDoc').toMatch(/measureDoc\(content\)/)
    expect(s, '未记录缩水命中').toMatch(/shrinkHits\.push/)
  })

  it('★ --check 时缩水必须非 0 退出', () => {
    const s = read(GEN)
    expect(s, '缺 SHRUNK 判红分支').toMatch(/SHRUNK/)
    const idx = s.indexOf('SHRUNK')
    const seg = s.slice(Math.max(0, idx - 300), idx + 700)
    expect(seg, '★ SHRUNK 分支没有 process.exit(1)').toMatch(/process\.exit\(1\)/)
  })

  it('★基线文件必须在 check 模式下**只读**（不能边检边写）', () => {
    const s = read(GEN)
    // 定位**写入行**（`SHRINK_BASELINE` 的 writeFileSync），而不是变量声明
    const idx = s.indexOf('writeFileSync(SHRINK_BASELINE')
    expect(idx, '找不到基线写入点').toBeGreaterThan(0)
    const before = s.slice(Math.max(0, idx - 300), idx)
    expect(before, '★基线写入未加 `!check` 守卫 ⇒ check 模式会改写基线').toMatch(/!check\s*&&\s*baselineDirty[\s\S]{0,120}$/)
  })

  it('基线文件存在且覆盖能力页（首次运行后应已入库）', () => {
    const p = 'website/content/.content-size-baseline.json'
    expect(fs.existsSync(path.join(ROOT, p)), `缺基线 ${p}（跑一次 gen:content 生成）`).toBe(true)
    const b = JSON.parse(read(p)) as Record<string, { tableRows: number }>
    const fetchPage = 'website/content/capabilities/fetch.md'
    expect(b[fetchPage], '基线里没有 fetch 页').toBeTruthy()
    expect(b[fetchPage].tableRows, 'fetch 页表格行数应 > 0（参数表+返回值表+错误码表）').toBeGreaterThan(10)
  })
})

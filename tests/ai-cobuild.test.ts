/**
 * AI 共建三方一致性（2026-09-20 建立规范时新增）
 *
 * 背景：报告第九节报的 fluid 缺件（阻断级）**压根没进台账**——没有任何机器判据能发现「报了没立项」。
 * 本测试把规范里可机器判定的部分锁死，防止门禁本身被绕过或腐化：
 *   ① `check:cobuild` 对当前仓库为绿（报告↔台账↔回执 三方对齐）；
 *   ② 台账里每条都带 id/severity/repro 等必需字段，且 blocker 必带 repro；
 *   ③ 报告每轮都有对应台账条目（防未来「报了没立项」）；
 *   ④ 规范文档与 skill 存在（规范本身不能只在某人的记忆里）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
interface LedgerEntry {
  id: string
  title?: string
  severity?: string
  status?: string
  fix_state?: string
  verification?: string
  related?: string[]
  round?: number
  [k: string]: unknown
}
const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/外部报告台账.json'), 'utf8')) as { entries: LedgerEntry[] }
const report = fs.readFileSync(path.join(root, 'docs/实战报告_proteus接入.md'), 'utf8')

describe('AI 共建三方一致性（报告 ↔ 台账 ↔ 回执）', () => {
  it('check:cobuild 通过（三方对齐）', () => {
    const out = execFileSync('node', ['scripts/cobuild-check.mjs', '--check'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    })
    expect(out).toContain('三方一致')
  }, 120_000)

  it('check:ledger 通过（台账自身合格）', () => {
    const out = execFileSync('node', ['scripts/ledger-check.mjs'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    })
    expect(out).toContain('真实收口率')
  }, 120_000)

  it('台账每条都有必需字段；blocker 必带最小复现', () => {
    const REQUIRED = ['id', 'title', 'kind', 'severity', 'round', 'reported_in', 'found_by', 'status', 'verification', 'evidence', 'repro']
    for (const e of ledger.entries) {
      for (const k of REQUIRED) {
        expect(e[k], `${e.id} 缺字段 ${k}`).toBeTruthy()
      }
      if (e.severity === 'blocker') expect(e.repro, `${e.id} 是 blocker 必须带 repro`).toBeTruthy()
      if (e.status === 'partial') expect(e.related?.length, `${e.id} 是 partial 必须带 related`).toBeGreaterThan(0)
      if (e.status === 'fixed') expect(['published', 'worktree'], `${e.id} fixed 必须有 fix_state`).toContain(e.fix_state)
    }
  })

  it('台账 id 唯一且稳定（对账锚点）', () => {
    const ids = ledger.entries.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('报告每轮都有台账条目、台账每条都有轮次（防「报了没立项」）', () => {
    const reportRounds = new Set<number>()
    const CN: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
    for (const m of report.matchAll(/^## [^\n]*第([一二三四五六七八九十]+)轮[^\n]*$/gm)) {
      const n = CN[m[1]]
      if (n) reportRounds.add(n)
    }
    const ledgerRounds = new Set(ledger.entries.map((e) => Number(e.round)))
    for (const r of reportRounds) expect(ledgerRounds.has(r), `报告第 ${r} 轮无台账条目（报了没立项）`).toBe(true)
    for (const r of ledgerRounds) expect(r).toBeGreaterThan(0)
  })

  it('规范与 skill 存在（规范不能只活在某人的记忆里）', () => {
    expect(fs.existsSync(path.join(root, 'docs/ai-cobuild-spec.md'))).toBe(true)
    const skill = path.join(root, '.agents/skills/ai-cobuild/SKILL.md')
    expect(fs.existsSync(skill)).toBe(true)
    const skillSrc = fs.readFileSync(skill, 'utf8')
    // 四条铁律必须在 skill 里可读
    expect(skillSrc).toContain('报了必须立项')
    expect(skillSrc).toContain('修了必须发布')
    expect(skillSrc).toContain('发了必须被独立验证')
    expect(skillSrc).toContain('闭环必须留回执')
  })

  it('AGENTS.md 已接线（新会话会被引导到共建规范）', () => {
    const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('ai-cobuild')
    expect(agents).toContain('check:cobuild')
  })
})

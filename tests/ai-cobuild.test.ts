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

  // ★2026-09-20（F-34 同步实战）：外部的实质验证结论必须能覆盖框架的 n_a 占位，且**不得**被误报为冲突。
  //   n_a = 「修复未发布，验证不适用」，是框架侧占位而非经过考虑的结论；规范里 verification 属
  //   「外部优先」字段。此前脚本只在外部 passed/failed 时让位 → 外部填 unverified（用工作树源码复测 6/6
  //   后诚实标注「有效但未发布」）时被误判冲突，迫使人工裁决（本该零人工）。
  //   ★破坏性：撤掉 sync-cobuild.mjs 里 `mine[f] === 'n_a'` 那条分支 → 本用例当场红。
  it('★外部实质结论覆盖框架 n_a 占位（不误报冲突）', () => {
    const src = fs.readFileSync(path.join(root, 'scripts/sync-cobuild.mjs'), 'utf8')
    // 规则形态：verification 字段上「框架 n_a + 外部有值」→ 采纳外部（changes.push / mine[f] = ee[f]）
    expect(src, 'n_a 覆盖规则必须在位（否则外部 unverified 被误判冲突）').toMatch(
      /f === 'verification' && mine\.verification === 'n_a' && ee\.verification/,
    )
    const i = src.indexOf("mine.verification === 'n_a'")
    expect(src.slice(i, i + 600), 'n_a 分支必须采纳外部值（而非落入 conflicts）').toContain('mine[f] = ee[f]')
    // 规范文档里必须写着「verification 只能由使用方给出」——规则与文档同源
    const spec = fs.readFileSync(path.join(root, 'docs/ai-cobuild-spec.md'), 'utf8')
    expect(spec, '规范须声明 verification 的归属（外部给出，框架自测不算）').toMatch(
      /verification=passed\*\*\s*只能由使用方给出|复测是使用方的事/,
    )
  })

  // ★台账的框架侧元数据（rounds / verification_breakdown）是「被整份覆盖」的直接受害者
  //   （2026-09-20 已发生两次）。这里锁死在位，配合 cobuild-check 规则 F 形成双保险。
  it('★台账保留框架侧元数据（防外部副本整份覆盖）', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'docs/外部报告台账.json'), 'utf8')) as Record<string, unknown>
    expect(Array.isArray(raw.rounds) && (raw.rounds as unknown[]).length > 0, 'rounds 不得丢失').toBe(true)
    expect(typeof raw.verification_breakdown === 'object' && raw.verification_breakdown !== null, 'verification_breakdown 不得丢失').toBe(true)
    // found_by=framework 的自查条目也是被覆盖的高危项（框架自找的缺陷不来自外部报告）
    const fw = (raw.entries as LedgerEntry[]).filter((e) => e.found_by === 'framework')
    expect(fw.length, '框架自查条目不得丢失').toBeGreaterThan(0)
  })
})

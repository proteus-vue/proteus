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
    // ★与 cobuild-check.mjs 同口径：中文/阿拉伯数字都认（外部报告第 13 轮起改用 `## 第13轮复测`）
    for (const m of report.matchAll(/^## [^\n]*第\s*([0-9]+|[一二三四五六七八九十]+)\s*轮[^\n]*$/gm)) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : CN[m[1]]
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
  // ★2026-11-13 重写（外部 F-46 报告）：旧断言锁的是「n_a 分支」这个**具体实现**，
  //   而 F-46 暴露的正是「按值白名单写死」这个判据缺陷——partial 是规范合法值却被判冲突。
  //   现改为锁**行为契约**（并抽 lib 让断言能真跑）。
  //   ★破坏性：把 sync-cobuild.mjs 的 verification 通道改回 passed/failed 白名单 → 本用例红。
  it('★外部实质结论覆盖框架占位（含 partial）——不再按值白名单判冲突', () => {
    const src = fs.readFileSync(path.join(root, 'scripts/sync-cobuild.mjs'), 'utf8')
    expect(src, 'verification 必须走外部优先通道（lib 调用形态）').toContain('isExternalPriorityField(f)')
    expect(src, '不得在脚本内重复实现白名单判据').toContain('mergeVerification(mine, ee)')
    expect(src, '不得回退到按值白名单（F-46 缺陷形态）').not.toMatch(
      /const extVerified = ee\.verification === 'passed' \|\| ee\.verification === 'failed'/,
    )
    // 规范文档里必须写着「verification 只能由使用方给出」——规则与文档同源
    const spec = fs.readFileSync(path.join(root, 'docs/ai-cobuild-spec.md'), 'utf8')
    expect(spec, '规范须声明 verification 的归属（外部给出，框架自测不算）').toMatch(
      /verification=passed\*\*\s*只能由使用方给出|复测是使用方的事/,
    )
  })

  // ★F-46 行为级回归锁：真跑合并判据，锁住「partial 不被判冲突」。
  it('★F-46：外部 partial 必须被采纳（不得判冲突）', async () => {
    const { mergeVerification } = await import('../scripts/lib/cobuild-verification.mjs')
    // ① 框架 unverified + 外部 partial ⇒ 采纳 partial，无冲突（F-42/F-43 的真实情形）
    const a = mergeVerification({ verification: 'unverified' }, { verification: 'partial' })
    expect(a.value).toBe('partial')
    expect(a.conflict).toBe(false)
    // ② 框架 n_a（占位）+ 外部 unverified ⇒ 采纳（F-34 历史实例）
    const b = mergeVerification({ verification: 'n_a' }, { verification: 'unverified' })
    expect(b.value).toBe('unverified')
    expect(b.conflict).toBe(false)
    // ③ 框架 passed + 外部 partial ⇒ **真矛盾**，交人裁决
    const c = mergeVerification({ verification: 'passed' }, { verification: 'partial' })
    expect(c.conflict, '框架 passed 与外部 partial 是相反结论，必须交人裁决').toBe(true)
    // ④ 框架 passed + 外部 unverified ⇒ 不是矛盾（外部还没验新版），但记 note
    const d = mergeVerification({ verification: 'passed' }, { verification: 'unverified' })
    expect(d.conflict).toBe(false)
    expect(d.value).toBe('unverified')
    expect(d.note).toBeTruthy()
    // ⑤ verified_by 同样走外部优先
    const e2 = mergeVerification({ verification: 'unverified', verified_by: undefined }, { verification: 'passed', verified_by: 'external' })
    expect(e2.by).toBe('external')
    expect(e2.conflict).toBe(false)
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

  // ★2026-11-12：`verification_breakdown` 是**派生数据**，长期手写 ⇒ 实测漂移
  //   （entries 已 unverified:2/n_a:1，快照仍写 unverified:1/n_a:2，统计时间停在 09-20）。
  //   现在 ledger-check 会重算比对，这里再锁一层「当前台账确实一致」。
  //   ★破坏性：把台账里任意一个 by_verification 数字改错 → 本用例当场红（已实测 exit 2）。
  it('★verification_breakdown 与 entries 一致（派生态不许手写漂移）', () => {
    const out = execFileSync('node', ['scripts/ledger-check.mjs'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    })
    expect(out).toContain('真实收口率')
    expect(out, 'breakdown 漂移必须被判红').not.toContain('verification_breakdown 与 entries 不一致')
  }, 120_000)

  // ★2026-11-12：轮次小节的数字形态（中文/阿拉伯 × 有无「复测」）必须两个脚本都认得。
  //   scipy: 外部报告第 13/14/15 轮写成 `## 第13轮复测` / `## 第14轮` / `## 第15轮`，
  //   而 cobuild-check 只认中文数字、sync-cobuild 强制「轮复测」⇒ 三条全抓不到/只抓到一条。
  //   ★破坏性：把任一脚本的正则退回旧形态 → 本用例当场红。
  it('★轮次小节解析：中文/阿拉伯 × 有无「复测」都能认出（两脚本同口径）', () => {
    const cases = [
      '## 第13轮复测：`0.3.0-beta.31`（2026-11-12）—— 结论',
      '## 第14轮：`0.3.0-beta.31`（2026-11-12）—— 结论',
      '## 第十二轮复测：`0.3.0-beta.17`（2026-09-20）—— 结论',
      '## 第 15 轮复测：`0.3.0-beta.31` —— 结论',
    ]
    // cobuild-check 的口径
    const checkRe = /第\s*([0-9]+|[一二三四五六七八九十]+)\s*轮/
    for (const h of cases) expect(checkRe.test(h), `cobuild-check 认不出：${h}`).toBe(true)
    // sync-cobuild 的口径：「复测」必须可选
    const syncRe = /^## [^\n]*第\s*([0-9]+|[一二三四五六七八九十]+)\s*轮(?:复测)?[^\n]*$/gm
    for (const h of cases) expect([...h.matchAll(syncRe)].length, `sync-cobuild 认不出：${h}`).toBe(1)
    // 且脚本源码里确实是这两种形态（防止改回旧正则而测试自身也跟着改）
    const checkSrc = fs.readFileSync(path.join(root, 'scripts/cobuild-check.mjs'), 'utf8')
    const syncSrc = fs.readFileSync(path.join(root, 'scripts/sync-cobuild.mjs'), 'utf8')
    expect(checkSrc, 'cobuild-check 的轮次正则须含阿拉伯数字分支').toContain('[0-9]+|[一二三四五六七八九十]+')
    expect(syncSrc, 'sync-cobuild 的「复测」须可省略').toContain('轮(?:复测)?')
  })

  // ★2026-11-12（外部 F-44 报告 + 自查扩展）：mergeNote 的三个缺陷——
  //   ① 认不出标签的文本被默认归为 framework（外部 `[external 观察] xxx` → 被标成框架写的）
  //   ② 外部 note 本身多段时被整体打包 ⇒ 产物出现 `[external] [external] …`
  //   ③ 旧版每同步一次可能叠一层标签 ⇒ 台账里留 8 条脏数据
  //   ★破坏性：把 splitNoteSegments 的 `else` 分支改回 push('framework',…) → 本用例红；
  //            删掉 unwrapNestedTag → 脏数据自愈用例红。
  it('★mergeNote：不擅自定义归属 / 不重复标签 / 递归剥离叠加（F-44）', async () => {
    const { mergeNote } = await import('../scripts/lib/cobuild-note.mjs')
    // ① 带修饰词的标签必须保留 external 归属，绝不误标成 framework
    const r1 = mergeNote('[framework] 框架已修', '[external 观察] 根 package.json 里有 typings')
    expect(r1).toBe('[framework] 框架已修\n[external] 根 package.json 里有 typings')
    expect(r1, '外部原文被误标成 framework').not.toMatch(/\[framework\]\s*\[external/)
    // ② 多段外部 note 逐段归属，不出现 `[external] [external]`
    const r2 = mergeNote(undefined, '[external] 影响…\n[external 建议] 应该…')
    expect(r2).toBe('[external] 影响…\n[external] 应该…')
    expect(r2, '重复标签').not.toMatch(/\[(external|framework)\]\s*\[(external|framework)\]/)
    // ③ 无标签原文原样保留（不擅自加归属）
    expect(mergeNote(undefined, '我复测通过了')).toBe('我复测通过了')
    // ④ 消费方自述 `[我方处置]` 归 external
    expect(mergeNote(undefined, '[我方处置] 不提交')).toBe('[external] 不提交')
    // ⑤ 历史脏数据自愈：外层误加的标签被剥离，取内层真归属
    expect(mergeNote('[external] [framework] 独立 import() 求值：12 个导出齐全', undefined)).toBe(
      '[framework] 独立 import() 求值：12 个导出齐全',
    )
    // ⑥ 幂等：结果再喂回自己必须完全不变
    const once = mergeNote('[external] a\n[framework] b', undefined)
    expect(mergeNote(once, undefined)).toBe(once)
    expect(mergeNote(mergeNote(once, 'c'), 'c')).toBe(mergeNote(once, 'c'))
  })

  // ★现网台账不得残留「标签叠加」脏数据（旧版 mergeNote 的产物）。
  //
  // ★2026-11-12 三次迭代（前两版都是假绿机，如实记录）：
  //   ① 首版 `toContain`/宽松正则 → 正文里**描述**这个 bug 的句子（F-35/F-44 就在描述
  //      `[framework] … ⇒ [external] [external] …`）被判成脏数据 ⇒ **误报**。
  //   ② 锚行首 + 剥反引号引用 → 不误报了，但注入真脏数据 `[external] [framework] x` 测试**仍绿**——
  //      因为 mergeNote 自身就会剥离它（自愈）⇒「判同步后」这个口径永远干净 ⇒ **测不到东西**。
  //   ③ 最终判据：**分别看同步前后**——① 脏数据必须被 mergeNote 清洗（有自愈能力）；
  //      ② 现网台账里不得还躺着未清洗的脏数据（真正的"残留"）。
  //      注入 `[external] [framework] x` → ② 立刻红（这就是破坏性验证的落点）。
  it('★台账无标签叠加残留 + mergeNote 具备自愈能力', async () => {
    const { mergeNote } = await import('../scripts/lib/cobuild-note.mjs')
    // ① 自愈能力：脏数据喂进去必须被清洗成单层
    expect(mergeNote('[external] [framework] 导出齐全', undefined)).toBe('[framework] 导出齐全')
    expect(mergeNote('[framework] [external · 第七轮] 复跑通过', undefined)).toBe('[external] 复跑通过')
    // ② 现网残留：台账里**当前**不得还有行首叠加（未清洗的）
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'docs/外部报告台账.json'), 'utf8')) as { entries: LedgerEntry[] }
    const dirty: string[] = []
    for (const e of raw.entries) {
      const note = String(e.verification_note ?? '')
      const bad = note.split('\n').some((l) => {
        // 剥掉被反引号/引号包裹的引用片段——它们在讲缺陷形态，不是真标签
        const scrubbed = l.replace(/`[^`]*`/g, '').replace(/“[^”]*”/g, '')
        return /^\s*\[(external|framework)\]\s*\[(external|framework)\b/.test(scrubbed)
      })
      if (bad) dirty.push(e.id)
    }
    expect(dirty, `台账里仍有未清洗的标签叠加：${dirty.join(', ')}`).toEqual([])
  })

  // ★2026-11-12：sync 必须能补齐 rounds[]——否则同步进新条目后，
  //   cobuild-check 规则 B（立项必须有出处）会因「rounds 无该轮 + 无 report_section」直接报红。
  //   ★破坏性：删掉 sync-cobuild.mjs 里 rounds-add 那段 → 本用例当场红。
  it('★sync 能从报告标题补齐 rounds[]（否则同步后规则 B 必红）', () => {
    const src = fs.readFileSync(path.join(root, 'scripts/sync-cobuild.mjs'), 'utf8')
    expect(src, 'rounds 补齐逻辑必须在位').toContain("kind: 'rounds-add'")
    expect(src, '补 rounds 时版本号取自报告标题').toContain('headingByRound')
    // 现网台账的 rounds 必须覆盖所有有條目的轮次（sync 跑过之后应恒成立）
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'docs/外部报告台账.json'), 'utf8')) as {
      rounds?: Array<{ round: number }>
      entries: Array<{ round: number }>
    }
    const known = new Set((raw.rounds ?? []).map((r) => Number(r.round)))
    const entryRounds = new Set(raw.entries.map((e) => Number(e.round)))
    // 早期轮次（1/2/9/10）靠 report_section 兜底，属历史形态，不算缺失
    const BY_SECTION = new Set([1, 2, 9, 10])
    for (const r of entryRounds) {
      if (BY_SECTION.has(r)) continue
      expect(known.has(r), `台账有第 ${r} 轮条目但 rounds[] 里没有——sync 补齐逻辑失效`).toBe(true)
    }
  })
})

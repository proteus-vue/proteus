// tests/codenames-gate.test.ts
// ★★★决策 #1110：**万神殿命名的对外纪律门禁**——把"散文纪律"变成机器判据。
//
// 【为什么有这个测试（本仓 2026-10-20 的真实事故）】
//   `Morpheus` 在官网当产品名用了很久，直到一次 npm 检索才发现**同域已有同名动画库**
//   ⇒ 被迫 117 文件全局改名（决策 #1108）。
//   当时的纪律只写在《万神殿命名规范》§3/§5 的散文里（「🟡/🔵 不得对外」），而**散文拦不住**。
//   ⇒ 落地 `scripts/check-codenames.mjs`（已接 verify 链 + CI），本文件守它**不被改弱**。
//
// 【本测试守什么（三层）】
//   ① 门禁本体**存在且接线**（scripts 条目 + verify 链 + CI）——"接线不靠记忆"；
//   ② 门禁**真的能抓问题**（三条破坏性：排除名单名字 / 未登记的未定名代号 / 规范表结构被改）；
//   ③ 门禁**不维护第二份名单**（名单必须从命名规范解析，否则迟早与 SSOT 分叉）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** 跑门禁，返回 { code, out }（**不吞退出码**——本仓纪律：判据看退出码，不看输出文本） */
function runGate(): { code: number; out: string } {
  try {
    const out = execFileSync('node', [path.join(ROOT, 'scripts/check-codenames.mjs')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

describe('★#1110 万神殿命名门禁 · 接线', () => {
  it('脚本存在，且已接进 verify 链与 CI（三道接线缺一不可）', () => {
    expect(fs.existsSync(path.join(ROOT, 'scripts/check-codenames.mjs'))).toBe(true)

    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['check:codenames'], 'package.json 缺 check:codenames').toBeTruthy()
    expect(pkg.scripts.verify, 'verify 链未接 check:codenames').toContain('check:codenames')

    const ci = read('.github/workflows/ci.yml')
    expect(ci, 'CI 未接 check-codenames（否则这道线只在本地跑）').toContain('check-codenames.mjs')
  })

  it('★不维护第二份名单：代号/状态必须从命名规范解析（否则与 SSOT 迟早分叉）', () => {
    const s = read('scripts/check-codenames.mjs')
    expect(s).toContain('Proteus_万神殿命名规范.md')
    // 解析的是 §3 / §4 两张表
    expect(s).toContain('## §3 万神殿总览')
    expect(s).toContain('## §4 排除名单')
    // 解析自检（表结构变了不许静默全过）
    expect(s).toMatch(/SANITY/)
    expect(s).toMatch(/解析自检/)
  })

  it('★公开债务账本存在且每条有检索证据（PUBLIC_PENDING 不是"允许清单"）', () => {
    const s = read('scripts/check-codenames.mjs')
    const m = s.match(/const PUBLIC_PENDING = \{([\s\S]*?)\n\}/)
    expect(m, '找不到 PUBLIC_PENDING').toBeTruthy()
    const body = m![1]
    // 每条都必须写明检索依据（出现「粗查」或「检索」字样）
    const entries = body.split('\n').filter((l) => /^\s{2}[A-Z][A-Za-z]+:/.test(l))
    expect(entries.length, 'PUBLIC_PENDING 条目解析异常').toBeGreaterThan(0)
    for (const e of entries) {
      expect(/粗查|检索|npm/.test(e), `PUBLIC_PENDING 条目缺检索证据：${e.trim().slice(0, 40)}`).toBe(true)
    }
  })

  it('★能力边界写清楚（不能让人误以为这工具能查外部撞名）', () => {
    const s = read('scripts/check-codenames.mjs')
    expect(s).toMatch(/不能.*检测|查不出|能力边界/)
    expect(s).toMatch(/商标/)
  })
})

describe('★#1110 万神殿命名门禁 · 现行状态', () => {
  it('当前对外面通过（排除名单无泄漏 + 未定名代号均已登记）', () => {
    const { code, out } = runGate()
    expect(code, `门禁未通过：\n${out.slice(0, 800)}`).toBe(0)
  })

  it('现存债务账本被如实打印（不许沉默）', () => {
    const { out } = runGate()
    expect(out).toMatch(/存量债务账本/)
    for (const n of ['Kairos', 'Themis', 'Keryx', 'Aether']) {
      expect(out.includes(n), `账本未列出 ${n}`).toBe(true)
    }
  })
})

describe('★#1110 万神殿命名门禁 · 破坏性（判据必须能被证伪）', () => {
  const SPEC = 'docs/Proteus_万神殿命名规范.md'
  const TARGET = 'website/guides/02-difference.md'

  /** 临时改文件 → 跑门禁 → 必还原（失败也要还原） */
  function withTempEdit(file: string, edit: (src: string) => string, fn: () => void): void {
    const abs = path.join(ROOT, file)
    const orig = fs.readFileSync(abs, 'utf8')
    try {
      const next = edit(orig)
      if (next === orig) throw new Error(`${file} 未被改动（edit 无效果）`)
      fs.writeFileSync(abs, next)
      fn()
    } finally {
      fs.writeFileSync(abs, orig)
    }
  }

  it('★B-1：注入「排除名单名字」（Iris）⇒ 必须红（R1）', () => {
    withTempEdit(
      TARGET,
      (s) => s.replace(/^(# .+)$/m, '$1\n\nIris 是排除名单里的名字。'),
      () => {
        const { code, out } = runGate()
        expect(code, 'R1 未生效：排除名单名字注入后仍通过').toBe(1)
        expect(out).toContain('R1')
        expect(out).toContain('Iris')
      },
    )
  })

  it('★B-2：注入「未登记的未定名代号」（Hephaestus）⇒ 必须红（R2）', () => {
    withTempEdit(
      TARGET,
      (s) => s.replace(/^(# .+)$/m, '$1\n\nHephaestus 是未登记的待检索代号。'),
      () => {
        const { code, out } = runGate()
        expect(code, 'R2 未生效：未定名代号注入后仍通过').toBe(1)
        expect(out).toContain('R2')
        expect(out).toContain('Hephaestus')
      },
    )
  })

  it('★B-3：规范表结构被改（§4 标题变了）⇒ 必须判解析失败（不静默全过）', () => {
    withTempEdit(
      SPEC,
      (s) => s.replace(/^## §4 排除名单.*$/m, '## §4 名字变了'),
      () => {
        const { code, out } = runGate()
        expect(code, '解析失败未被判红（门禁会静默全过）').toBe(2)
        expect(out).toMatch(/结构变了|解析/)
      },
    )
  })
})

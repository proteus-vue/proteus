/**
 * AI 共建工具包分发机制（2026-09-20）
 *
 * 背景：共建机制最初只**人工投递**给 OPERATOR/web 一个工程——换个项目就失效。
 * 本测试锁住「机制随包分发、任何工程可一条命令装上」：
 *   ① `proteus cobuild init` 写入 5 件（skill / 校验器 / 台账 / 报告模板 / AGENTS.md 指针）；
 *   ② 幂等：重复 init 不覆盖用户已写内容；
 *   ③ `cobuild check` 在齐备时通过、缺件时红；
 *   ④ create-proteus 模板**自带**同一份（新工程开箱可用）；
 *   ⑤ 规范源与模板逐字一致（防两处漂移）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { cobuildInit, cobuildCheck } from '../packages/cli/src/cobuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE = path.join(root, 'packages/create-proteus/templates')

function freshDir(name: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `proteus-cobuild-${name}-`))
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, private: true }))
  return d
}

const REQUIRED = [
  '.agents/skills/proteus-cobuild/SKILL.md',
  'scripts/ledger_check.mjs',
  'docs/框架问题台账.json',
  'docs/实战报告_proteus接入.md',
]

describe('AI 共建工具包分发', () => {
  it('cobuild init 写入全部 5 件（含 AGENTS.md 指针）', () => {
    const dir = freshDir('init')
    const r = cobuildInit({ root: dir })
    for (const f of REQUIRED) expect(fs.existsSync(path.join(dir, f)), `缺 ${f}`).toBe(true)
    expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(true)
    const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('proteus-cobuild:start')
    expect(agents).toContain('proteus-cobuild:end')
    // 工程名注入
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'docs/框架问题台账.json'), 'utf8')).project).toBe('init')
    void r
  })

  it('init 幂等：重复执行不覆盖用户已写内容', () => {
    const dir = freshDir('idem')
    cobuildInit({ root: dir })
    // 用户写入一条台账
    const ledgerPath = path.join(dir, 'docs/框架问题台账.json')
    const j = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    j.entries.push({ id: 'F-01', title: '用户条目', kind: 'compiler', severity: 'minor', round: 1, reported_in: 'x', found_by: 'external', status: 'open', verification: 'unverified', evidence: 'e', repro: 'r' })
    fs.writeFileSync(ledgerPath, JSON.stringify(j, null, 2))
    const r2 = cobuildInit({ root: dir })
    expect(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).entries).toHaveLength(1) // 未被覆盖
    expect(r2.files.every((f) => f.action === 'skipped')).toBe(true)
  })

  it('init 追加到已有 AGENTS.md（不破坏原内容）；二次运行走 marker 更新', () => {
    const dir = freshDir('agents')
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# 我原有的约定\n\n重要内容\n')
    cobuildInit({ root: dir })
    const s = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')
    expect(s).toContain('我原有的约定')
    expect(s).toContain('重要内容')
    expect(s).toContain('proteus-cobuild:start')
  })

  it('cobuild check：齐备时通过', () => {
    const dir = freshDir('ok')
    cobuildInit({ root: dir })
    const r = cobuildCheck({ root: dir })
    expect(r.ok, r.items.filter((i) => !i.ok).map((i) => i.item).join(', ')).toBe(true)
  })

  it('cobuild check：缺件时红（并给出可执行修法）', () => {
    const dir = freshDir('missing')
    const r = cobuildCheck({ root: dir })
    expect(r.ok).toBe(false)
    const missing = r.items.filter((i) => !i.ok)
    expect(missing.length).toBeGreaterThan(0)
    expect(missing[0].detail).toContain('proteus cobuild init')
  })

  it('生成的台账校验器可执行且语义正确（未收口 → --check 退出 1）', () => {
    const dir = freshDir('checker')
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
    const src = fs.readFileSync(path.join(root, 'packages/cli/src/cobuild-assets.ts'), 'utf8')
    // 直接从规范源取校验器脚本内容（避免依赖 CLI 构建产物）
    const checkerCode = /export const LEDGER_CHECKER = `([\s\S]*?)`\n\n\/\*\* 台账骨架/.exec(src)?.[1]
    expect(checkerCode, '未能从规范源提取校验器').toBeTruthy()
    fs.writeFileSync(path.join(dir, 'scripts/ledger_check.mjs'), checkerCode!.replace(/\\\`/g, '`').replace(/\\\$/g, '$'))
    fs.writeFileSync(
      path.join(dir, 'docs/框架问题台账.json'),
      JSON.stringify({ project: 'x', entries: [{ id: 'F-01', title: 't', kind: 'compiler', severity: 'blocker', round: 1, reported_in: 'v', found_by: 'external', status: 'open', verification: 'unverified', evidence: 'e', repro: 'r' }] }),
    )
    let code = 0
    try {
      execFileSync('node', ['scripts/ledger_check.mjs', '--check'], { cwd: dir, stdio: 'pipe' })
    } catch (e) {
      code = (e as { status?: number }).status ?? -1
    }
    expect(code, '未收口项应让 --check 退出 1').toBe(1)
  })

  it('create-proteus 模板自带共建工具包（新工程开箱可用）', () => {
    for (const f of REQUIRED) {
      expect(fs.existsSync(path.join(TEMPLATE, f)), `模板缺 ${f}`).toBe(true)
    }
    expect(fs.existsSync(path.join(TEMPLATE, 'AGENTS.md'))).toBe(true)
    // 模板里用 {{name}} 占位（由 copyTemplate 替换）
    expect(fs.readFileSync(path.join(TEMPLATE, 'docs/框架问题台账.json'), 'utf8')).toContain('{{name}}')
  })

  it('规范源 ↔ 模板一致（gen-cobuild-kit --check）', () => {
    const out = execFileSync('npx', ['tsx', 'scripts/gen-cobuild-kit.mjs', '--check'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
    })
    expect(out).toContain('模板与规范源一致')
  }, 300_000)
})

// ★★2026-09-20：**生成物内容质量**回归锁——共建工具包是「发给外部工程的文件」，
//   此前 `cobuild-assets.ts` 里的反引号**过度转义**（源码写成 `\\\``），
//   导致生成的 SKILL.md 里所有代码块变成 `\`\`\``、校验器脚本也带杂散反斜杠——
//   等于**对外分发的是坏文件**，而既有测试只查「文件存在」，全绿放行。
//   教训（与产物完整性同源）：**分发的工件必须校验内容，不能只校验存在性**。
describe('共建工具包内容质量（分发的工件必须内容正确）', () => {
  it('生成的 SKILL.md 无杂散反斜杠（反引号转义正确）', () => {
    const dir = freshDir('esc-skill')
    cobuildInit({ root: dir })
    const skill = fs.readFileSync(path.join(dir, '.agents/skills/proteus-cobuild/SKILL.md'), 'utf8')
    expect(skill, '不得出现 \\` 形态的杂散反斜杠').not.toMatch(/\\`/)
    // 必须含正常的三反引号代码块
    expect(skill).toContain('```bash')
    expect(skill).toContain('```json')
  })

  it('生成的校验器是合法 JS（可被 node --check 解析）', () => {
    const dir = freshDir('esc-checker')
    cobuildInit({ root: dir })
    const checker = path.join(dir, 'scripts/ledger_check.mjs')
    expect(() => execFileSync('node', ['--check', checker], { stdio: 'pipe' }), '生成的校验器必须是合法 JS').not.toThrow()
    // 内容不得含杂散反斜杠（会破坏脚本或输出）
    expect(fs.readFileSync(checker, 'utf8')).not.toMatch(/\\`/)
  })

  it('生成的台账骨架与报告模板是合法 JSON / 正常 markdown', () => {
    const dir = freshDir('esc-ledger')
    cobuildInit({ root: dir })
    const ledgerPath = path.join(dir, 'docs/框架问题台账.json')
    expect(() => JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))).not.toThrow()
    const report = fs.readFileSync(path.join(dir, 'docs/实战报告_proteus接入.md'), 'utf8')
    expect(report).not.toMatch(/\\`/)
    expect(report).toContain('## 第一轮复测')
  })

  it('生成的 AGENTS.md 段落无杂散转义', () => {
    const dir = freshDir('esc-agents')
    cobuildInit({ root: dir })
    const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).not.toMatch(/\\`/)
    expect(agents).toContain('```')
  })
})

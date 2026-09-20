// packages/cli/src/cobuild.ts
// ★proteus cobuild —— AI 共建工具包的**分发入口**（任何使用 Proteus 的工程都能装上）
//
// 解决的问题（2026-09-20 用户提问「换个项目怎么办」）：
//   共建机制此前只**人工投递**给了 OPERATOR/web 一个工程——换一个项目就失效。
//   正确做法是让机制**随框架包分发**、可一条命令安装到任意工程：
//     proteus cobuild init     # 安装工具包（幂等，可重复跑）
//     proteus cobuild check    # 自检（文件齐备 + AGENTS.md 指针在位）
//   新工程则由 create-proteus 模板**自带**（脚手架生成即有），无需手动 init。
//
// 设计要点：
//   · 规范源 = packages/cli/src/cobuild-assets.ts（随 dist 发布，不依赖网络/框架仓库路径/人工复制）；
//   · init 幂等：已存在的文件不覆盖（除非 --force），AGENTS.md 用 marker 段落插入/更新；
//   · check 可挂 CI/发布前：缺失即 exit 1，并打印可执行修法。
import fs from 'node:fs'
import path from 'node:path'
import {
  COBUILD_SKILL,
  LEDGER_CHECKER,
  ledgerSkeleton,
  reportTemplate,
  AGENTS_MARKER_START,
  AGENTS_MARKER_END,
  AGENTS_SECTION,
} from './cobuild-assets'

export interface CobuildOptions {
  /** 目标工程根（默认 cwd） */
  root?: string
  /** 覆盖已存在文件（默认 false——已存在则跳过并提示） */
  force?: boolean
}

export interface CobuildFileResult {
  /** 工程相对路径 */
  file: string
  action: 'created' | 'updated' | 'skipped' | 'appended'
}

export interface CobuildInitResult {
  root: string
  files: CobuildFileResult[]
}

/** 工程名（读 package.json 的 name；缺失用目录名） */
function projectName(root: string): string {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    if (j.name && typeof j.name === 'string') return j.name
  } catch {
    /* 无 package.json */
  }
  return path.basename(root)
}

/** 写入一个文件（幂等：内容相同 → skipped；已存在且不同 → 需 force） */
function writeFile(root: string, rel: string, content: string, force: boolean): CobuildFileResult {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  if (fs.existsSync(abs)) {
    const cur = fs.readFileSync(abs, 'utf8')
    if (cur === content) return { file: rel, action: 'skipped' }
    if (!force) return { file: rel, action: 'skipped' }
    fs.writeFileSync(abs, content)
    return { file: rel, action: 'updated' }
  }
  fs.writeFileSync(abs, content)
  return { file: rel, action: 'created' }
}

/** 在 AGENTS.md 里插入/更新共建指针段落（marker 幂等；无该文件则创建） */
function upsertAgentsSection(root: string, force: boolean): CobuildFileResult {
  const rel = 'AGENTS.md'
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) {
    fs.writeFileSync(abs, `# AGENTS.md —— 本工程对 AI 会话的约定\n\n${AGENTS_SECTION}`)
    return { file: rel, action: 'created' }
  }
  const cur = fs.readFileSync(abs, 'utf8')
  const start = cur.indexOf(AGENTS_MARKER_START)
  const end = cur.indexOf(AGENTS_MARKER_END)
  if (start >= 0 && end > start) {
    const next = cur.slice(0, start) + AGENTS_SECTION + cur.slice(end + AGENTS_MARKER_END.length + 1)
    if (next === cur) return { file: rel, action: 'skipped' }
    if (!force) return { file: rel, action: 'skipped' }
    fs.writeFileSync(abs, next)
    return { file: rel, action: 'updated' }
  }
  // 未插入过 → 追加到文件末尾（保留原有内容）
  fs.writeFileSync(abs, cur.replace(/\n?$/, '\n') + '\n' + AGENTS_SECTION)
  return { file: rel, action: 'appended' }
}

/** 安装共建工具包到工程（幂等；可重复运行） */
export function cobuildInit(opts: CobuildOptions = {}): CobuildInitResult {
  const root = path.resolve(opts.root ?? process.cwd())
  const force = Boolean(opts.force)
  const name = projectName(root)
  const files: CobuildFileResult[] = [
    writeFile(root, '.agents/skills/proteus-cobuild/SKILL.md', COBUILD_SKILL, force),
    writeFile(root, 'scripts/ledger_check.mjs', LEDGER_CHECKER, force),
    writeFile(root, 'docs/框架问题台账.json', ledgerSkeleton(name), force),
    writeFile(root, 'docs/实战报告_proteus接入.md', reportTemplate(name), force),
    upsertAgentsSection(root, force),
  ]
  return { root, files }
}

/** 共建文件清单（check 用；AGENTS.md 单独判指针） */
const REQUIRED_FILES = [
  '.agents/skills/proteus-cobuild/SKILL.md',
  'scripts/ledger_check.mjs',
  'docs/框架问题台账.json',
  'docs/实战报告_proteus接入.md',
]

export interface CobuildCheckItem {
  item: string
  ok: boolean
  detail?: string
}

/** 自检：文件齐备 + AGENTS.md 指针在位 + 台账可解析 */
export function cobuildCheck(opts: CobuildOptions = {}): { root: string; items: CobuildCheckItem[]; ok: boolean } {
  const root = path.resolve(opts.root ?? process.cwd())
  const items: CobuildCheckItem[] = []
  for (const rel of REQUIRED_FILES) {
    const ok = fs.existsSync(path.join(root, rel))
    items.push({ item: rel, ok, detail: ok ? undefined : `缺失（跑 proteus cobuild init 生成）` })
  }
  // AGENTS.md 指针
  const agentsAbs = path.join(root, 'AGENTS.md')
  if (!fs.existsSync(agentsAbs)) {
    items.push({ item: 'AGENTS.md 共建指针', ok: false, detail: '无 AGENTS.md（跑 proteus cobuild init 生成）' })
  } else {
    const src = fs.readFileSync(agentsAbs, 'utf8')
    const has = src.includes(AGENTS_MARKER_START) && src.includes(AGENTS_MARKER_END)
    items.push({
      item: 'AGENTS.md 共建指针',
      ok: has,
      detail: has ? undefined : '缺共建段落（跑 proteus cobuild init 插入；AI 新会话靠它找到入口）',
    })
  }
  // 台账可解析 + 有合法 id 命名
  const ledgerAbs = path.join(root, 'docs/框架问题台账.json')
  if (fs.existsSync(ledgerAbs)) {
    try {
      const j = JSON.parse(fs.readFileSync(ledgerAbs, 'utf8'))
      const ok = Array.isArray(j.entries)
      items.push({ item: '台账结构（entries 数组）', ok, detail: ok ? `共 ${j.entries.length} 条` : 'entries 不是数组' })
    } catch (e) {
      items.push({ item: '台账结构（entries 数组）', ok: false, detail: `JSON 解析失败：${(e as Error).message}` })
    }
  }
  return { root, items, ok: items.every((i) => i.ok) }
}

/** 文本报告（CLI 输出用） */
export function formatCobuildInit(r: CobuildInitResult): string {
  const lines = [`[cobuild] 共建工具包已安装 → ${r.root}`]
  for (const f of r.files) {
    const tag = { created: '✓ 新建', updated: '✓ 更新', appended: '✓ 追加', skipped: '· 跳过（已存在且相同）' }[f.action]
    lines.push(`  ${tag}  ${f.file}`)
  }
  const skipped = r.files.filter((f) => f.action === 'skipped').length
  if (skipped) lines.push(`  （${skipped} 项已存在未改动；确要覆盖用 --force）`)
  lines.push('')
  lines.push('下一步：')
  lines.push('  1) 让 AI 会话挂载 Skill(proteus-cobuild)——撞到框架问题时按它写报告与台账')
  lines.push('  2) 自检：proteus cobuild check')
  lines.push('  3) 台账校验：node scripts/ledger_check.mjs [--check]')
  return lines.join('\n')
}

export function formatCobuildCheck(r: { root: string; items: CobuildCheckItem[]; ok: boolean }): string {
  const lines = [`[cobuild] 共建文件自检 → ${r.root}`]
  for (const i of r.items) {
    lines.push(`  ${i.ok ? '✅' : '❌'} ${i.item}${i.detail ? `  —— ${i.detail}` : ''}`)
  }
  lines.push('')
  lines.push(r.ok ? '✅ 共建工具包齐备——可按 .agents/skills/proteus-cobuild/SKILL.md 提交报告与台账' : '✗ 有缺失：跑 proteus cobuild init 补齐（幂等，不会覆盖你已写的报告/台账内容）')
  return lines.join('\n')
}

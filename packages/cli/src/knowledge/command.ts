// packages/cli/src/knowledge/command.ts
// ★★G-54 M0 命令面（决策 #1153）：`proteus knowledge <layers|graph|check|why>`
//
// 【为什么单独一个文件（而不是塞进 index.ts）】
//   `packages/cli/src/index.ts` 已 1101 行、棘轮基线 1102（只减不增）。命令实现放这里，
//   index.ts 只留 **1 行 import + 1 行 case** —— 巨型化门禁的结构性解法是"新逻辑不进大文件"，
//   不是"把大文件基线调高"（#872）。
//
// 【设计纪律】
//   · **纯输出层**：本文件不含任何图/层算法，只做「IO 定位 → 调内核 → 格式化」；
//   · `--json` 时 stdout **只有 JSON**（可被 CI / IDE / 未来 Studio 直接消费），人类提示走 stderr；
//   · 无 `--json` 时**零 ANSI**（`check:*` 门禁会 grep 这些输出，带色码会炸）；
//   · 缺省在**仓库根**定位 `packages/`：从 cwd 向上找 `pnpm-workspace.yaml` + `packages/`，
//     找不到就报错并给 `--packages <dir>` 的修法（不静默跑空图 —— 空图会给出"0 违规"的假绿）。
//
// 【未实现的能力不假装】
//   ① resolveCall / ③ locateAssertion / ⑥ previewVariants 尚无数据源，
//   本命令面**不接受**它们的子命令（`proteus knowledge call` 会明确报"未实现"，不是 "未知子命令"）。
//   ⑤ affectedDevices 已在 #1178 落地（`knowledge devices`）——数据源 = capabilities 的
//   `adapters` 键名（平台集合），不是新造的表。

import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  ARCH_LAYERS,
  LAYER_LABEL,
  LAYER_RANK,
  PACKAGE_LAYERS,
  createKnowledgeProvider,
  loadManifests,
  packagesInLayer,
  type ArchLayer,
  type LayeringViolation,
  type PackageManifest,
} from './index'

/** 已实现的能力（子命令 → 能力编号）；未实现的能力在这里**不出现** */
const SUBCOMMANDS = ['layers', 'graph', 'check', 'why', 'devices'] as const
type Subcommand = (typeof SUBCOMMANDS)[number]

const HELP = `proteus knowledge —— 框架知识内核（G-54 M0 · 决策 #1153）

用法：
  proteus knowledge layers [--json]                 分层表（L0–L5）+ 每层包列表 + 漏登记检查
  proteus knowledge graph  [--json] [--reverse <pkg>] SPI 拓扑：节点/边/环/自环 + 反向依赖
  proteus knowledge check  [--json] [--dev]          分层守护：生产边越层 → exit 1（--dev 附带 devDeps 信息位）
  proteus knowledge why <from> <to> [--json]         单条判定（from 依赖 to 是否越层）
  proteus knowledge devices [<spiId>] [--json]       ⑤ 能力 → 设备等价类影响面（不传 id = 列全部）

通用选项：
  --packages <dir>   packages/ 所在目录（缺省从 cwd 向上找仓库根）
  --json             机器可读输出（stdout 只有 JSON）

能力边界（诚实声明）：
  已实现 ② checkLayering（分层守护）/ ④ buildGraph（SPI 拓扑）/ ⑤ affectedDevices（能力影响面）
  未实现 ① resolveCall / ③ locateAssertion / ⑥ previewVariants
         —— 数据源未就绪，不提供子命令、不返回占位假数据。
  ⑤ 的数据源 = capabilities 描述文件的 adapters 键（= 平台集合），与 check:capability-golden 同源。`

interface Flags {
  json: boolean
  dev: boolean
  packagesDir?: string
  reverse?: string
  rest: string[]
}

/** 解析本命令的旗标（不复用 args.ts：那里的解析器都是「命令专属」写法定式） */
function parseFlags(argv: readonly string[]): Flags {
  const f: Flags = { json: false, dev: false, rest: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--json') f.json = true
    else if (a === '--dev') f.dev = true
    else if (a === '--packages') f.packagesDir = argv[++i]
    else if (a.startsWith('--packages=')) f.packagesDir = a.slice('--packages='.length)
    else if (a === '--reverse') f.reverse = argv[++i]
    else if (a.startsWith('--reverse=')) f.reverse = a.slice('--reverse='.length)
    else f.rest.push(a)
  }
  return f
}

/**
 * 定位 `packages/` 目录。
 * ★找不到就抛错（**不**回落到空图）：空图会输出"0 节点 / 0 违规"，那是假绿（#1139 同族）。
 * @param explicit `--packages` 显式指定（存在即用，不再向上找）
 * @param startDir 起点目录（缺省 cwd；测试注入，避免 `process.chdir` 在 worker 里不可用）
 */
export function resolvePackagesDir(explicit?: string, startDir: string = process.cwd()): string {
  if (explicit) {
    const p = path.resolve(explicit)
    if (!existsSync(p)) throw new Error(`--packages 指向的目录不存在：${p}`)
    return p
  }
  let dir = path.resolve(startDir)
  for (let i = 0; i < 10; i++) {
    const cand = path.join(dir, 'packages')
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml')) && existsSync(cand)) return cand
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `未找到仓库根（其下需同时有 pnpm-workspace.yaml 与 packages/）。请用 --packages <dir> 指定 packages/ 目录，或在本仓任一子目录下运行。`,
  )
}

/** 磁盘包集合 vs 分层表：漏登记、幽灵条目（表里有、磁盘没有） */
function auditRegistration(manifests: readonly PackageManifest[]): { missing: string[]; ghosts: string[] } {
  const onDisk = new Set(manifests.map((m) => m.dir))
  const inTable = new Set(Object.keys(PACKAGE_LAYERS))
  return {
    missing: [...onDisk].filter((d) => !inTable.has(d)).sort(),
    ghosts: [...inTable].filter((d) => !onDisk.has(d)).sort(),
  }
}

function pad(s: string, n: number): string {
  // 中文按 2 列宽估算（仅用于表格对齐；非 TTY 也稳定）
  const w = [...s].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)
  return s + ' '.repeat(Math.max(0, n - w))
}

// ── layers ──────────────────────────────────────────────────────────
function runLayers(manifests: readonly PackageManifest[], flags: Flags): number {
  const { missing, ghosts } = auditRegistration(manifests)
  const rows = ARCH_LAYERS.map((layer) => ({ layer, packages: packagesInLayer(layer) }))
  const registered = Object.keys(PACKAGE_LAYERS).length

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          kind: 'knowledge.layers',
          onDisk: manifests.length,
          registered,
          layers: rows.map((r) => ({ layer: r.layer, rank: LAYER_RANK[r.layer], label: LAYER_LABEL[r.layer], packages: r.packages })),
          missing,
          ghosts,
        },
        null,
        2,
      ),
    )
    return missing.length || ghosts.length ? 1 : 0
  }

  console.log(`[proteus-knowledge] 架构分层（磁盘 ${manifests.length} 包 / 表内登记 ${registered}）`)
  for (const { layer, packages } of rows) {
    console.log(`  ${layer}  ${pad(LAYER_LABEL[layer], 12)} ${String(packages.length).padStart(2)} 个  ${packages.join(' ') || '—'}`)
  }
  if (missing.length) {
    console.log('')
    console.log(`✗ 漏登记 ${missing.length} 个包（内核不会替它们猜层，越层诊断对其失明）：`)
    console.log(`  ${missing.join(' ')}`)
    console.log('  修法：在 packages/cli/src/knowledge/layer-map.ts 的 PACKAGE_LAYERS 登记层号')
    return 1
  }
  if (ghosts.length) {
    console.log('')
    console.log(`✗ 幽灵条目 ${ghosts.length} 个（表里有、磁盘 packages/ 下已不存在）：`)
    console.log(`  ${ghosts.join(' ')}`)
    console.log('  修法：从 layer-map.ts 删除这些条目（过期索引比没有索引更糟 · #1139）')
    return 1
  }
  console.log('')
  console.log('✓ 登记完整：磁盘每个包都有层号，表内无幽灵条目')
  return 0
}

// ── graph ───────────────────────────────────────────────────────────
function runGraph(manifests: readonly PackageManifest[], flags: Flags): number {
  const p = createKnowledgeProvider(manifests)
  const g = p.buildGraph()

  // 入度（被依赖次数）——"改这个包会波及谁"的最短答案
  const indeg = g.nodes.map((n) => ({ pkg: n, layer: PACKAGE_LAYERS[n] ?? null, count: (g.reverseDeps[n] ?? []).length }))
  indeg.sort((a, b) => b.count - a.count || a.pkg.localeCompare(b.pkg))
  const top = indeg.filter((x) => x.count > 0).slice(0, 8)

  if (flags.json) {
    const payload: Record<string, unknown> = {
      kind: 'knowledge.graph',
      nodes: g.nodes.length,
      edges: g.edges.length,
      cycles: g.cycles,
      sccs: g.sccs,
      selfLoops: g.selfLoops,
      reverseDeps: g.reverseDeps,
      inDegreeTop: top,
    }
    if (flags.reverse) {
      const target = flags.reverse
      if (!g.nodes.includes(target)) {
        console.error(`[proteus-knowledge] 图中没有节点 ${target}（用 proteus knowledge layers 查包名）`)
        return 1
      }
      payload.reverseOf = { pkg: target, dependents: g.reverseDeps[target] ?? [] }
    }
    console.log(JSON.stringify(payload, null, 2))
    return g.cycles.length || g.selfLoops.length ? 1 : 0
  }

  console.log(`[proteus-knowledge] SPI 拓扑：${g.nodes.length} 节点 / ${g.edges.length} 条生产依赖边`)
  console.log(`  环 ${g.cycles.length} · 强连通分量 ${g.sccs.length} · 自环 ${g.selfLoops.length}`)

  if (flags.reverse) {
    const target = flags.reverse
    if (!g.nodes.includes(target)) {
      console.log('')
      console.log(`✗ 图中没有节点 ${target}（用 proteus knowledge layers 查包名）`)
      return 1
    }
    const dependents = g.reverseDeps[target] ?? []
    console.log('')
    console.log(`  ${target} 被 ${dependents.length} 个包直接依赖：`)
    for (const d of dependents) console.log(`    ${d}（${PACKAGE_LAYERS[d] ?? '未登记'}）`)
    return 0
  }

  if (top.length) {
    console.log('')
    console.log('  被依赖最多（改动波及面最大）：')
    for (const t of top) console.log(`    ${pad(t.pkg, 20)} ${t.layer ?? '??'}  ${String(t.count).padStart(2)} 个包依赖它`)
  }

  if (g.selfLoops.length) {
    console.log('')
    console.log(`✗ 自环 ${g.selfLoops.length} 个：${g.selfLoops.join(' ')}`)
  }
  if (g.cycles.length) {
    console.log('')
    console.log(`✗ 依赖成环 ${g.cycles.length} 处：`)
    for (const c of g.cycles) console.log(`    ${c.join(' → ')}`)
    return 1
  }
  if (!g.selfLoops.length) {
    console.log('')
    console.log('✓ 无环、无自环')
  }
  return g.selfLoops.length ? 1 : 0
}

// ── check ───────────────────────────────────────────────────────────
function formatViolation(v: LayeringViolation): string {
  const diff = v.diff === null ? '?' : String(v.diff)
  return `  ${v.verdict.padEnd(10)} ${v.from}（${v.fromLayer ?? '?'}）→ ${v.to}（${v.toLayer ?? '?'}）  diff=${diff}`
}

/** `check` 的纯计算结果（命令面与 gate 注册表**共用**——gate.ts 不复制判定逻辑） */
export interface KnowledgeCheckReport {
  ok: boolean
  edges: number
  prod: LayeringViolation[]
  dev: LayeringViolation[]
  missing: string[]
  cycles: string[][]
  selfLoops: string[]
  /** 人类可读全文（零 ANSI；`--json` 时不使用） */
  text: string
}

/**
 * 分层守护的统一判定（**纯函数**：只吃清单，不 IO、不打印）。
 *
 * ★为什么抽出来：`proteus knowledge check` 与 `proteus gate run knowledge` 是两条入口。
 *   若各写一遍判定，必然漂成两套口径——这正是 #1153 独立验证抓到的缺陷类型
 *   （图里没有 devDeps 边、判定却按层判 ⇒ 同一对包两套答案）。**一个判定，两个出口。**
 */
export function evaluateKnowledgeCheck(manifests: readonly PackageManifest[], opts: { dev?: boolean } = {}): KnowledgeCheckReport {
  const p = createKnowledgeProvider(manifests)
  const prod = p.diagnoseLayering()
  const dev = opts.dev ? p.diagnoseDevLayering() : []
  const graph = p.buildGraph()
  const { missing } = auditRegistration(manifests)

  // ★漏登记必须判红：否则"新包没层号"会被静默忽略，越层诊断对其完全失明
  const ok = prod.length === 0 && missing.length === 0 && graph.cycles.length === 0 && graph.selfLoops.length === 0

  const lines: string[] = [`[proteus-knowledge] 分层守护：${graph.edges.length} 条生产依赖边`]
  if (missing.length) lines.push('', `✗ 未登记分层的包 ${missing.length} 个（对越层诊断失明）：${missing.join(' ')}`)
  if (graph.selfLoops.length) lines.push('', `✗ 自环 ${graph.selfLoops.length} 个：${graph.selfLoops.join(' ')}`)
  if (graph.cycles.length) {
    lines.push('', `✗ 依赖成环 ${graph.cycles.length} 处：`)
    for (const c of graph.cycles) lines.push(`    ${c.join(' → ')}`)
  }
  if (prod.length) {
    lines.push('', `✗ 越层 ${prod.length} 处：`)
    for (const v of prod) lines.push(formatViolation(v))
  }
  if (ok) lines.push('', '✓ 无越层、无环、无自环、无漏登记')
  if (dev.length) {
    lines.push('', `• devDeps 向上引用 ${dev.length} 处（信息位，不判红——测试框架引 CLI 属正常）：`)
    for (const v of dev) lines.push(`    ${v.from}（${v.fromLayer ?? '?'}）→ ${v.to}（${v.toLayer ?? '?'}）`)
  }

  return { ok, edges: graph.edges.length, prod, dev, missing, cycles: graph.cycles, selfLoops: graph.selfLoops, text: lines.join('\n') }
}

function runCheck(manifests: readonly PackageManifest[], flags: Flags): number {
  const r = evaluateKnowledgeCheck(manifests, { dev: flags.dev })
  if (flags.json) {
    console.log(
      JSON.stringify(
        { kind: 'knowledge.check', ok: r.ok, edges: r.edges, prod: r.prod, dev: r.dev, missing: r.missing, cycles: r.cycles, selfLoops: r.selfLoops },
        null,
        2,
      ),
    )
    return r.ok ? 0 : 1
  }
  console.log(r.text)
  return r.ok ? 0 : 1
}

// ── why ─────────────────────────────────────────────────────────────
function runWhy(rest: readonly string[], flags: Flags): number {
  const [from, to] = rest
  if (!from || !to) {
    console.error('[proteus-knowledge] 用法：proteus knowledge why <from> <to>（包目录名，如 web cli）')
    return 1
  }
  const p = createKnowledgeProvider([])
  const r = p.checkLayering(from, to)

  if (flags.json) {
    console.log(JSON.stringify({ kind: 'knowledge.why', from, to, ...r }, null, 2))
    return r.verdict === 'OK' ? 0 : 1
  }
  const mark = r.verdict === 'OK' ? '✓' : '✗'
  console.log(`[proteus-knowledge] ${mark} ${r.verdict}  ${from} → ${to}`)
  console.log(`  from 层：${r.fromLayer ?? '未登记'}    to 层：${r.toLayer ?? '未登记'}    diff：${r.diff ?? '?'}`)
  console.log(`  ${r.message}`)
  if (r.sameLayer) console.log('  注：同层依赖当前判 OK（G-55 §6 口径）；文档 §1 的「同层只经 contracts」尚未收紧')
  return r.verdict === 'OK' ? 0 : 1
}

// ── devices（⑤ affectedDevices）────────────────────────────────────
async function runDevices(rest: readonly string[], flags: Flags): Promise<number> {
  const packagesDir = resolvePackagesDir(flags.packagesDir)
  const root = path.dirname(packagesDir)
  const examples = path.join(root, 'examples')
  if (!existsSync(examples)) {
    console.error(`[proteus-knowledge] 找不到能力描述目录：${examples}`)
    console.error('  修法：⑤ 的数据源是 examples/**/ *.capability.ts（scanCapabilities 扫描根）')
    return 1
  }
  // 动态 import：只有 devices 子命令才拉起扫描器（esbuild），`check` 等门禁路径不付这份开销
  const { scanCapabilities } = await import('@proteus-vue/capabilities/scan')
  const { manifest, files } = await scanCapabilities(examples)
  const bad = files.filter((f) => !f.ok)
  const provider = createKnowledgeProvider([], manifest)
  const summary = provider.capabilitiesSummary()
  const spiId = rest[0]

  if (spiId) {
    const r = provider.affectedDevices(spiId)
    if (flags.json) {
      console.log(JSON.stringify({ kind: 'knowledge.devices', ...r }, null, 2))
      return r.known ? 0 : 1
    }
    if (!r.known) {
      // ★这里必须把"查无此能力"和"无影响面"分开说，否则读起来像"它不影响任何端"
      console.log(`[proteus-knowledge] ✗ 清单里没有能力「${spiId}」（已加载 ${summary.total} 条）`)
      console.log(`  这不是"无影响面"，是"查无此能力"。现有：${summary.ids.join(' ') || '（清单为空）'}`)
      return 1
    }
    console.log(`[proteus-knowledge] ✓ ${r.spiId} → ${r.deviceClasses.join(' ') || '（无端实现）'}`)
    if (r.entry?.name) console.log(`  名称：${r.entry.name}（tier ${r.entry.tier}）`)
    console.log(`  源：${r.entry?.source || '（清单未记录）'}`)
    if (r.deviceClasses.length === 0) console.log('  注：该能力当前没有任何端实现 —— 影响面为空是**事实**，不是数据缺失')
    return 0
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          kind: 'knowledge.devices',
          loaded: true,
          total: summary.total,
          byDeviceClass: summary.byDeviceClass,
          unknownDeviceClasses: summary.unknownDeviceClasses,
          capabilities: manifest.capabilities,
          scanErrors: bad,
        },
        null,
        2,
      ),
    )
    return bad.length ? 1 : 0
  }
  console.log(`[proteus-knowledge] 能力影响面（清单 ${summary.total} 条）`)
  for (const c of manifest.capabilities) {
    console.log(`  ${pad(c.id, 22)} T${c.tier}  ${pad(c.name ?? '', 12)} → ${c.platforms.join(' ') || '（无端实现）'}`)
  }
  const dist = Object.entries(summary.byDeviceClass)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ')
  console.log(`  按端：${dist || '（空）'}`)
  if (summary.unknownDeviceClasses.length) {
    console.log(`  ⚠ 未登记端：${summary.unknownDeviceClasses.join(' ')}（不在 web/skyline/app 内，核对 Platform 枚举）`)
  }
  if (bad.length) {
    console.log(`  ✗ ${bad.length} 个描述文件扫描失败：`)
    for (const b of bad.slice(0, 5)) console.log(`    ${b.file} —— ${b.error}`)
    return 1
  }
  return 0
}

/**
 * `proteus knowledge` 入口。
 * @param argv 子命令之后的参数（`process.argv.slice(2)` 去掉 `knowledge`）
 * @returns 进程退出码（调用方赋给 `process.exitCode`）
 */
export async function runKnowledgeCommand(argv: readonly string[]): Promise<number> {
  const sub = argv[0]
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(HELP)
    return 0
  }
  const flags = parseFlags(argv.slice(1))

  if (!(SUBCOMMANDS as readonly string[]).includes(sub)) {
    console.error(`[proteus-knowledge] 未知子命令：${sub}`)
    console.error(`  支持：${SUBCOMMANDS.join(' / ')}`)
    if (['call', 'resolve', 'assert', 'variants'].includes(sub)) {
      console.error('  注：① resolveCall / ③ locateAssertion / ⑥ previewVariants 尚未实现（数据源未就绪），不是拼写问题。')
    }
    return 1
  }

  // `why` 不需要读磁盘（纯查表）——避免在非仓库目录下也无法回答"这两个包能不能依赖"
  if (sub === 'why') return runWhy(flags.rest, flags)
  // `devices` 只需要能力清单，不需要包清单（⑤ 与分层/拓扑无关）
  if (sub === 'devices') return runDevices(flags.rest, flags)

  const packagesDir = resolvePackagesDir(flags.packagesDir)
  const manifests = loadManifests(packagesDir)

  switch (sub as Subcommand) {
    case 'layers':
      return runLayers(manifests, flags)
    case 'graph':
      return runGraph(manifests, flags)
    case 'check':
      return runCheck(manifests, flags)
    default:
      return runWhy(flags.rest, flags)
  }
}

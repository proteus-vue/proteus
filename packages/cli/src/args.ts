// packages/cli/src/args.ts
// CLI 参数解析（纯函数，可单测）——零依赖，手写解析
import fs from 'node:fs'
import path from 'node:path'
import type { TransformRuleOverrides } from '@proteus-vue/compiler'
import type { ProteusConfig } from '@proteus-vue/plugin-vite'

export interface BuildArgs {
  /** 输入目录（扫描 .vue） */
  inputDir: string
  /** 输出目录 */
  outDir: string
  px2rpx: boolean
  rpxRatio: number
  /** 调试构建（行号注释 + 决策 trace 落盘） */
  debug: boolean
  /** 规则覆盖（--rules <json-file>） */
  rules?: TransformRuleOverrides
  /** ★cli-plus M2：工程构建目标（--target web|skyline|all；缺省 = 独立编译） */
  target?: 'web' | 'skyline' | 'all'
}

export function parseBuildArgs(argv: string[]): BuildArgs {
  const args: BuildArgs = { inputDir: '.', outDir: 'dist', px2rpx: true, rpxRatio: 2, debug: false }
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (a === '--out' || a === '-o') {
      args.outDir = argv[++i]
      if (args.outDir == null) throw new Error('--out 需要目录参数')
    } else if (a === '--debug') {
      args.debug = true
    } else if (a === '--target') {
      const t = argv[++i]
      if (t !== 'web' && t !== 'skyline' && t !== 'all') throw new Error(`--target 需为 web/skyline/all（${t ?? '空'}）`)
      args.target = t
    } else if (a === '--no-px2rpx') {
      args.px2rpx = false
    } else if (a === '--rpx-ratio') {
      args.rpxRatio = Number(argv[++i])
      if (Number.isNaN(args.rpxRatio)) throw new Error('--rpx-ratio 需要数字参数')
    } else if (a === '--rules') {
      const file = argv[++i]
      if (!file) throw new Error('--rules 需要 JSON 文件路径')
      args.rules = readRulesJson(file)
    } else if (a.startsWith('-')) {
      throw new Error(`未知选项：${a}（可用 --out/-o、--debug、--no-px2rpx、--rpx-ratio、--rules）`)
    } else if (!args.inputDir || args.inputDir === '.') {
      // 第一个位置参数 = 输入目录
      args.inputDir = a
    } else {
      throw new Error(`多余参数：${a}`)
    }
    i++
  }
  return args
}

function readRulesJson(file: string): TransformRuleOverrides {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as TransformRuleOverrides
}

export interface ExplainArgs {
  /** .vue 文件路径 或 规则 ID */
  target: string
}

export function parseExplainArgs(argv: string[]): ExplainArgs {
  const target = argv[0]
  if (!target) throw new Error('proteus explain 需要一个参数：<vue 文件路径 | 规则 ID>')
  if (argv.length > 1) throw new Error(`多余参数：${argv.slice(1).join(' ')}`)
  return { target }
}

export function parseRulesArgs(argv: string[]): { phase?: string } {
  const phase = argv[0]
  if (phase && !['template', 'script', 'style', 'validate'].includes(phase)) {
    throw new Error(`未知阶段：${phase}（可用 template / script / style / validate）`)
  }
  if (argv.length > 1) throw new Error(`多余参数：${argv.slice(1).join(' ')}`)
  return { phase }
}

export interface RouterCheckArgs {
  /** 页面根目录（扫描 <route> 块；缺省当前目录） */
  pagesDir: string
}

export function parseRouterCheckArgs(argv: string[]): RouterCheckArgs {
  const dir = argv.find((a) => !a.startsWith('-')) ?? '.'
  if (argv.length > 1) throw new Error(`多余参数：${argv.slice(1).join(' ')}`)
  return { pagesDir: path.resolve(dir) }
}

export interface ModuleCheckArgs {
  /** 项目根目录（递归扫描 proteus-module.config.ts；缺省当前目录） */
  root: string
  /** --graph：追加 Mermaid 依赖图输出 */
  graph: boolean
}

export function parseModuleCheckArgs(argv: string[]): ModuleCheckArgs {
  const dir = argv.find((a) => !a.startsWith('-')) ?? '.'
  const graph = argv.includes('--graph')
  if (argv.filter((a) => !a.startsWith('-') && a !== dir).length) throw new Error('多余参数')
  return { root: path.resolve(dir), graph }
}

export interface ModuleDuplicatesArgs {
  /** 小程序产物目录（含 app.json；缺省 ./dist/mp-weixin） */
  distDir: string
}

export function parseModuleDuplicatesArgs(argv: string[]): ModuleDuplicatesArgs {
  const dir = argv.find((a) => !a.startsWith('-')) ?? './dist/mp-weixin'
  if (argv.length > 1) throw new Error('多余参数')
  return { distDir: path.resolve(dir) }
}

export interface ModuleAuditArgs {
  /** 项目根目录（扫描模块契约；缺省当前目录） */
  root: string
  /** --dist <dir>：产物目录（分包体积/重复检测；缺省不检查产物） */
  distDir?: string
  /** --graph-json <path>：落盘 module-graph.json（缺省 .proteus/module-graph.json，--no-graph-json 关闭） */
  graphJson: boolean
  graphJsonPath: string
}

export function parseModuleAuditArgs(argv: string[]): ModuleAuditArgs {
  const rootArg = argv.find((a) => !a.startsWith('-')) ?? '.'
  let distDir: string | undefined
  let graphJson = true
  let graphJsonPath = '.proteus/module-graph.json'
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (a === '--dist') {
      distDir = argv[++i]
      if (distDir == null) throw new Error('--dist 需要目录参数')
    } else if (a === '--graph-json') {
      graphJson = true
      const p = argv[i + 1]
      if (p && !p.startsWith('-')) {
        graphJsonPath = p
        i++
      }
    } else if (a === '--no-graph-json') {
      graphJson = false
    } else if (a.startsWith('-')) {
      throw new Error(`未知参数：${a}`)
    }
    i++
  }
  return { root: path.resolve(rootArg), distDir: distDir ? path.resolve(distDir) : undefined, graphJson, graphJsonPath }
}

export interface ModuleInitArgs {
  /** 项目根目录（生成 proteus-module.config.ts；缺省当前目录） */
  root: string
}

export function parseModuleInitArgs(argv: string[]): ModuleInitArgs {
  const dir = argv.find((a) => !a.startsWith('-')) ?? '.'
  if (argv.length > 1) throw new Error(`多余参数：${argv.slice(1).join(' ')}`)
  return { root: path.resolve(dir) }
}

export interface CapabilityManifestArgs {
  /** 项目根目录（扫描 capabilities/*.capability.ts；缺省当前目录） */
  root: string
  /** --platform <web|skyline|app>：能力缺失报告（B3 编译期分叉 §7） */
  platform?: 'web' | 'skyline' | 'app'
}

export function parseCapabilityManifestArgs(argv: string[]): CapabilityManifestArgs {
  const dir = argv.find((a) => !a.startsWith('-')) ?? '.'
  let platform: 'web' | 'skyline' | 'app' | undefined
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (a === '--platform') {
      const p = argv[++i]
      if (!['web', 'skyline', 'app'].includes(p ?? '')) throw new Error(`--platform 需要 web / skyline / app（收到 ${p ?? '空'}）`)
      platform = p as 'web' | 'skyline' | 'app'
    } else if (a.startsWith('-')) {
      throw new Error(`未知参数：${a}`)
    }
    i++
  }
  return { root: path.resolve(dir), platform }
}

export interface CapabilityCheckArgs {
  /** 项目根目录（平台原生模块规范静态检查；缺省当前目录） */
  root: string
}

export function parseCapabilityCheckArgs(argv: string[]): CapabilityCheckArgs {
  const dir = argv.find((a) => !a.startsWith('-')) ?? '.'
  if (argv.length > 1) throw new Error(`多余参数：${argv.slice(1).join(' ')}`)
  return { root: path.resolve(dir) }
}

export function parseComponentsAuditArgs(argv: string[]): { root: string } {
  const dir = argv.find((a) => !a.startsWith('-')) ?? '.'
  if (argv.length > 1) throw new Error(`多余参数：${argv.slice(1).join(' ')}`)
  return { root: path.resolve(dir) }
}

export function parseI18nCheckArgs(argv: string[]): { root: string; catalog?: string } {
  let catalog: string | undefined
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--catalog') {
      catalog = argv[i + 1]
      i++
    } else if (!a.startsWith('-')) {
      positional.push(a)
    } else {
      throw new Error(`未知参数：${a}`)
    }
  }
  if (positional.length > 1) throw new Error(`多余参数：${positional.slice(1).join(' ')}`)
  return { root: path.resolve(positional[0] ?? '.'), catalog: catalog ? path.resolve(catalog) : undefined }
}

export function parseConfigCheckArgs(argv: string[]): { file: string } {
  const file = argv.find((a) => !a.startsWith('-'))
  if (!file) throw new Error('缺少参数：proteus config:check <proteus.config.ts>')
  if (argv.length > 1) throw new Error(`多余参数：${argv.slice(1).join(' ')}`)
  return { file: path.resolve(file) }
}

export function parseCssCheckArgs(argv: string[]): { target: string; strict: boolean; fix: boolean; report?: string } {
  let strict = true
  let fix = false
  let report: string | undefined
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--strict') strict = true
    else if (a === '--no-strict') strict = false
    else if (a === '--fix') fix = true
    else if (a === '--report') {
      report = argv[i + 1]
      if (!report) throw new Error('--report 需要输出路径')
      i++
    } else if (!a.startsWith('-')) {
      positional.push(a)
    } else {
      throw new Error(`未知参数：${a}`)
    }
  }
  if (positional.length > 1) throw new Error(`多余参数：${positional.slice(1).join(' ')}`)
  return { target: path.resolve(positional[0] ?? '.'), strict, fix, report: report ? path.resolve(report) : undefined }
}

export function parseStyleCheckArgs(argv: string[]): { target: string; platform: string } {
  let platform = 'web'
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--platform') {
      platform = argv[i + 1] ?? ''
      i++
    } else if (!a.startsWith('-')) {
      positional.push(a)
    } else {
      throw new Error(`未知参数：${a}`)
    }
  }
  if (positional.length > 1) throw new Error(`多余参数：${positional.slice(1).join(' ')}`)
  return { target: path.resolve(positional[0] ?? '.'), platform }
}

export interface CheckArgs {
  root: string
  strictCss: boolean
  strictStyle: boolean
  strictRouter: boolean
  strictCli: boolean
}

/** proteus check [dir] [--no-strict-css|--no-strict-style|--no-strict-router|--no-strict-cli]（默认全开） */
export function parseCheckArgs(argv: string[]): CheckArgs {
  const args: CheckArgs = { root: '.', strictCss: true, strictStyle: true, strictRouter: true, strictCli: true }
  const positional: string[] = []
  for (const a of argv) {
    if (a === '--no-strict-css') args.strictCss = false
    else if (a === '--no-strict-style') args.strictStyle = false
    else if (a === '--no-strict-router') args.strictRouter = false
    else if (a === '--no-strict-cli') args.strictCli = false
    else if (!a.startsWith('-')) positional.push(a)
    else throw new Error(`未知参数：${a}`)
  }
  if (positional.length > 1) throw new Error(`多余参数：${positional.slice(1).join(' ')}`)
  args.root = path.resolve(positional[0] ?? '.')
  return args
}

export function parseGenerateTypesArgs(argv: string[]): { out?: string; check?: boolean } {
  let out: string | undefined
  let check = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') {
      out = argv[i + 1]
      i++
    } else if (a === '--check') {
      check = true
    } else {
      throw new Error(`未知参数：${a}`)
    }
  }
  return { out, check }
}

export function parseMigrateTypesArgs(argv: string[]): { file: string; dryRun: boolean } {
  const positional: string[] = []
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') dryRun = true
    else if (!a.startsWith('-')) positional.push(a)
    else throw new Error(`未知参数：${a}`)
  }
  if (positional.length !== 1) throw new Error('参数：proteus migrate types <proteus.config.ts> [--dry-run]')
  return { file: path.resolve(positional[0]), dryRun }
}

export interface HelpEntry {
  usage: string
  desc: string
}

export interface HelpGroup {
  title: string
  entries: HelpEntry[]
}

/** ★命令分组（proteus help 渲染源——分组让长命令表可扫） */
export const HELP_GROUPS: HelpGroup[] = [
  {
    title: '构建与开发',
    entries: [
      {
        usage: 'proteus build <dir> [--out <dir>] [--debug] [--no-px2rpx] [--rpx-ratio <n>] [--rules <json>] [--target <web|skyline|all>]',
        desc: '扫描 <dir> 下所有 .vue，编译为小程序四件套（.wxml / .js / .wxss）到 <out>\n      --debug    产物注入源码行号注释 + 决策 trace 落盘（.transform-debug/）\n      --rules    JSON 规则覆盖文件（disabled / mapping / customTags）\n      --target   工程构建（G-33 M2）：spawn 项目 build:web / build:mp 脚本（复用 Vite 管线）；缺省 = 独立编译',
      },
      {
        usage: 'proteus dev [--target <web|skyline>]',
        desc: '开发服务器（G-33 M1）：web → vite --mode web；skyline → dev-mp watch 构建（app 端待 M3 原生同步）',
      },
    ],
  },
  {
    title: '检查与门禁',
    entries: [
      {
        usage: 'proteus check [dir] [--no-strict-css|--no-strict-style|--no-strict-router|--no-strict-cli]',
        desc: '★一键全量门禁（G-33 M1）：css:check + style:check + router:check + config:check 四域聚合\n      任一域失败 → exit 1（默认全开，--no-* 关闭对应域）',
      },
      {
        usage: 'proteus health [dir]',
        desc: '★工程/环境健康检查（与 check 领域门禁正交）：Node 版本 / 工程结构 / 依赖 / 产物 / appid / pagesDir / workspace 链接 / IDE\n      一次性诊断（✅/⚠/✗）；error 级 → exit 1（warn 不阻断）',
      },
      {
        usage: 'proteus css:check [dir|file] [--no-strict] [--fix] [--report <path>]',
        desc: '★CSS 跨端兼容校验（G-21）：CSS001-012 + 预算门禁（字节/选择器/语义占比/禁止项）\n      --no-strict  违规降级 warn；--report 落盘 css-compat-report.json（check-css-report.mjs 消费）',
      },
      {
        usage: 'proteus style:check [dir|file] [--platform <web|skyline|ios|android|harmony>]',
        desc: '★样式运行时安全（G-31）：模板 :style 白名单 STS001-006 + 静态推导覆盖率（常量折叠）',
      },
      {
        usage: 'proteus config:check <proteus.config.ts>',
        desc: '★配置校验（types-plus B2/B5）：必填字段 + 跨层依赖（CONFIG_LAYER_VIOLATION）+ 版本迁移提示',
      },
      {
        usage: 'proteus i18n:check [root] [--catalog <path>]',
        desc: '★i18n 用法检查（i18n-plan B1）：硬编码文案检测 + catalog 键对照',
      },
      {
        usage: 'proteus router:check [dir]',
        desc: '校验 <route> 块与集中式 meta（来源登记 + 父路由推导依据）',
      },
      {
        usage: 'proteus module:check [dir] [--graph]',
        desc: '校验 proteus-module.config.ts 模块契约（缺失字段/环/重名/版本冲突）\n      --graph  追加 Mermaid 依赖图',
      },
      {
        usage: 'proteus module:duplicates [distDir]',
        desc: '分包间共享依赖去重检测（读 dist/mp-weixin/app.json 的 subPackages，hash 相同文件 ≥2 分包 → 报告）',
      },
      {
        usage: 'proteus audit module [root] [--dist <dir>] [--graph-json <path> | --no-graph-json]',
        desc: '★综合审计门禁（M8.6，全部硬卡）：契约校验 + 图谱（环/重名/版本冲突）+ 可选产物（--dist：分包体积/重复）\n      --dist         产物目录（分包体积阈值 + 去重检测）\n      --graph-json   落盘 module-graph.json（缺省 .proteus/module-graph.json）',
      },
      {
        usage: 'proteus audit all [root]',
        desc: '★全量审计门禁（test-framework B6 + M10）：route / module / config / i18n / capabilities / components / devtools-budget 七域聚合\n      + CI 耗时预算（<12s，超预算阻断）；缺配置文件域跳过（独立编译模式）',
      },
      {
        usage: 'proteus audit devtools-budget',
        desc: '★DevTools 性能预算烟测（M10/M7.4）：bus.emit / 火焰图 5000 span / 万级 timeline ingest 耗时\n      plan 预算 0.1/100/200ms → CI 10 倍余量上界，超限阻断（抓病态回归）',
      },
      {
        usage: 'proteus audit coverage',
        desc: '★完整语义覆盖审计（G-32 B1 / G-32.1 门禁）：小程序能力 100% 覆盖 + 闭环一致性（catalog ↔ enum ↔ tag ↔ render-map 四向不漂移）+ 128 清单自检',
      },
      {
        usage: 'proteus capabilities:manifest [dir] [--platform <web|skyline|app>]',
        desc: '★扫描 capabilities/*.capability.ts → capability-manifest.json（B1 能力清单审计）\n      --platform   能力缺失报告（B3 编译期分叉：该平台无 adapter 的能力 + 业务引用警告）',
      },
      {
        usage: 'proteus capabilities:check [dir]',
        desc: '★平台原生模块规范静态检查（B5 §6 禁止清单：业务目录禁 wx.*/window.*，平台文件防 API 泄漏）',
      },
      {
        usage: 'proteus components:audit [dir]',
        desc: '★组件审计：p-* 组件注册表 vs 实际使用（未登记/未使用/标签漂移）',
      },
      {
        usage: 'proteus fluid:check [dir|file]',
        desc: '★柔性布局严格规则（G-22）：FLD001 禁手写 @media / FLD002 禁硬编码断点 / FLD003 p-fluid 须 min·max / FLD004 p-grid 须 min-col-width / FLD006 禁 Dimensions.get\n      （FLD005 固定死尺寸启发式噪音大，MVP 未启用）',
      },
    ],
  },
  {
    title: '测试',
    entries: [
      {
        usage: 'proteus test [unit|e2e:web|e2e:mp] [--ide <cli 路径>] [--port <n>] [--debugger <模块>]',
        desc: '★测试入口（test-framework）：unit → L1-L3 + 编译快照；e2e:web → Playwright（先 build --target web）\n      e2e:mp → automator（B5）：IDE 路径可配置（PROTEUS_IDE_CLI 环境变量 / --ide 参数 / 平台默认探测）\n      + 自动启动微信开发者工具（auto --auto-port）→ 端口就绪 → 跑 e2e-mp-smoke（缺 IDE 报错含指引）\n      + --debugger <模块>：注入 MpDebuggerLike 适配模块（console/network/clearCache/refresh——wechatide 工具能力，见 docs 13 §6.5）',
      },
    ],
  },
  {
    title: '生成与迁移',
    entries: [
      {
        usage: 'proteus init module [dir]',
        desc: '★生成 proteus-module.config.ts 骨架（module-plan B9：新工程零门槛接入模块化）',
      },
      {
        usage: 'proteus generate types [--out <path>] [--check]',
        desc: '★生成全局类型产物（types-plan B3）：JSON Schema + 全局 d.ts（--check 校验漂移）',
      },
      {
        usage: 'proteus migrate types <file>',
        desc: '★迁移助手：旧类型写法 → 新收口类型（types-plan 10 类型收口）',
      },
      {
        usage: 'proteus gen config [file]',
        desc: '★生成 app.config.ts 骨架（G-35 M5）：defineAppConfig 类型安全形态；缺省 app.config.ts',
      },
      {
        usage: 'proteus ci:init [--platform <github|gitlab|circleci>] [--targets <a,b>] [dir]',
        desc: '★CI/CD 模板生成（G-33 M4）：.github/workflows/proteus.yml 等（proteus check 门禁 → 逐端构建 → 产物归档）\n      默认 platform=github targets=web,skyline；写入当前目录（或 <dir>）',
      },
    ],
  },
  {
    title: '诊断与工具',
    entries: [
      {
        usage: 'proteus explain <vue 文件 | 规则 ID>',
        desc: 'vue 文件 → 决策 trace（该文件实际触发的全部转换规则）\n      规则 ID  → 该规则的 AI 说明书（what/why/when/example/verify/source）',
      },
      {
        usage: 'proteus rules [template | script | style | validate]',
        desc: '列出全部编译规则（AI 说明书目录）',
      },
      {
        usage: 'proteus version',
        desc: '版本号',
      },
      {
        usage: 'proteus help',
        desc: '本帮助',
      },
    ],
  },
]

const ANSI_CYAN = '\u001b[36m'
const ANSI_BOLD = '\u001b[1m'
const ANSI_YELLOW = '\u001b[33m'
const ANSI_DIM = '\u001b[2m'
const ANSI_RESET = '\u001b[0m'
const LINE = '─'
const SEP_WIDTH = 46

/** ★usage 参数语义着色：<必选> 黄、[可选] 灰（先 < 后 [] 避免嵌套冲突；命令名 cyan 由外层处理） */
function styleUsageParams(usage: string, color: boolean): string {
  if (!color) return usage
  return usage
    .replace(/(<[^>]+>)/g, `${ANSI_YELLOW}$1${ANSI_RESET}`)
    .replace(/(\[[^\]]+\])/g, `${ANSI_DIM}$1${ANSI_RESET}`)
}

/**
 * ★帮助文本渲染（分组 + ANSI 色彩 + 装饰线；useColor=false 纯文本——非 TTY/CI 安全）
 * 命令名 cyan、分组标题 bold + 分隔线、<必选> 黄、[可选] 灰、头部/尾部装饰
 */
export function formatHelpText(useColor = typeof process !== 'undefined' && process.stdout?.isTTY === true): string {
  const lines: string[] = []
  lines.push(useColor ? `${ANSI_BOLD}Proteus CLI${ANSI_RESET} —— AI-native 透明跨端编译框架` : 'Proteus CLI —— AI-native 透明跨端编译框架')
  lines.push(LINE.repeat(SEP_WIDTH))
  lines.push('')
  lines.push(useColor ? `${ANSI_BOLD}用法${ANSI_RESET}` : '用法')
  lines.push(`  proteus ${styleUsageParams('<command> [args...]', useColor)}`)
  lines.push('')
  for (const group of HELP_GROUPS) {
    const title = useColor ? `${ANSI_BOLD}${group.title}${ANSI_RESET}` : group.title
    lines.push(`${title} ${LINE.repeat(Math.max(2, SEP_WIDTH - title.length - 1))}`)
    lines.push('')
    for (const entry of group.entries) {
      // 命令名 = usage 前两个 token（proteus <子命令>，如 'proteus check'/'proteus test'）→ cyan；其余参数语义着色
      const tokens = entry.usage.split(' ')
      const cmdLen = tokens[0] === 'proteus' && tokens[1] ? 2 : 1
      const cmd = tokens.slice(0, cmdLen).join(' ')
      const rest = styleUsageParams(tokens.slice(cmdLen).join(' '), useColor)
      lines.push(useColor ? `  ${ANSI_CYAN}${cmd}${ANSI_RESET} ${rest}`.trimEnd() : `  ${entry.usage}`)
      // desc：首行统一 6 空格前缀；后续行保留 desc 内自带缩进（避免叠加变深）
      const descLines = entry.desc.split('\n')
      lines.push(`      ${descLines[0]}`)
      for (const l of descLines.slice(1)) lines.push(l)
      lines.push('')
    }
  }
  lines.push(LINE.repeat(SEP_WIDTH))
  const hint = '提示：proteus <command> --help（单命令参数）· 文档 docs/ · GitHub github.com/proteus-vue/proteus'
  lines.push(useColor ? `${ANSI_DIM}${hint}${ANSI_RESET}` : hint)
  lines.push(`版本 ${useColor ? `${ANSI_BOLD}0.1.0${ANSI_RESET}` : '0.1.0'}`)
  return lines.join('\n').replace(/\n\n\n/g, '\n\n').trimEnd() + '\n'
}

/** ★纯文本帮助（向后兼容；CLI 输出用 formatHelpText() 自动 TTY 检测） */
export const HELP_TEXT = formatHelpText(false)

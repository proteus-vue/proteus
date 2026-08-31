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

export const HELP_TEXT = `Proteus CLI —— AI-native 透明跨端编译框架

用法：
  proteus build <dir> [--out <dir>] [--debug] [--no-px2rpx] [--rpx-ratio <n>] [--rules <json>] [--target <web|skyline|all>]
      扫描 <dir> 下所有 .vue，编译为小程序四件套（.wxml / .js / .wxss）到 <out>
      --debug    产物注入源码行号注释 + 决策 trace 落盘（.transform-debug/）
      --rules    JSON 规则覆盖文件（disabled / mapping / customTags）
      --target   工程构建（G-33 M2）：spawn 项目 build:web / build:mp 脚本（复用 Vite 管线）；缺省 = 独立编译

  proteus dev [--target <web|skyline>]
      开发服务器（G-33 M1）：web → vite --mode web；skyline → dev-mp watch 构建（app 端待 M3 原生同步）

  proteus check [dir] [--no-strict-css|--no-strict-style|--no-strict-router|--no-strict-cli]
      ★一键全量门禁（G-33 M1）：css:check + style:check + router:check + config:check 四域聚合
      任一域失败 → exit 1（默认全开，--no-* 关闭对应域）

  proteus css:check [dir|file] [--no-strict] [--fix] [--report <path>]
      ★CSS 跨端兼容校验（G-21）：CSS001-012 + 预算门禁（字节/选择器/语义占比/禁止项）
      --no-strict  违规降级 warn；--report 落盘 css-compat-report.json（check-css-report.mjs 消费）

  proteus style:check [dir|file] [--platform <web|skyline|ios|android|harmony>]
      ★样式运行时安全（G-31）：模板 :style 白名单 STS001-006 + 静态推导覆盖率（常量折叠）

  proteus explain <vue 文件 | 规则 ID>
      vue 文件 → 决策 trace（该文件实际触发的全部转换规则）
      规则 ID  → 该规则的 AI 说明书（what/why/when/example/verify/source）

  proteus rules [template | script | style | validate]
      列出全部编译规则（AI 说明书目录）

  proteus config:check <proteus.config.ts>
      ★配置校验（types-plus B2/B5）：必填字段 + 跨层依赖（CONFIG_LAYER_VIOLATION）+ 版本迁移提示

  proteus i18n:check [root] [--catalog <path>]
      ★i18n 用法检查（i18n-plan B1）：硬编码文案检测 + catalog 键对照

  proteus router:check [dir]
      校验 <route> 块与集中式 meta（来源登记 + 父路由推导依据）

  proteus module:check [dir] [--graph]
      校验 proteus-module.config.ts 模块契约（缺失字段/环/重名/版本冲突）
      --graph  追加 Mermaid 依赖图

  proteus module:duplicates [distDir]
      分包间共享依赖去重检测（读 dist/mp-weixin/app.json 的 subPackages，hash 相同文件 ≥2 分包 → 报告）

  proteus audit module [root] [--dist <dir>] [--graph-json <path> | --no-graph-json]
      ★综合审计门禁（M8.6，全部硬卡）：契约校验 + 图谱（环/重名/版本冲突）+ 可选产物（--dist：分包体积/重复）
      --dist         产物目录（分包体积阈值 + 去重检测）
      --graph-json   落盘 module-graph.json（缺省 .proteus/module-graph.json）

  proteus audit all [root]
      ★全量审计门禁（test-framework B6）：route / module / config / i18n / capabilities / components 六域聚合
      + CI 耗时预算（<12s，超预算阻断）；缺配置文件域跳过（独立编译模式）

  proteus init module [dir]
      ★生成 proteus-module.config.ts 骨架（module-plan B9：新工程零门槛接入模块化）

  proteus capabilities:manifest [dir] [--platform <web|skyline|app>]
      ★扫描 capabilities/*.capability.ts → capability-manifest.json（B1 能力清单审计）
      --platform   能力缺失报告（B3 编译期分叉：该平台无 adapter 的能力 + 业务引用警告）

  proteus capabilities:check [dir]
      ★平台原生模块规范静态检查（B5 §6 禁止清单：业务目录禁 wx.*/window.*，平台文件防 API 泄漏）

  proteus components:audit [dir]
      ★组件审计：p-* 组件注册表 vs 实际使用（未登记/未使用/标签漂移）

  proteus generate types [--out <path>] [--check]
      ★生成全局类型产物（types-plan B3）：JSON Schema + 全局 d.ts（--check 校验漂移）

  proteus migrate types <file>
      ★迁移助手：旧类型写法 → 新收口类型（types-plan 10 类型收口）

  proteus ci:init [--platform <github|gitlab|circleci>] [--targets <a,b>] [dir]
      ★CI/CD 模板生成（G-33 M4）：.github/workflows/proteus.yml 等（proteus check 门禁 → 逐端构建 → 产物归档）
      默认 platform=github targets=web,skyline；写入当前目录（或 <dir>）

  proteus gen config [file]
      ★生成 app.config.ts 骨架（G-35 M5）：defineAppConfig 类型安全形态；缺省 app.config.ts

  proteus test [unit|e2e:web|e2e:mp] [--ide <cli 路径>] [--port <n>]
      ★测试入口（test-framework）：unit → L1-L3 + 编译快照；e2e:web → Playwright（先 build --target web）
      e2e:mp → automator（B5）：IDE 路径可配置（PROTEUS_IDE_CLI 环境变量 / --ide 参数 / 平台默认探测）
      + 自动启动微信开发者工具（auto --auto-port）→ 端口就绪 → 跑 e2e-mp-smoke（缺 IDE 报错含指引）

  proteus version / help
`

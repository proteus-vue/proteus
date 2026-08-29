// packages/cli/src/args.ts
// CLI 参数解析（纯函数，可单测）——零依赖，手写解析
import fs from 'node:fs'
import path from 'node:path'
import type { TransformRuleOverrides } from '@proteus/compiler'
import type { ProteusConfig } from '@proteus/plugin-vite'

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

export const HELP_TEXT = `Proteus CLI —— AI-native 透明跨端编译框架

用法：
  proteus build <dir> [--out <dir>] [--debug] [--no-px2rpx] [--rpx-ratio <n>] [--rules <json>]
      扫描 <dir> 下所有 .vue，编译为小程序四件套（.wxml / .js / .wxss）到 <out>
      --debug    产物注入源码行号注释 + 决策 trace 落盘（.transform-debug/）
      --rules    JSON 规则覆盖文件（disabled / mapping / customTags）

  proteus explain <vue 文件 | 规则 ID>
      vue 文件 → 决策 trace（该文件实际触发的全部转换规则）
      规则 ID  → 该规则的 AI 说明书（what/why/when/example/verify/source）

  proteus rules [template | script | style | validate]
      列出全部编译规则（AI 说明书目录）

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

  proteus init module [dir]
      ★生成 proteus-module.config.ts 骨架（module-plan B9：新工程零门槛接入模块化）

  proteus capabilities:manifest [dir] [--platform <web|skyline|app>]
      ★扫描 capabilities/*.capability.ts → capability-manifest.json（B1 能力清单审计）
      --platform   能力缺失报告（B3 编译期分叉：该平台无 adapter 的能力 + 业务引用警告）

  proteus capabilities:check [dir]
      ★平台原生模块规范静态检查（B5 §6 禁止清单：业务目录禁 wx.*/window.*，平台文件防 API 泄漏）

  proteus version / help
`

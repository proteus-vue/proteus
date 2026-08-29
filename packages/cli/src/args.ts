// packages/cli/src/args.ts
// CLI 参数解析（纯函数，可单测）——零依赖，手写解析
import fs from 'node:fs'
import type { TransformRuleOverrides } from '@proteus/compiler'

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

  proteus version / help
`

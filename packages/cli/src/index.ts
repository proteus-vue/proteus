// packages/cli/src/index.ts
// Proteus CLI 入口：proteus build / explain / rules / version / help
// 核心逻辑（parseArgs / explainTarget / buildDir / listRules）均为纯函数，可单测
// （shebang 由 esbuild --banner 在构建时注入，源码不写）
import { parseBuildArgs, parseExplainArgs, parseRulesArgs, HELP_TEXT } from './args'
import { buildDir } from './build'
import { explainTarget } from './explain'
import { listRules } from './rules'

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)

  switch (cmd) {
    case 'build': {
      const args = parseBuildArgs(rest)
      const result = buildDir(args.inputDir, {
        outDir: args.outDir,
        px2rpx: args.px2rpx,
        rpxRatio: args.rpxRatio,
        debug: args.debug,
        rules: args.rules,
      })
      console.log(`[proteus] build：${result.files.length} 个页面 → ${args.outDir}`)
      if (args.debug) console.log(`[proteus] 决策 trace 已落盘：${result.traceFiles.length} 个（.transform-debug/）`)
      if (result.warnings) console.warn(`[proteus] ⚠ ${result.warnings} 条编译警告（详见各文件，--debug 可看决策链）`)
      break
    }
    case 'explain': {
      const { target } = parseExplainArgs(rest)
      console.log(explainTarget(target))
      break
    }
    case 'rules': {
      const { phase } = parseRulesArgs(rest)
      console.log(listRules(phase))
      break
    }
    case 'version':
      console.log('0.1.0')
      break
    case 'help':
    default:
      console.log(HELP_TEXT)
      break
  }
}

main().catch((err: Error) => {
  console.error(`[proteus] ${err.message}`)
  process.exitCode = 1
})

// packages/cli/src/index.ts
// Proteus CLI 入口：proteus build / explain / rules / router:check / version / help
// 核心逻辑（parseArgs / explainTarget / buildDir / listRules / checkRoutes）均为纯函数，可单测
// （shebang 由 esbuild --banner 在构建时注入，源码不写）
import { parseBuildArgs, parseExplainArgs, parseRulesArgs, parseRouterCheckArgs, parseModuleCheckArgs, parseModuleDuplicatesArgs, parseModuleAuditArgs, parseModuleInitArgs, parseCapabilityManifestArgs, parseCapabilityCheckArgs, parseComponentsAuditArgs, parseI18nCheckArgs, parseConfigCheckArgs, parseCssCheckArgs, parseGenerateTypesArgs, parseMigrateTypesArgs, HELP_TEXT } from './args'
import { buildDir } from './build'
import { explainTarget } from './explain'
import { listRules } from './rules'
import { checkRoutes, formatRouterCheck } from './router-check'
import { checkModuleConfigs } from './module-check'
import { readSubPackageRoots, scanDuplicateModules, formatDuplicateReport } from './module-duplicates'
import { runAuditModule } from './module-audit'
import { writeModuleConfigSkeleton } from './module-init'
import { runCapabilityScan, runCapabilityCheck } from './capability-manifest'
import { auditComponents, formatComponentAudit } from './component-audit'
import { checkI18nUsage, formatI18nCheck } from './i18n-check'
import { checkConfigFile } from './config-check'
import { runCssCheck, formatCssCheck } from './css-check'
import { generateTypes, formatGenerateTypes } from './generate-types'
import { migrateTypesFile, formatMigrateTypes } from './migrate-types'

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
    case 'router:check': {
      const { pagesDir } = parseRouterCheckArgs(rest)
      console.log(formatRouterCheck(checkRoutes(pagesDir)))
      break
    }
    case 'module:check': {
      const { root, graph } = parseModuleCheckArgs(rest)
      const { text, result, cycles, conflicts } = await checkModuleConfigs(root, graph)
      console.log(text)
      if (!result.modules.every((m) => m.ok) || result.duplicateNames.length || cycles.length || conflicts.length) process.exitCode = 1
      break
    }
    case 'module:duplicates': {
      const { distDir } = parseModuleDuplicatesArgs(rest)
      const roots = readSubPackageRoots(distDir)
      if (!roots.length) {
        console.log('[proteus-module] 未找到分包（dist/mp-weixin/app.json 无 subPackages）——无需去重检测')
        break
      }
      const duplicates = scanDuplicateModules(distDir, roots)
      console.log(formatDuplicateReport(duplicates))
      if (duplicates.length) process.exitCode = 1
      break
    }
    case 'init': {
      if (rest[0] !== 'module') throw new Error('proteus init 目前仅支持 module（proteus init module [dir]）')
      const { root } = parseModuleInitArgs(rest.slice(1))
      const out = writeModuleConfigSkeleton(root)
      console.log(`[proteus] 已生成模块契约骨架：${out}`)
      console.log('下一步：proteus module:check 校验 → proteus audit module 审计（详见 docs/proteus-module-plan/10-migration.md）')
      break
    }
      case 'audit': {
      // proteus audit module（M8.6 CI 门禁）；其余 audit 子命令后续
      if (rest[0] !== 'module') throw new Error('proteus audit 目前仅支持 module（proteus audit module [root] [--dist]）')
      const { root, distDir, graphJson, graphJsonPath } = parseModuleAuditArgs(rest.slice(1))
      const { text, audit } = await runAuditModule({ root, distDir, graphJson, graphJsonPath })
      console.log(text)
      if (!audit.ok) process.exitCode = 1
      break
    }
    case 'capabilities:manifest': {
      const { root, platform } = parseCapabilityManifestArgs(rest)
      const { text } = await runCapabilityScan(root, undefined, platform)
      console.log(text)
      break
    }
    case 'capabilities:check': {
      const { root } = parseCapabilityCheckArgs(rest)
      const { text, violations } = runCapabilityCheck(root)
      console.log(text)
      if (violations.length) process.exitCode = 1
      break
    }
    case 'components:audit': {
      const { root } = parseComponentsAuditArgs(rest)
      const result = auditComponents(root)
      console.log(formatComponentAudit(result))
      if (!result.ok) process.exitCode = 1
      break
    }
    case 'config:check': {
      const { file } = parseConfigCheckArgs(rest)
      try {
        const { result, text } = await checkConfigFile(file)
        console.log(text)
        if (!result.ok) process.exitCode = 1
      } catch (e) {
        console.error(`[proteus-config] ${(e as Error).message}`)
        process.exitCode = 1
      }
      break
    }
    case 'i18n:check': {
      const { root, catalog } = parseI18nCheckArgs(rest)
      try {
        const result = checkI18nUsage(root, catalog)
        console.log(formatI18nCheck(result))
        if (!result.ok) process.exitCode = 1
      } catch (e) {
        console.error(`[proteus-i18n] ${(e as Error).message}`)
        process.exitCode = 1
      }
      break
    }
    case 'css:check': {
      const { target, strict, fix, report } = parseCssCheckArgs(rest)
      try {
        const result = runCssCheck(target, { strict, fix })
        console.log(formatCssCheck(result))
        if (report) {
          const fs = await import('node:fs')
          fs.writeFileSync(report, JSON.stringify({ files: result.files, total: result.total }, null, 2))
          console.log(`[proteus-css] 报告已落盘：${report}`)
        }
        if (!result.ok) process.exitCode = 1
      } catch (e) {
        console.error(`[proteus-css] ${(e as Error).message}`)
        process.exitCode = 1
      }
      break
    }
    case 'generate': {
      if (rest[0] !== 'types') throw new Error('proteus generate 目前仅支持 types（proteus generate types [--out <path>] [--check]）')
      const { out, check } = parseGenerateTypesArgs(rest.slice(1))
      const result = generateTypes({ out, check })
      console.log(formatGenerateTypes(result))
      if (!result.ok) process.exitCode = 1
      break
    }
    case 'migrate': {
      if (rest[0] !== 'types') throw new Error('proteus migrate 目前仅支持 types（proteus migrate types <proteus.config.ts> [--dry-run]）')
      const { file, dryRun } = parseMigrateTypesArgs(rest.slice(1))
      try {
        const { changed } = migrateTypesFile(file, dryRun)
        console.log(formatMigrateTypes(file, changed, dryRun))
      } catch (e) {
        console.error(`[proteus-types] ${(e as Error).message}`)
        process.exitCode = 1
      }
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

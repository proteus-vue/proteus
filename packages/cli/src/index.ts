// packages/cli/src/index.ts
// Proteus CLI 入口：proteus build / explain / rules / router:check / version / help
// 核心逻辑（parseArgs / explainTarget / buildDir / listRules / checkRoutes）均为纯函数，可单测
// （shebang 由 esbuild --banner 在构建时注入，源码不写）
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
// ★B5：automator 兼容补丁脚本（src 与 dist 同指向仓库根 scripts/）
const AUTOMATOR_PATCH_SCRIPT = fileURLToPath(new URL('../../../scripts/patch-automator.mjs', import.meta.url))
import { parseBuildArgs, parseExplainArgs, parseRulesArgs, parseRouterCheckArgs, parseModuleCheckArgs, parseModuleDuplicatesArgs, parseModuleAuditArgs, parseModuleInitArgs, parseCapabilityManifestArgs, parseCapabilityCheckArgs, parseComponentsAuditArgs, parseI18nCheckArgs, parseConfigCheckArgs, parseCssCheckArgs, parseStyleCheckArgs, parseCheckArgs, parseGenerateTypesArgs, parseMigrateTypesArgs, HELP_TEXT } from './args'
import { buildDir, planTargetedBuild } from './build'
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
import { runStyleCheck, formatStyleCheck } from './style-check'
import { runCheck, formatCheck } from './check'
import { parseDevArgs, runDev } from './dev'
import { parseTestArgs, runTest } from './test'
import { checkAppConfigFile, formatAppConfigCheck, appConfigCheckSummary } from './app-config-check'
import { generateTypes, formatGenerateTypes } from './generate-types'
import { migrateTypesFile, formatMigrateTypes } from './migrate-types'
import { parseCiArgs, planCiInit } from './ci'
import { generateAppConfigSkeleton } from './app-config-gen'
import { runAuditAll, formatAuditAll } from './audit-all'
import { planMpE2E, diagnoseMpE2EEnv, formatMpE2EDiagnosis, prepareMpE2EProject } from './mp-e2e'

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)

  switch (cmd) {
    case 'build': {
      const args = parseBuildArgs(rest)
      // ★cli-plus M2：--target web|skyline|all → 工程构建（复用项目 Vite 管线）；缺省 = 独立编译
      if (args.target) {
        try {
          const plans = planTargetedBuild(process.cwd(), args.target)
          const { spawnSync } = await import('node:child_process')
          for (const plan of plans) {
            console.log(`[proteus] build --target：${plan.script}（${plan.command} ${plan.args.join(' ')}）`)
            const r = spawnSync(plan.command, plan.args, { stdio: 'inherit', shell: process.platform === 'win32' })
            if (r.status !== 0) {
              console.error(`[proteus] build 失败（${plan.script} exit ${r.status}）`)
              process.exitCode = r.status ?? 1
              break
            }
          }
        } catch (e) {
          console.error(`[proteus-build] ${(e as Error).message}`)
          process.exitCode = 1
        }
        break
      }
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
      // proteus audit module（M8.6 CI 门禁）；★B6：audit all 全量门禁（test-framework B6）
      if (rest[0] === 'all') {
        const root = rest.find((a) => a !== 'all' && !a.startsWith('-')) ?? '.'
        try {
          const result = await runAuditAll(path.resolve(root))
          console.log(formatAuditAll(result))
          if (!result.ok) process.exitCode = 1
        } catch (e) {
          console.error(`[proteus-audit] ${(e as Error).message}`)
          process.exitCode = 1
        }
        break
      }
      if (rest[0] !== 'module') throw new Error('proteus audit 支持 module / all（proteus audit module [root] [--dist] | audit all [root]）')
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
    case 'app-config:check': {
      const file = rest.find((a) => !a.startsWith('-')) ?? 'app.config.ts'
      try {
        const result = await checkAppConfigFile(path.resolve(file))
        console.log(formatAppConfigCheck(result))
        if (!result.ok) process.exitCode = 1
      } catch (e) {
        console.error(`[proteus-app-config] ${(e as Error).message}`)
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
          fs.writeFileSync(report, JSON.stringify({ files: result.files, total: result.total, global: result.global, budgetChecks: result.budgetChecks }, null, 2))
          console.log(`[proteus-css] 报告已落盘：${report}`)
        }
        if (!result.ok) process.exitCode = 1
      } catch (e) {
        console.error(`[proteus-css] ${(e as Error).message}`)
        process.exitCode = 1
      }
      break
    }
    case 'style:check': {
      const { target, platform } = parseStyleCheckArgs(rest)
      const platforms: Array<'web' | 'skyline' | 'ios' | 'android' | 'harmony'> = ['web', 'skyline', 'ios', 'android', 'harmony']
      try {
        const result = runStyleCheck(target, { platform: (platforms as string[]).includes(platform) ? (platform as 'web') : 'web' })
        console.log(formatStyleCheck(result))
        if (!result.ok) process.exitCode = 1
      } catch (e) {
        console.error(`[proteus-style] ${(e as Error).message}`)
        process.exitCode = 1
      }
      break
    }
    case 'check': {
      const { root, strictCss, strictStyle, strictRouter, strictCli } = parseCheckArgs(rest)
      try {
        const summary = await runCheck(root, { strictCss, strictStyle, strictRouter, strictCli })
        console.log(formatCheck(summary))
        if (!summary.ok) process.exitCode = 1
      } catch (e) {
        console.error(`[proteus-check] ${(e as Error).message}`)
        process.exitCode = 1
      }
      break
    }
    case 'dev': {
      const { target } = parseDevArgs(rest)
      try {
        const plan = runDev({ target })
        console.log(`[proteus] dev --target ${target}：${plan.command} ${plan.args.join(' ')}`)
        const { spawn } = await import('node:child_process')
        const child = spawn(plan.command, plan.args, { stdio: 'inherit', shell: process.platform === 'win32' })
        child.on('error', (e) => {
          console.error(`[proteus] dev 启动失败：${e.message}`)
          process.exitCode = 1
        })
        // 保持进程存活（dev server 长驻）
        process.on('SIGINT', () => child.kill('SIGINT'))
        process.on('SIGTERM', () => child.kill('SIGTERM'))
      } catch (e) {
        console.error(`[proteus-dev] ${(e as Error).message}`)
        process.exitCode = 1
      }
      break
    }
    case 'test': {
      const { scope, root, ide, port } = parseTestArgs(rest)
      if (scope === 'e2e:mp') {
        // ★test-framework B5：环境体检 → 产物副本 → automator launch（内部 spawn IDE + trust + 轮询）
        try {
          const projectRoot = root ?? '.'
          // ① 环境体检（★实测坑内化：占位 appid / 端口残留 / 产物缺失 一次性报告）
          //   ★异步端口探测（net 无同步 API；busy-wait 不可靠——事件回调可能晚于循环退出）
          const portBusy = await probePort(port ?? 9420)
          const diagnosis = diagnoseMpE2EEnv({ root: projectRoot, port, ideCli: ide ?? undefined, isPortBusy: () => portBusy })
          console.log(formatMpE2EDiagnosis(diagnosis))
          if (!diagnosis.ok) {
            process.exitCode = 1
            break
          }
          // ★复用已运行 IDE：端口被占（自动化服务已在监听）→ connect 模式（不重复 launch，避免 Port in use）
          const reuseIde = portBusy
          const plan = planMpE2E({ root: projectRoot, port, ideCli: ide ?? undefined })
          // ② 产物独立副本（避开 IDE 路径缓存 + 不污染 dist）
          const prepared = prepareMpE2EProject(projectRoot)
          if (!prepared) {
            console.error('[proteus-test] 产物缺失：请先 npm run build:mp（产出 dist/mp-weixin）')
            process.exitCode = 1
            break
          }
          for (const s of plan.steps) console.log(s)
          console.log(`[proteus-test] 使用独立副本：${prepared.projectDir}（每次重建，避 IDE 路径缓存）`)
          // ③ automator 官方 launch 处理 IDE 启动（auto --trust-project）+ 端口轮询 + checkVersion；
          //    此处仅装配环境变量后跑 spec（trustProject 解决新项目信任弹窗阻塞 automator 服务）
          const { spawnSync } = await import('node:child_process')
          // ★B5 兼容补丁：automator 0.12.1 与新版 IDE（Tool.getInfo 缺 SDKVersion）——幂等，先打再跑
          const patch = spawnSync(process.execPath, [AUTOMATOR_PATCH_SCRIPT], { stdio: 'inherit' })
          if (patch.status !== 0) {
            console.error('[proteus-test] automator 兼容补丁失败（scripts/patch-automator.mjs），中止')
            process.exitCode = 1
            break
          }
          const r = spawnSync(
            'npx',
            ['vitest', 'run', 'tests/e2e-mp-smoke.test.ts'],
            {
              stdio: 'inherit',
              shell: process.platform === 'win32',
              env: {
                ...process.env,
                PROTEUS_MP_E2E: '1',
                PROTEUS_MP_E2E_CONNECT: reuseIde ? '1' : '0',
                PROTEUS_AUTOMATOR_PORT: String(plan.port),
                PROTEUS_IDE_CLI: plan.ideCli,
                PROTEUS_MINI_PROGRAM_PATH: prepared.projectDir,
              },
            },
          )
          if (r.status !== 0) process.exitCode = r.status ?? 1
          console.log('[proteus-test] e2e:mp 完成——微信开发者工具仍在运行，可手动关闭')
        } catch (e) {
          console.error(`[proteus-test] ${(e as Error).message}`)
          process.exitCode = 1
        }
        break
      }
      const plan = runTest({ scope })
      if (plan.note) console.log(`[proteus-test] ${plan.note}`)
      if (!plan.command) break // 理论不可达（e2e:mp 已分支）
      try {
        const { spawnSync } = await import('node:child_process')
        const r = spawnSync(plan.command, plan.args, { stdio: 'inherit', shell: process.platform === 'win32' })
        if (r.status !== 0) process.exitCode = r.status ?? 1
      } catch (e) {
        console.error(`[proteus-test] ${(e as Error).message}`)
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
    case 'ci:init': {
      // ★cli-plus M4：CI/CD 模板生成（02-build-pipeline.md §3）
      const { options, dir } = parseCiArgs(rest)
      try {
        const { file } = planCiInit(dir, options)
        console.log(`[proteus-ci] 已生成 ${file}（platform=${options.platform} targets=${options.targets.join(',')}）`)
        console.log('流水线：proteus check（四域门禁）→ 逐端构建 → 产物归档；推送到 Git 远程后即触发')
      } catch (e) {
        console.error(`[proteus-ci] ${(e as Error).message}`)
        process.exitCode = 1
      }
      break
    }
    case 'gen': {
      // ★app-config G-35 M5：proteus gen config —— 生成 app.config.ts 骨架（06 §1）
      if (rest[0] !== 'config') throw new Error('proteus gen 目前仅支持 config（proteus gen config [file]）')
      const file = rest.find((a) => a !== 'config' && !a.startsWith('-')) ?? 'app.config.ts'
      try {
        const out = generateAppConfigSkeleton(path.resolve(file))
        console.log(`[proteus-app-config] 已生成骨架：${out}`)
        console.log('下一步：proteus app-config:check app.config.ts 校验 → 编辑 env/api/features 后接入运行时')
      } catch (e) {
        console.error(`[proteus-app-config] ${(e as Error).message}`)
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

/** 端口占用异步探测（net.connect 短超时；e2e:mp 体检 + 复用判定） */
async function probePort(port: number, timeoutMs = 500): Promise<boolean> {
  // ★双栈探测（IPv4 + IPv6）：微信开发者工具 automation 可能只监听 IPv6（lsof: *:9420 IPv6）——
  //   单 IPv4 探测会误判空闲 → 误走 launch 新实例 → 端口冲突 Failed to launch（真机实测踩坑）
  for (const host of ['127.0.0.1', '::1']) {
    const busy = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ port, host })
      const timer = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, timeoutMs)
      socket.once('connect', () => {
        clearTimeout(timer)
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        clearTimeout(timer)
        socket.destroy()
        resolve(false)
      })
    })
    if (busy) return true
  }
  return false
}

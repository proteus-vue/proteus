// packages/cli/src/index.ts
// Proteus CLI 入口：proteus build / explain / rules / router:check / version / help
// 核心逻辑（parseArgs / explainTarget / buildDir / listRules / checkRoutes）均为纯函数，可单测
// （shebang 由 esbuild --banner 在构建时注入，源码不写）
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
// ★B5 补丁脚本（src 与 dist 同指向仓库根 scripts/）——★2026-09-08 wechatide 标准后 automator 补丁不再需要，保留路径备用
const AUTOMATOR_PATCH_SCRIPT = fileURLToPath(new URL('../../../scripts/patch-automator.mjs', import.meta.url))
import { parseBuildArgs, parseExplainArgs, parseRulesArgs, parseRouterCheckArgs, parseModuleCheckArgs, parseModuleDuplicatesArgs, parseModuleAuditArgs, parseModuleInitArgs, parseCapabilityManifestArgs, parseCapabilityCheckArgs, parseComponentsAuditArgs, parseI18nCheckArgs, parseConfigCheckArgs, parseCssCheckArgs, parseStyleCheckArgs, parseCheckArgs, parseGenerateTypesArgs, parseMigrateTypesArgs, parseD2AuditArgs, parseGateArgs, formatHelpText, resolveCliVersion } from './args'
import { buildDir, planTargetedBuild, runTargetedBuildProgrammatic } from './build'
import { parseConformanceArgs, runConformance, runConformanceDemo } from './conformance'
import { parseHostArgs, runHostPush } from './host'
import { parseCreateHostArgs, runCreateHost, createHost, deriveBundleName } from './host-scaffold'
import { packageHarmonyHost, packageIosHost, packageAndroidHost } from './host-package'
import { applyNativeConfigFromProject, resolveNativeConfigFromProject } from './native-config'
import { appHostDir, appBundleFile, APP_PACKAGE_NAME, isAppPlatform, type AppPlatform } from './targets'
import { buildAppBundle } from './app-bundle'
import { startAppDevServer } from './app-dev-server'
import { scanRepoDirectory, formatRepoReport } from './repo-conformance'
import { explainTarget } from './explain'
import { listRules } from './rules'
import { checkRoutes, formatRouterCheck } from './router-check'
import { checkModuleConfigs } from './module-check'
import { readSubPackageRoots, scanDuplicateModules, formatDuplicateReport } from './module-duplicates'
import { runAuditModule } from './module-audit'
import { runCoverageAudit } from './coverage-audit'
import { runApiHookCheck, formatApiHookCheck } from './api-hook-check'
import { writeModuleConfigSkeleton } from './module-init'
// ★AI 共建工具包（2026-09-20）：proteus cobuild init/check —— 把共建机制随包分发给**任何**使用 Proteus 的工程
import { cobuildInit, cobuildCheck, formatCobuildInit, formatCobuildCheck } from './cobuild'
import { runCapabilityScan, runCapabilityCheck } from './capability-manifest'
import { auditComponents, formatComponentAudit } from './component-audit'
import { runFluidCheck, formatFluidCheck } from './fluid-check'
import { checkI18nUsage, formatI18nCheck } from './i18n-check'
import { checkConfigFile } from './config-check'
import { runCssCheck, formatCssCheck } from './css-check'
import { runStyleCheck, formatStyleCheck } from './style-check'
import { runCheck, formatCheck } from './check'
import { parseDevArgs, runDev, hasLegacyViteConfig, runDevProgrammatic, detectDelegationLoop, DELEGATED_ENV } from './dev'
import { runHealthCheck, formatHealthReport } from './health'
import { parseTestArgs, runTest } from './test'
import { checkAppConfigFile, formatAppConfigCheck, appConfigCheckSummary } from './app-config-check'
import { generateTypes, formatGenerateTypes } from './generate-types'
import { migrateTypesFile, formatMigrateTypes } from './migrate-types'
import { runMigrateMp } from './migrate-mp'
import { parseCiArgs, planCiInit } from './ci'
import { generateAppConfigSkeleton } from './app-config-gen'
import { runAuditAll, formatAuditAll } from './audit-all'
import { runDevtoolsBudget, formatDevtoolsBudget } from './devtools-budget'
import { runD2Audit, formatD2Audit, resolveD2Target } from './d2-audit'
import { runGlassAudit, formatGlassAudit } from './glass-audit'
import { parseMcpArgs, runMcpServe } from './mcp'
import { runGate, formatGateList } from './gate'
import { planMpE2E, diagnoseMpE2EEnv, formatMpE2EDiagnosis, prepareMpE2EProject } from './mp-e2e'
import { warnIfDistStale } from './dist-freshness'
import * as ui from './ui'

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  // ★★★启动期「陈旧 dist」告警（决策 #663）：`npx proteus` 走 dist ⇒ 改了 src 忘重建时会**跑旧代码**
  //   而本地 tsx src 手测正常（假绿）。实测事故：`proteus dev --target android` 仍启动 web（dist 停在 2.5h 前）。
  //   ★只在**从 dist 运行**时检查、只告警不阻断（详见 dist-freshness.ts 的诚实边界）。
  warnIfDistStale(cmd)

  switch (cmd) {
    case 'build': {
      const args = parseBuildArgs(rest)
      // ★#418 配置收敛：--target web|skyline|all → 工程构建。
      //   无 vite.config.ts（新形态）→ 程序化驱动（resolveProteusViteConfig + vite build，CLI 组装全部配置）；
      //   有 vite.config.ts（遗留工程）→ 旧路径（spawn 工程构建脚本）
      if (args.target) {
        try {
          // ★A1（2026-10-04）：App 平台（ios/android/harmony）与 `all` **恒走程序化路径**——
          //   App 屏内容构建是框架职责（无对应 npm 脚本），而 `all` 含 App 端；只有纯 vite 目标
          //   （web/skyline）在遗留 vite.config.ts 工程里走旧的 spawn 路径。
          const isViteT = args.target === 'web' || args.target === 'skyline'
          if (!hasLegacyViteConfig(process.cwd()) || !isViteT) {
            const r = await runTargetedBuildProgrammatic(args.target)
            if (!r.ok) process.exitCode = 1
            // ★hosts 第二/三刀：--package → 调平台工具链把宿主工程打成安装包（harmony→.hap / ios→.app / android→.apk）
            // ★★★完整宿主闭环（2026-10-08 · 用户「dist 里要有完整宿主项目 + 一条命令出包」）：
            //   缺省 hostDir = `dist/app/<platform>/host`；不存在则**自动 scaffold**（create host：模板 + runtime
            //   + 项目包名/版本/权限）；随后产**项目侧 bundle**（App 运行期内容源）并拷入宿主 → 打包 → 输出安装包。
            if (args.package && (args.target === 'harmony' || args.target === 'ios' || args.target === 'android' || args.target === 'all')) {
              const platform = (args.target === 'all' ? 'harmony' : args.target) as AppPlatform
              const projectRoot = process.cwd()
              const hostDir = path.resolve(args.hostDir ?? process.env.PROTEUS_HOST_DIR ?? appHostDir(projectRoot, platform))
              const autoScaffold = !(args.hostDir ?? process.env.PROTEUS_HOST_DIR)
              const native = await resolveNativeConfigFromProject(projectRoot)
              const appName = native?.app.name ?? path.basename(projectRoot)
              const bundleName =
                platform === 'android'
                  ? (native?.android.applicationId ?? 'dev.proteus.layoutcore')
                  : platform === 'ios'
                    ? (native?.ios.bundleId ?? deriveBundleName(appName))
                    : (native?.harmony.bundleName ?? deriveBundleName(appName))
              ui.header(`build --package  ·  ${platform}`, `${appName}  ${ui.dim(`(${bundleName})`)}`)
              const tb = Date.now()
              try {
                // ① 自动 scaffold（仅缺省落点 + 目录不存在时；已存在则**只刷新内容**，保留用户改动）
                if (autoScaffold && !fs.existsSync(hostDir)) {
                  const s = ui.step('生成宿主工程')
                  createHost({ platform, targetDir: hostDir, appName, bundleName, projectRoot })
                  s.done(ui.dim(path.relative(projectRoot, hostDir)))
                }
                // ② 项目侧运行期 bundle（App 壳内容源）→ dist/app/<platform>/bundle-superapp.js
                const sBundle = ui.step('构建运行期 bundle')
                const b = await buildAppBundle({ projectRoot, platform, outFile: appBundleFile(projectRoot, platform) })
                sBundle.done(`${(b.bytes / 1024).toFixed(0)} KB  ·  ${b.compiled} 页`)
                // ③ native 配置渲染进宿主原生文件（包名/版本/SDK/方向/权限）
                const nrep = await applyNativeConfigFromProject(hostDir, platform, projectRoot)
                if (!nrep.ok) ui.warn('native 配置应用失败（继续打包）')
                else if (nrep.changes.length) ui.ok(`native 配置已注入（${nrep.changes.length} 处：包名/版本/SDK/方向/权限）`)
                // ④ 打包
                const outPkg = path.join(projectRoot, 'dist', 'app', platform, APP_PACKAGE_NAME[platform])
                const sPack = ui.step('打包安装包')
                const pk =
                  platform === 'ios'
                    ? packageIosHost({ hostDir, projectRoot })
                    : platform === 'android'
                      ? packageAndroidHost({ hostDir, projectRoot, outApk: outPkg })
                      : packageHarmonyHost({ hostDir, projectRoot, platform: 'harmony' })
                for (const l of pk.log) if (/^⚠/.test(l)) ui.warn(l.replace(/^⚠\s*/, ''))
                if (!pk.ok) {
                  sPack.fail('失败')
                  for (const l of pk.log) if (/✗/.test(l)) ui.fail(l.replace(/^✗\s*/, ''))
                  process.exitCode = 1
                } else {
                  sPack.done(ui.dim(path.relative(projectRoot, outPkg)))
                  console.log('')
                  ui.ok(`${ui.bold('done')}  ${ui.dim(`总耗时 ${((Date.now() - tb) / 1000).toFixed(1)}s`)}`)
                  console.log('')
                }
              } catch (e) {
                ui.fail(`--package 失败：${(e as Error).message}`)
                process.exitCode = 1
              }
            }
          } else {
            const plans = planTargetedBuild(process.cwd(), args.target)
            const { spawnSync } = await import('node:child_process')
            for (const plan of plans) {
              // ★防重入（2026-09-20）：遗留分支委派的是工程自己的 npm script，
              //   而模板里该脚本的命令就是 `proteus build`——不拦就是无限递归。
              const loop = detectDelegationLoop(process.cwd(), plan.script)
              if (loop) throw new Error(loop)
              console.log(`[proteus] build --target：${plan.script}（${plan.command} ${plan.args.join(' ')}）`)
              const rr = spawnSync(plan.command, plan.args, {
                stdio: 'inherit',
                shell: process.platform === 'win32',
                env: { ...process.env, [DELEGATED_ENV]: '1' },
              })
              if (rr.status !== 0) {
                console.error(`[proteus] build 失败（${plan.script} exit ${rr.status}）`)
                process.exitCode = rr.status ?? 1
                break
              }
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
        compiler: args.compiler,
      })
      console.log(`[proteus] build：${result.files.length} 个页面 → ${args.outDir}`)
      // ★G-29 编译器后端插拔：rust 模式的双编译校验统计（skipped → 降级提示；mismatch 已在 buildDir 抛红）
      if (args.compiler === 'rust' && result.dualCheck) {
        if (result.dualCheck.ok) console.log(`[proteus] compiler=rust：${result.dualCheck.ok} 页 Node/Rust 双编译语义等价（G-29.1）✅`)
        if (result.dualCheck.skipped) console.warn(`[proteus] compiler=rust：${result.dualCheck.skipped} 页跳过双编译校验（${result.dualCheck.skippedReason ?? '未知'}）`)
      }
      if (args.debug) console.log(`[proteus] 决策 trace 已落盘：${result.traceFiles.length} 个（.transform-debug/）`)
      if (result.warnings) console.warn(`[proteus] ⚠ ${result.warnings} 条编译警告（详见各文件，--debug 可看决策链）`)
      break
    }
    case 'explain': {
      const { target, withIR, withVapor, withStyle, onlyBlocked, maxNodes, json } = parseExplainArgs(rest)
      console.log(explainTarget(target, { withIR, withVapor, withStyle, onlyBlocked, maxNodes, json }))
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
    // ★proteus cobuild —— AI 共建工具包（2026-09-20）：把共建机制随包分发到**任意**使用 Proteus 的工程。
    //   init：安装 skill + 台账骨架 + 报告模板 + 校验器 + AGENTS.md 指针（幂等，可重复跑；--force 覆盖）
    //   check：自检文件齐备（可挂 CI / 发布前）——缺失即 exit 1 并给可执行修法
    case 'cobuild': {
      const sub = rest[0] ?? 'check'
      const force = rest.includes('--force')
      if (sub === 'init') {
        console.log(formatCobuildInit(cobuildInit({ force })))
      } else if (sub === 'check') {
        const r = cobuildCheck({})
        console.log(formatCobuildCheck(r))
        if (!r.ok) process.exitCode = 1
      } else {
        throw new Error(`proteus cobuild 支持 init / check（收到：${sub}）`)
      }
      break
    }
      case 'gate': {
        // ★#453 统一门禁系统：gate ls（注册表目录）/ gate run <id|preset> [dir]（统一执行）
        const args = parseGateArgs(rest)
        try {
          if (args.sub === 'ls') {
            console.log(formatGateList(args.group))
            break
          }
          const r = await runGate(args.id!, args.root ?? '.')
          console.log(r.text)
          if (!r.ok) process.exitCode = 1
        } catch (e) {
          console.error(`[proteus-gate] ${(e as Error).message}`)
          process.exitCode = 1
        }
        break
      }
      case 'audit': {
      // proteus audit module（M8.6 CI 门禁）；★B6：audit all 全量门禁（test-framework B6）；★M10：audit devtools-budget（性能预算）
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
      // ★M10 性能预算烟测（devtools-plan M7.4；CI 10 倍余量上界抓病态回归）
      if (rest[0] === 'devtools-budget') {
        const result = runDevtoolsBudget()
        console.log(formatDevtoolsBudget(result))
        if (!result.ok) process.exitCode = 1
        break
      }
      // ★G-32 B1：audit coverage（G-32.1 小程序能力 100% 覆盖 + 闭环一致性门禁）
      if (rest[0] === 'coverage') {
        const result = runCoverageAudit()
        console.log(result.text)
        if (!result.ok) process.exitCode = 1
        break
      }
      // ★#448：audit d2（D-2 dogfooding 门禁——05-dogfooding-conformance D-2 机器化；规则级可配 proteus.config audit.rules）
      if (rest[0] === 'd2') {
        const { dir } = parseD2AuditArgs(rest.slice(1))
        try {
          const { scanDir, configFile } = await resolveD2Target(dir)
          const report = await runD2Audit(scanDir, { configFile })
          console.log(formatD2Audit(report))
          if (!report.ok) process.exitCode = 1
        } catch (e) {
          console.error(`[proteus-audit] ${(e as Error).message}`)
          process.exitCode = 1
        }
        break
      }
      // ★G-07：audit glass（玻璃治理门禁 GLS001-006——裸 backdrop-filter / 嵌套 / 节点预算）
      if (rest[0] === 'glass') {
        const dir = rest.find((a) => a !== 'glass' && !a.startsWith('-')) ?? 'src'
        try {
          const result = runGlassAudit(path.resolve(dir))
          console.log(formatGlassAudit(result))
          if (!result.ok) process.exitCode = 1
        } catch (e) {
          console.error(`[proteus-audit] ${(e as Error).message}`)
          process.exitCode = 1
        }
        break
      }
      if (rest[0] !== 'module') throw new Error('proteus audit 支持 d2 / glass / module / devtools-budget / coverage / all（proteus audit d2 [dir] | audit glass [dir] | audit module [root] [--dist] | audit devtools-budget | audit coverage | audit all [root]）')
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
    case 'api-check': {
      // ★G-31 B7 / G-32.4：CMP007 门禁——回调式 API / 同步存储 / 裸全局调用（平台桥文件豁免）
      const arg = rest[0] && !rest[0].startsWith('-') ? rest[0] : '.'
      const result = runApiHookCheck(arg)
      console.log(formatApiHookCheck(result))
      if (!result.ok) process.exitCode = 1
      break
    }
    case 'components:audit': {
      const { root } = parseComponentsAuditArgs(rest)
      const result = auditComponents(root)
      console.log(formatComponentAudit(result))
      if (!result.ok) process.exitCode = 1
      break
    }
    case 'fluid:check': {
      // ★G-22 柔性布局严格规则（FLD001-006）：扫描 pages/src 下 .vue
      const dir = rest.find((a) => !a.startsWith('-')) ?? '.'
      if (rest.filter((a) => !a.startsWith('-')).length > 1) throw new Error('proteus fluid:check 只接受一个目录/文件参数')
      try {
        const result = runFluidCheck(dir)
        console.log(formatFluidCheck(result))
        if (!result.ok) process.exitCode = 1
      } catch (e) {
        console.error(`[proteus-fluid] ${(e as Error).message}`)
        process.exitCode = 1
      }
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
    case 'health': {
      // ★工程/环境健康检查（与 check 领域门禁正交）：Node 版本/结构/依赖/产物/appid/IDE 一次性诊断
      const root = rest[0] && !rest[0].startsWith('-') ? rest[0] : '.'
      try {
        const items = await runHealthCheck(root)
        const { text, ok } = formatHealthReport(items)
        console.log(text)
        if (!ok) process.exitCode = 1
      } catch (e) {
        console.error(`[proteus-health] ${(e as Error).message}`)
        process.exitCode = 1
      }
      break
    }
    case 'dev': {
      const { target } = parseDevArgs(rest)
      try {
        // ★★★App 端 dev（2026-10-08 · 用户「dev 模式实时刷新 App 宿主页面内容」）：
        //   `proteus dev --target <android|ios|harmony>` = 完整宿主闭环的**开发形态**：
        //     scaffold（缺则）→ 起 dev server（HTTP，局域网）→ 编 **debug** 宿主（bundle 走 dev server + 热刷）
        //     → 装到设备 → 启动（注入 dev server 地址）→ watch 源码，改动即重建 bundle（宿主秒级刷新）。
        if (isAppPlatform(target)) {
          process.exitCode = await runAppDev(target)
          break
        }
        // ★#418 配置收敛：无 vite.config.ts（新形态）→ 程序化驱动（框架组装 vite 配置）；有 → 遗留 spawn
        if (!hasLegacyViteConfig(process.cwd())) {
          const close = await runDevProgrammatic({ target })
          process.on('SIGINT', () => void close().then(() => process.exit(0)))
          process.on('SIGTERM', () => void close().then(() => process.exit(0)))
        } else {
          const plan = runDev({ target })
          // ★防重入（2026-09-20）：同 build —— dev 脚本同样可能是 `proteus dev`（模板默认）
          const loop = detectDelegationLoop(process.cwd(), `dev（${plan.command} ${plan.args.join(' ')}）`)
          if (loop) throw new Error(loop)
          console.log(`[proteus] dev --target ${target}：${plan.command} ${plan.args.join(' ')}`)
          const { spawn } = await import('node:child_process')
          const child = spawn(plan.command, plan.args, {
            stdio: 'inherit',
            shell: process.platform === 'win32',
            env: { ...process.env, [DELEGATED_ENV]: '1' },
          })
          child.on('error', (e) => {
            console.error(`[proteus] dev 启动失败：${e.message}`)
            process.exitCode = 1
          })
          process.on('SIGINT', () => child.kill('SIGINT'))
          process.on('SIGTERM', () => child.kill('SIGTERM'))
        }
      } catch (e) {
        console.error(`[proteus-dev] ${(e as Error).message}`)
        process.exitCode = 1
      }
      break
    }
    case 'test': {
      const { scope, root, ide, port, debugger: debuggerModule } = parseTestArgs(rest)
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
          // ★★2026-09-08：wechatide skill-CLI 为唯一标准（automator 与新 Electron IDE 不兼容——launch 报
          //   "Failed to launch ... http port is open"）。改为：① 用 wechatide 开项目窗口（fullMode）+ 锁 skyline
          //   渲染模式（private config skylineRenderEnable:true——面向 skyline 项目的判据）② 设 PROTEUS_MP_E2E_WXIDE=1
          //   让 spec 走 createWxideMini（spawn wechatide 工具），不再 launch automator。
          const { spawnSync } = await import('node:child_process')
          const openWin = spawnSync(
            plan.ideCli,
            ['-c', 'zed', 'open_project_window', '--project', prepared.projectDir, '--window-mode', 'fullMode'],
            { encoding: 'utf8', timeout: 60_000 },
          )
          if (openWin.status !== 0) console.warn(`[proteus-test] 开窗失败（可能已开）：${(openWin.stderr || '').slice(0, 200)}`)
          // ★锁 skyline 渲染模式（private config——IDE 开窗可能覆写 private，开窗后写入再刷新页面生效）
          try {
            fs.writeFileSync(path.join(prepared.projectDir, 'project.private.config.json'), JSON.stringify({ setting: { skylineRenderEnable: true } }))
          } catch {
            /* private config 写了忽略 */
          }
          // ★★2026-09-08 根因修复：open_project_window 只开窗不编译——模拟器里小程序未编译加载 → 无活动页 →
          //   automation_navigate/runtime_info 报 getPageMetaByWebviewId null（rawPath null）。必须 simulator_refresh
          //   （=工具栏编译）把小程序编译进模拟器，automator 才有页面可驱动（实测 refresh 后 navigate 立刻 success）。
          //   ★刷新后稍等编译/渲染稳定再跑（automator 需就绪活动页）。
          const refresh = spawnSync(
            plan.ideCli,
            ['-c', 'zed', 'simulator_refresh', '--project', prepared.projectDir],
            { encoding: 'utf8', timeout: 90_000 },
          )
          if (refresh.status !== 0) console.warn(`[proteus-test] simulator_refresh 失败（编译可能未就绪）：${(refresh.stderr || '').slice(0, 200)}`)
          await new Promise((r) => setTimeout(r, 3000))
          const r = spawnSync(
            'npx',
            // ★2026-09-08：MP E2E 全家桶——冒烟 + Vue 能力对齐真机验收 + p-popover 方案A（同一管理副本/窗口，逐能力真机断言）
            //   ★--no-file-parallelism：vitest 默认并行跑多个文件，会同时对同一模拟器 navigate（冲突全败）→ 串行（同 test:e2e:web）
            [
              'vitest',
              'run',
              '--no-file-parallelism',
              // ★2026-09-08 范围精准（用户：未改编译器不必跑 vue 能力对齐）：PROTEUS_E2E_ONLY=<file> 时只跑指定文件，
              //   否则默认全家桶（smoke + components + vue-compat + popover）
              //   ★2026-09-14 新增 e2e-mp-components：内置组件**几何级**渲染/行为断言（补「不显示/塌陷/灰块」盲区）
              ...(process.env.PROTEUS_E2E_ONLY
                ? [`tests/${process.env.PROTEUS_E2E_ONLY}.test.ts`]
                : ['tests/e2e-mp-smoke.test.ts', 'tests/e2e-mp-components.test.ts', 'tests/e2e-mp-probe.test.ts', 'tests/e2e-vue-compat.test.ts', 'tests/e2e-mp-popover.test.ts']),
            ],
            {
              stdio: 'inherit',
              shell: process.platform === 'win32',
              env: {
                ...process.env,
                PROTEUS_MP_E2E: '1',
                PROTEUS_MP_E2E_WXIDE: '1',
                PROTEUS_MP_E2E_CONNECT: reuseIde ? '1' : '0',
                PROTEUS_AUTOMATOR_PORT: String(plan.port),
                PROTEUS_IDE_CLI: plan.ideCli,
                PROTEUS_MINI_PROGRAM_PATH: prepared.projectDir,
                // ★debugger 适配模块（--debugger <module>，MpDebuggerLike——console/network/clearCache/refresh 注入）
                ...(debuggerModule ? { PROTEUS_MP_DEBUGGER_MODULE: path.resolve(debuggerModule) } : {}),
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
      // ★G-31 B6：proteus migrate mp <file|dir> [--dry-run]（小程序 → Proteus 语义迁移 codemod）
      if (rest[0] === 'mp') {
        const target = rest.find((a) => a !== 'mp' && !a.startsWith('-')) ?? '.'
        const dryRun = rest.includes('--dry-run')
        const result = runMigrateMp(target, dryRun)
        console.log(result.text)
        break
      }
      if (rest[0] !== 'types') throw new Error('proteus migrate 支持 types（配置）/ mp（小程序语义迁移）：proteus migrate types <file> | migrate mp <file|dir> [--dry-run]')
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
    case 'create': {
      // ★hosts 第二刀 Stage 2：proteus create host <platform> <dir> —— 生成独立可编译的最小宿主工程
      if (rest[0] === 'host') {
        try {
          process.exitCode = await runCreateHost(parseCreateHostArgs(rest.slice(1)))
        } catch (e) {
          console.error(`[proteus] ${e instanceof Error ? e.message : String(e)}`)
          process.exitCode = 1
        }
        break
      }
      console.error(`proteus create 支持：host（收到：${rest[0] ?? '(空)'}）`)
      process.exitCode = 1
      break
    }
    case 'host': {
      // ★G-45 B3：调试基座 CLI——host push <module-dir>（插件目录前置校验 CMP084/087 + push 信封生成）
      //   devices/logs/serve 随 B4 transport 适配器落地
      try {
        if (rest[0] === 'create') {
          process.exitCode = await runCreateHost(parseCreateHostArgs(rest.slice(1)))
          break
        }
        const args = parseHostArgs(rest)
        if (args.sub === 'push') {
          process.exitCode = runHostPush(args)
        }
      } catch (e) {
        console.error(`[proteus] ${e instanceof Error ? e.message : String(e)}`)
        process.exitCode = 1
      }
      break
    }
    case 'conformance': {
      // ★G-38 B2 尾：42 项 conformance（C-01~C-10）——默认 G-38 Node 参考；--backend 外部后端；--demo Terminal+Fallback 演示
      // ★G-42 B5：--repo <dir> 仓库治理扫描（G-42.6 严禁 fork）
      const args = parseConformanceArgs(rest.filter((a) => a !== '--demo'))
      try {
        const demo = rest.includes('--demo')
        if (demo) {
          const { text, ok } = await runConformanceDemo()
          console.log(text)
          if (!ok) process.exitCode = 1
          break
        }
        if (args.repoDir) {
          // G-42 B5：--repo 分支——fork 扫描宿主仓库
          const result = scanRepoDirectory(args.repoDir)
          const { text, ok } = formatRepoReport(args.repoDir, result)
          console.log(text)
          if (!ok) process.exitCode = 1
          break
        }
        const { text, ok } = await runConformance(args)
        console.log(text)
        if (!ok) process.exitCode = 1
      } catch (e) {
        console.error(`[proteus-conformance] ${(e as Error).message}`)
        process.exitCode = 1
      }
      break
    }
    case 'version':
      console.log(resolveCliVersion())
      break
    case 'mcp': {
      // ★决策 #681：`proteus mcp serve` —— stdio MCP server（MCP 客户端直连）。
      //   ★输出走 stderr（stdout 是 JSON-RPC 协议通道，见 mcp.ts）——此处不调 ui.ts。
      const { options } = parseMcpArgs(rest)
      await runMcpServe(options)
      break
    }
    case 'help':
    default:
      // ★美化帮助（决策 #213）：分组 + ANSI 色彩（TTY 自动检测；非 TTY/CI 纯文本）
      console.log(formatHelpText())
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

/**
 * ★★★App 端 dev（2026-10-08 · 用户「dev 模式实时刷新 App 宿主页面内容」）。
 *
 * 流程：scaffold（缺则）→ 起 dev server → 编 **debug** 宿主（bundle 走 dev server + 热刷）→
 *       装到设备（android adb）→ 启动（注入 dev server 地址）→ watch 持续（改动即重建）。
 *
 * ★诚实边界：本函数实现 **android** 的"装 + 起"（adb 通用）；ios/harmony 的装/起用设备侧工具
 *   （devicectl / hdc），本批先给出 server + debug 宿主编译（产物落 dist），装/起留待 B3（如实打印下一步）。
 */
async function runAppDev(target: AppPlatform): Promise<number> {
  const projectRoot = process.cwd()
  const hostDir = path.resolve(appHostDir(projectRoot, target))
  const native = await resolveNativeConfigFromProject(projectRoot)
  const appName = native?.app.name ?? path.basename(projectRoot)
  const bundleName =
    target === 'android'
      ? (native?.android.applicationId ?? 'dev.proteus.layoutcore')
      : target === 'ios'
        ? (native?.ios.bundleId ?? deriveBundleName(appName))
        : (native?.harmony.bundleName ?? deriveBundleName(appName))
  ui.header(`dev  ·  ${target}`, `${appName}  ${ui.dim(`(${bundleName})`)}`)
  const t0 = Date.now()

  // ① scaffold（缺则）——与 `build --package` 同一实现
  if (!fs.existsSync(hostDir)) {
    const s = ui.step('生成宿主工程')
    createHost({ platform: target, targetDir: hostDir, appName, bundleName, projectRoot })
    s.done(ui.dim(path.relative(projectRoot, hostDir)))
  }

  // ② dev server（含首建 bundle）
  const sBundle = ui.step('构建 dev bundle')
  const server = await startAppDevServer({
    projectRoot,
    platform: target,
    onRebuild: (i) => {
      if (i.version === 1) sBundle.done(`${(i.bytes / 1024).toFixed(0)} KB`)
      else ui.event(`bundle v${i.version}  (${i.ms}ms · ${i.reason})`)
    },
  })
  ui.ok(`dev server  ${ui.cyan(server.url)}`)
  ui.info(`DevTools 面板  ${ui.cyan(`${server.url}/`)}  ${ui.dim('（浏览器打开：设备/屏幕/重建时间线）')}`)

  // ③ debug 宿主（bundle 走 dev server）→ 打包到 dist
  const outPkg = path.join(projectRoot, 'dist', 'app', target, APP_PACKAGE_NAME[target])
  await applyNativeConfigFromProject(hostDir, target, projectRoot)
  const sPack = ui.step('打包 debug 宿主')
  const pk =
    target === 'android'
      ? packageAndroidHost({ hostDir, projectRoot, dev: true, devUrl: server.url, outApk: outPkg })
      : target === 'ios'
        ? packageIosHost({ hostDir, projectRoot, dev: true, devUrl: server.url, outApp: outPkg })
        : packageHarmonyHost({ hostDir, projectRoot, platform: 'harmony' })
  if (!pk.ok) {
    sPack.fail('打包失败')
    for (const l of pk.log.filter((x) => x.startsWith('✗') || x.includes('✗'))) ui.fail(l.replace(/^✗\s*/, ''))
    await server.close()
    return 1
  }
  // 成功：只透出"警告类"明细（如 dev 缺 dev-manifest），其余工具细节不刷屏
  sPack.done(ui.dim(path.relative(projectRoot, outPkg)))
  for (const l of pk.log) if (/^⚠/.test(l)) ui.warn(l.replace(/^⚠\s*/, ''))

  // ④ 装 + 起（android：adb；ios/harmony 本批给下一步指引）
  const androidApk = target === 'android' && 'apk' in pk ? (pk as { apk: string | null }).apk : null
  if (target === 'android' && androidApk) {
    const adb = process.env.ADB ?? path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb')
    const { execFileSync } = await import('node:child_process')
    // ★★★dev 的装/起 = **杀掉旧实例 → 装新包 → 起新实例**（决策 #668）：① force-stop 旧进程；
    //   ② `install -r -t -g -d`（allow downgrade）；仍失败 ⇒ 卸载后重装（dev 迭代不保 app 数据）。
    //   ★捕获 adb 输出（不 stdio:'inherit'）——成功时终端只见一行 ✓，失败才透出原因（用户「终端要干净」）。
    const adbRun = (args: string[]): { ok: boolean; out: string } => {
      try { return { ok: true, out: execFileSync(adb, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }) } }
      catch (e) { return { ok: false, out: String((e as { stderr?: string }).stderr ?? (e as Error).message) } }
    }
    const sInstall = ui.step('安装到设备')
    adbRun(['shell', 'am', 'force-stop', bundleName])   // 旧进程可能已不在 ⇒ 忽略
    let r = adbRun(['install', '-r', '-t', '-g', '-d', androidApk])
    if (!r.ok) {
      sInstall.note('版本/签名冲突 ⇒ 卸载旧包后重装')
      adbRun(['uninstall', bundleName])
      r = adbRun(['install', '-r', '-t', '-g', androidApk])
    }
    if (!r.ok) {
      sInstall.fail('adb install 失败')
      ui.dim(r.out.trim().split('\n').slice(-3).join('\n')).split('\n').forEach((l) => ui.hint(l))
      ui.hint(`手动：adb install -r -t -g -d ${path.relative(projectRoot, androidApk)}（MIUI 若拒：adb shell settings put global verifier_verify_adb_installs 0）`)
    } else {
      adbRun(['shell', 'am', 'force-stop', bundleName])
      const start = adbRun(['shell', 'am', 'start', '-n', `${bundleName}/dev.proteus.layoutcore.AppActivity`, '--es', 'proteusDev', server.url])
      sInstall.done()
      if (!start.ok) ui.warn(`启动命令未回执：${start.out.trim().slice(-160)}`)
    }
  } else if (target === 'ios') {
    // ★★★iOS 装 + 起（决策 #683）：devicectl（Xcode 15+；DEVELOPER_DIR 经 xcode-env 解析）。
    const iosApp = 'app' in pk ? (pk as { app: string | null }).app : null
    if (iosApp) {
      const { execFileSync } = await import('node:child_process')
      // Xcode 工具链：优先 env → 非默认安装位（与 hosts/ios/lib/xcode-env.sh 同判据：能给 iOS SDK + 有 devicectl）
      const devDir = process.env.PROTEUS_DEVELOPER_DIR ?? process.env.DEVELOPER_DIR ?? '/Volumes/data1/work/office-applications/Xcode.app/Contents/Developer'
      const env = { ...process.env, DEVELOPER_DIR: devDir }
      const xcrun = (args: string[]): { ok: boolean; out: string } => {
        try { return { ok: true, out: execFileSync('xcrun', args, { env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }) } }
        catch (e) { return { ok: false, out: String((e as { stderr?: string }).stderr ?? (e as Error).message) } }
      }
      const sInstall = ui.step('安装到设备')
      // 设备列表（首个 connected）——取**标识符列**（UDID/UUID 形态），无则回落设备名（devicectl 二者皆可）
      const dl = xcrun(['devicectl', 'list', 'devices'])
      const row = dl.out.split('\n').find((l) => /\bconnected\b/.test(l)) ?? ''
      const cols = row.trim().split(/\s{2,}/).map((c) => c.trim()).filter(Boolean)
      const devId = cols.find((c) => /^[0-9A-Fa-f-]{20,}$/.test(c) || /\.coredevice\.local$/.test(c)) ?? cols[0] ?? ''
      if (!dl.ok || !devId) {
        sInstall.fail('未找到已连接 iOS 设备')
        ui.hint(`debug 包已产出：${path.relative(projectRoot, iosApp)}`)
        ui.hint('手动：xcrun devicectl device install app --device <UDID> <app>')
      } else {
        xcrun(['devicectl', 'device', 'process', 'launch', '--device', devId, '--terminate-existing', bundleName]) // 杀旧实例（忽略失败）
        let r = xcrun(['devicectl', 'device', 'install', 'app', '--device', devId, iosApp])
        if (!r.ok) {
          sInstall.note('签名/版本冲突 ⇒ 卸载旧包后重装')
          xcrun(['devicectl', 'device', 'uninstall', 'app', '--device', devId, bundleName])
          r = xcrun(['devicectl', 'device', 'install', 'app', '--device', devId, iosApp])
        }
        if (!r.ok) {
          sInstall.fail('devicectl install 失败')
          sInstall.note(r.out.trim().split('\n').slice(-3).join('\n'))
        } else {
          // ★启动注入 dev server 地址（`--proteusDev <url>`）；DEV_URL 已编译进二进制作为兜底
          const start = xcrun(['devicectl', 'device', 'process', 'launch', '--device', devId, '--terminate-existing', bundleName, '--', '--proteusDev', server.url])
          sInstall.done()
          if (!start.ok) sInstall.note(`启动未回执：${start.out.trim().slice(-160)}`)
          ui.hint('iOS 首次运行若被拦：设置→通用→VPN与设备管理→信任该开发者证书')
        }
      }
    }
  } else if (target === 'harmony') {
    ui.info('harmony 的「装 + 起」请用 hdc')
    ui.info(`debug 包：${path.relative(projectRoot, outPkg)} · 启动注入 dev server：${server.url}`)
  }

  // ⑤ 持续运行（Ctrl+C 退出）——watch 在 server 内部
  const close = async () => { await server.close(); process.exit(0) }
  process.on('SIGINT', () => void close())
  process.on('SIGTERM', () => void close())
  console.log('')
  ui.ok(`${ui.bold('已就绪')}  ${ui.dim(`总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)}  ${ui.dim('· 改源码保存即热刷')}`)
  ui.hint('Ctrl+C 退出')
  console.log('')
  await new Promise<void>(() => { /* 挂住——server 与 watch 在后台跑 */ })
  return 0
}

// packages/cli/src/health.ts
// ★test-framework + cli-plus：proteus health [root] —— 工程/环境健康检查（一次性诊断）
// 与 proteus check（领域规范门禁）/ audit all（六域聚合）正交：health 检查「开发环境 + 工程健康」——
//   Node 版本 / 工程结构 / 依赖 / 产物 / appid / IDE / workspace 链接
// 级别语义（对齐 mp-e2e 环境体检）：error → 阻断（exit 1）；warn → 报告不阻断
import fs from 'node:fs'
import path from 'node:path'
import { loadTsConfig } from './config-check'
import { isValidAppid, resolveMpIdeCli } from './mp-e2e'

export interface HealthItem {
  /** 检查项 ID（kebab-case） */
  name: string
  level: 'ok' | 'warn' | 'error'
  message: string
}

export interface HealthCheckOptions {
  /** 当前 Node 版本（注入测试；缺省 process.versions.node） */
  nodeVersion?: string
  /** 路径存在性检查（注入测试；缺省 fs.existsSync） */
  exists?: (p: string) => boolean
}

/** ★工程/环境健康检查（纯函数可测）：一次性诊断报告 */
export async function runHealthCheck(root: string, opts: HealthCheckOptions = {}): Promise<HealthItem[]> {
  const exists = opts.exists ?? fs.existsSync
  const nodeVersion = opts.nodeVersion ?? process.versions.node
  const items: HealthItem[] = []
  const abs = (p: string): string => path.resolve(root, p)

  // ① Node 版本（require(ESM) 需 ≥22.12——决策 #204 环境坑）
  const major = Number(nodeVersion.split('.')[0])
  items.push({
    name: 'node-version',
    level: major >= 22 ? 'ok' : 'warn',
    message: major >= 22
      ? `Node ${nodeVersion} ✓（require(ESM) 支持）`
      : `Node ${nodeVersion}——web/jsdom 测试在 <22.12 加载失败（require(ESM)），建议 ≥22.12`,
  })

  // ② 工程结构：proteus.config.ts / node_modules
  const hasProteusConfig = exists(abs('proteus.config.ts'))
  items.push({
    name: 'project-root',
    level: hasProteusConfig ? 'ok' : 'error',
    message: hasProteusConfig ? 'proteus.config.ts ✓（Proteus 工程）' : 'proteus.config.ts 缺失——当前目录不是 Proteus 工程（proteus health 需在工程根运行）',
  })
  const hasNodeModules = exists(abs('node_modules'))
  items.push({
    name: 'node_modules',
    level: hasNodeModules ? 'ok' : 'error',
    message: hasNodeModules ? 'node_modules ✓' : 'node_modules 缺失——先 npm install',
  })

  // ③ package.json scripts（构建/测试入口）
  const pkgFile = abs('package.json')
  let scripts: Record<string, string> = {}
  if (exists(pkgFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8')) as { scripts?: Record<string, string> }
      scripts = pkg.scripts ?? {}
    } catch {
      /* 非法 package.json → scripts 空，走缺失提示 */
    }
  }
  const missingScripts = ['build:web', 'build:mp', 'test'].filter((s) => !scripts[s])
  items.push({
    name: 'scripts',
    level: missingScripts.length ? 'warn' : 'ok',
    message: missingScripts.length
      ? `package.json scripts 缺失：${missingScripts.join('/')}（构建/测试入口不完整）`
      : 'package.json scripts（build:web/build:mp/test）✓',
  })

  // ④ app.config.ts（应用级运行时配置，可选——决策 #211 职责边界）
  const hasAppConfig = exists(abs('app.config.ts'))
  items.push({
    name: 'app-config',
    level: hasAppConfig ? 'ok' : 'warn',
    message: hasAppConfig
      ? 'app.config.ts ✓（应用运行时配置——职责边界见决策 #211）'
      : 'app.config.ts 缺失（可选）：应用级运行时配置（app.name/api/features/theme）建议创建，proteus gen config 生成骨架',
  })

  // ⑤ proteus.config 关键字段（appid 有效性 / pagesDir）
  let appid = ''
  let pagesDir = 'pages'
  let platform = 'mp-weixin'
  if (hasProteusConfig) {
    try {
      const config = (await loadTsConfig(abs('proteus.config.ts'))) as { appid?: string; pagesDir?: string; platform?: string }
      appid = config.appid ?? ''
      pagesDir = config.pagesDir ?? 'pages'
      platform = config.platform ?? 'mp-weixin'
    } catch (e) {
      items.push({
        name: 'proteus-config-load',
        level: 'error',
        message: `proteus.config.ts 加载失败：${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }
  if (appid) {
    items.push({
      name: 'appid',
      level: isValidAppid(appid) ? 'ok' : 'error',
      message: isValidAppid(appid)
        ? `appid ${appid} ✓（真实小程序 appid）`
        : `appid ${appid} 无效/占位（wx+16 位十六进制）——IDE 导入/automator 体检会失败，proteus.config.ts 配置真实 appid`,
    })
  }
  const hasPagesDir = exists(abs(pagesDir))
  items.push({
    name: 'pages-dir',
    level: hasPagesDir ? 'ok' : 'error',
    message: hasPagesDir ? `pagesDir ${pagesDir} ✓` : `pagesDir ${pagesDir} 不存在（proteus.config.ts pagesDir 指向错误）`,
  })

  // ⑥ 产物状态（web/mp）
  const hasWebDist = exists(abs('dist/web'))
  const hasMpDist = exists(abs('dist/mp-weixin'))
  items.push({
    name: 'build-output',
    level: hasWebDist || hasMpDist ? 'ok' : 'warn',
    message: hasWebDist && hasMpDist
      ? '产物 dist/web + dist/mp-weixin ✓'
      : hasWebDist
        ? '产物 dist/web ✓（mp 产物缺失：npm run build:mp）'
        : hasMpDist
          ? '产物 dist/mp-weixin ✓（web 产物缺失：npm run build:web）'
          : '产物缺失（dist/web + dist/mp-weixin）——先 npm run build:web / build:mp',
  })

  // ⑦ workspace 链接完整性（@proteus-vue/* 包 dist——workspace 链接模式下 npm install 的 prepare 钩子重建）
  const hasWorkspace = exists(abs('node_modules/@proteus-vue'))
  if (hasWorkspace) {
    const pkgDeps = (() => {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8')) as {
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
        }
        return { ...pkg.dependencies, ...pkg.devDependencies }
      } catch {
        return {}
      }
    })()
    const frameworkDeps = Object.keys(pkgDeps).filter((d) => d.startsWith('@proteus-vue/'))
    const missingDists = frameworkDeps.filter((d) => !exists(abs(`node_modules/${d}/dist/index.js`)))
    items.push({
      name: 'workspace-links',
      level: missingDists.length ? 'warn' : 'ok',
      message: missingDists.length
        ? `${missingDists.length} 个 @proteus-vue/* 包 dist 缺失（${missingDists.join(', ')}）——npm install（prepare 钩子重建）`
        : `${frameworkDeps.length} 个 @proteus-vue/* 包链接 ✓（dist 就绪）`,
    })
  }

  // ⑧ IDE 可用性（MP 工程：platform=mp-weixin）
  if (platform === 'mp-weixin') {
    const ideCli = resolveMpIdeCli()
    items.push({
      name: 'ide-cli',
      level: ideCli ? 'ok' : 'warn',
      message: ideCli
        ? `微信开发者工具 CLI ✓（${ideCli}）`
        : '微信开发者工具 CLI 未探测到（PROTEUS_IDE_CLI / --ide / 平台默认路径）——小程序 E2E（proteus test e2e:mp）需要',
    })
  }

  return items
}

/** 健康检查报告（✅/⚠/✗ 图标；error 级 → 返回 ok=false 供 CLI 阻断） */
export function formatHealthReport(items: HealthItem[]): { text: string; ok: boolean } {
  const icon = (l: HealthItem['level']): string => (l === 'ok' ? '✅' : l === 'warn' ? '⚠' : '✗')
  const lines = ['[proteus] 工程/环境健康检查：']
  for (const item of items) {
    lines.push(`  ${icon(item.level)} ${item.name}：${item.message}`)
  }
  const errors = items.filter((i) => i.level === 'error')
  lines.push(errors.length ? `[proteus] ${errors.length} 项 error（阻断）：${errors.map((e) => e.name).join(', ')}` : '[proteus] 健康 ✓')
  return { text: lines.join('\n'), ok: errors.length === 0 }
}

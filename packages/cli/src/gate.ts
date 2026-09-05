// packages/cli/src/gate.ts
// ★#453/#454：统一门禁系统——Gate 注册表（单一来源）+ `proteus gate ls/run`
//   框架方法论落点：仓库三先例（HELP_GROUPS→cli.md / CONFIG_FIELD_LAYERS→配置审计规则 / AUDIT_RULE_IDS→audit 配置）
//   的注册表派生模式——门禁目录不再散落；每门禁一条 { id, 族, scope, usage, desc, run? }。
//   run 适配器一律收敛到各域既有 runner（零逻辑复制——index.ts 独立命令与 gate run 同源镜像）；
//   B2（聚合引擎遍历注册表）随 audit-all/check 重构批次；B4 HELP 组派生、B5 仓库治理入册、B6 config 开关随后续批次。
import path from 'node:path'
import fs from 'node:fs'
import { runCheck, formatCheck, type CheckOptions } from './check'
import { runAuditAll, formatAuditAll } from './audit-all'
import { runD2Audit, formatD2Audit, resolveD2Target } from './d2-audit'
import { runDevtoolsBudget, formatDevtoolsBudget } from './devtools-budget'
import { runCoverageAudit } from './coverage-audit'
import { runFluidCheck, formatFluidCheck } from './fluid-check'
import { runCssCheck, formatCssCheck } from './css-check'
import { runStyleCheck, formatStyleCheck } from './style-check'
import { checkRoutes, formatRouterCheck, resolvePagesDir } from './router-check'
import { checkConfigFile } from './config-check'
import { checkI18nUsage, formatI18nCheck } from './i18n-check'
import { runCapabilityCheck } from './capability-manifest'
import { runApiHookCheck, formatApiHookCheck } from './api-hook-check'
import { auditComponents, formatComponentAudit } from './component-audit'
import { checkModuleConfigs } from './module-check'

/** 门禁族（分组展示） */
export type GateGroup = '快速聚合' | '深度聚合' | '专项检查' | '框架自检'
/** 门禁作用域：project=开发者工程 / framework=框架仓自检 / self=独立烟测任意目录 */
export type GateScope = 'project' | 'framework' | 'self'

export interface GateRunResult {
  ok: boolean
  text: string
}

export interface GateInfo {
  id: string
  group: GateGroup
  scope: GateScope
  usage: string
  desc: string
  /** 统一执行器（root = 工程/目录根——独立命令与 gate run 共用同一 runner） */
  run?: (root: string) => Promise<GateRunResult> | GateRunResult
}

/** 异步失败 → 结果对象（不抛——统一执行面）；missing 语义由各适配器自行判断（skip → ok:true） */
async function safeRun(root: string, fn: (root: string) => Promise<GateRunResult> | GateRunResult, prefix: string): Promise<GateRunResult> {
  try {
    return await fn(root)
  } catch (e) {
    return { ok: false, text: `[proteus-${prefix}] ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** ★#453/#454 门禁注册表（单一来源——新增门禁在此补录；LS/run/文档派生消费） */
export const GATES: GateInfo[] = [
  // —— 快速聚合（G-33 check——css/style/router/cli+app-config 域） ——
  {
    id: 'check',
    group: '快速聚合',
    scope: 'project',
    usage: 'proteus check [dir] [--no-strict-css|--no-strict-style|--no-strict-router|--no-strict-cli]',
    desc: '★一键全量门禁（G-33 M1）：css + style + router + config/cli 域聚合；任一域失败 → exit 1',
    run: async (root) => {
      const opts: CheckOptions = { strictCss: true, strictStyle: true, strictRouter: true, strictCli: true }
      const summary = await runCheck(path.resolve(root), opts)
      return { ok: summary.ok, text: formatCheck(summary) }
    },
  },
  // —— 深度聚合（audit all 八域） ——
  {
    id: 'audit',
    group: '深度聚合',
    scope: 'project',
    usage: 'proteus audit all [root]',
    desc: '★全量审计门禁（B6 + M10 + D-2）：八域聚合 + CI 耗时预算（<12s）；缺配置/未声明 audit 的域跳过（D-2 opt-in）',
    run: async (root) => {
      const result = await runAuditAll(path.resolve(root))
      return { ok: result.ok, text: formatAuditAll(result) }
    },
  },
  // —— 专项检查（project scope——独立命令经注册表统一执行，runner 与独立命令同源） ——
  {
    id: 'd2',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus audit d2 [dir]',
    desc: '★D-2 dogfooding 门禁：页面不裸平台 API/手写 @media/引第三方 UI——规则级可配（audit.rules）',
    run: async (root) => {
      const dirArg = root && root !== '.' ? path.resolve(root) : undefined
      try {
        if (dirArg) {
          const report = await runD2Audit(dirArg)
          return { ok: report.ok, text: formatD2Audit(report) }
        }
        const { scanDir, configFile } = await resolveD2Target(undefined, { cwd: process.cwd() })
        const report = await runD2Audit(scanDir, { configFile })
        return { ok: report.ok, text: formatD2Audit(report) }
      } catch (e) {
        return { ok: false, text: `[proteus-audit] ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  },
  {
    id: 'fluid',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus fluid:check [dir|file]',
    desc: '★柔性布局严格规则（FLD001-006）：禁手写 @media / 硬编码断点 / p-fluid 须 min·max 等',
    run: (root) =>
      safeRun(root, (r) => {
        const result = runFluidCheck(r)
        return { ok: result.ok, text: formatFluidCheck(result) }
      }, 'fluid'),
  },
  {
    id: 'api-check',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus api-check [dir]',
    desc: '★CMP007 门禁：回调式平台 API / 同步存储 / 裸全局能力调用 → 改 useXxx() Hook（平台桥文件豁免）',
    run: (root) =>
      safeRun(root, (r) => {
        const result = runApiHookCheck(r)
        return { ok: result.ok, text: formatApiHookCheck(result) }
      }, 'api-check'),
  },
  {
    id: 'capabilities',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus capabilities:check [dir]',
    desc: '★平台原生模块规范静态检查（B5 §6 禁止清单：业务目录禁 wx.*/window.*）',
    run: (root) =>
      safeRun(root, (r) => {
        const { text, violations } = runCapabilityCheck(r)
        return { ok: violations.length === 0, text }
      }, 'capabilities'),
  },
  {
    id: 'capabilities-manifest',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus capabilities:manifest [dir] [--platform <web|skyline|app>]',
    desc: '★扫描 capabilities/*.capability.ts → 能力清单 / 平台缺失报告（写入型工具——经独立命令运行）',
  },
  {
    id: 'i18n',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus i18n:check [root] [--catalog <path>]',
    desc: '★i18n 用法检查：硬编码文案检测 + catalog 键对照（缺 catalog 跳过不阻断）',
    run: (root) =>
      safeRun(root, (r) => {
        const result = checkI18nUsage(r)
        return { ok: result.ok, text: formatI18nCheck(result) }
      }, 'i18n'),
  },
  {
    id: 'router',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus router:check [dir]',
    desc: '校验 <route> 块与集中式 meta（来源登记 + 父路由推导依据）',
    run: (root) =>
      safeRun(root, (r) => {
        const value = checkRoutes(resolvePagesDir(r))
        return { ok: value.ok, text: formatRouterCheck(value) }
      }, 'router'),
  },
  {
    id: 'module',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus module:check [dir] [--graph]',
    desc: '校验 proteus-module.config.ts 模块契约（缺失字段/环/重名/版本冲突）',
    run: async (root) =>
      safeRun(root, async (r) => {
        const { text, result, cycles, conflicts } = await checkModuleConfigs(path.resolve(r), false)
        const ok = result.modules.every((m) => m.ok) && !result.duplicateNames.length && !cycles.length && !conflicts.length
        return { ok, text }
      }, 'module'),
  },
  {
    id: 'audit-module',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus audit module [root] [--dist <dir>] [--graph-json <path> | --no-graph-json]',
    desc: '★模块审计（M8.6 硬卡）：契约校验 + 图谱（环/重名/版本冲突）+ 可选产物（--dist 分包体积/重复）\n      --dist         产物目录（分包体积阈值 + 去重检测）\n      --graph-json   落盘 module-graph.json（缺省 .proteus/module-graph.json）',
  },
  {
    id: 'module-duplicates',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus module:duplicates [distDir]',
    desc: '分包间共享依赖去重检测（读 dist/mp-weixin/app.json 的 subPackages——产物参数门禁，经独立命令运行）',
  },
  {
    id: 'css',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus css:check [dir|file] [--no-strict] [--fix] [--report <path>]',
    desc: '★CSS 跨端兼容校验（CSS001-012）+ 预算门禁（--fix/--report 为写型参数——经独立命令运行；gate run 走严格检查）',
    run: (root) =>
      safeRun(root, (r) => {
        const result = runCssCheck(r, { strict: true, fix: false })
        return { ok: result.ok, text: formatCssCheck(result) }
      }, 'css'),
  },
  {
    id: 'style',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus style:check [dir|file] [--platform <web|skyline|ios|android|harmony>]',
    desc: '★样式运行时安全（STS001-006：模板 :style 白名单 + 静态推导覆盖率；gate run 走 web 平台）',
    run: (root) =>
      safeRun(root, (r) => {
        const result = runStyleCheck(r, { platform: 'web' })
        return { ok: result.ok, text: formatStyleCheck(result) }
      }, 'style'),
  },
  {
    id: 'config',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus config:check <proteus.config.ts>',
    desc: '★配置校验：必填字段 + 跨层依赖（CONFIG_LAYER_VIOLATION）+ 版本迁移提示（root=文件或含 proteus.config.ts 的目录）',
    run: async (root) => {
      const file = fs.existsSync(root) && fs.statSync(root).isFile() ? root : path.join(root, 'proteus.config.ts')
      try {
        const { result, text } = await checkConfigFile(file)
        return { ok: result.ok, text }
      } catch (e) {
        return { ok: true, text: `[proteus-config] ${file} 不存在——跳过（独立编译模式无配置文件）` }
      }
    },
  },
  {
    id: 'health',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus health [dir]',
    desc: '★工程/环境健康检查：Node/结构/依赖/产物/appid/pagesDir/workspace 链接/IDE（诊断型工具——经独立命令运行）',
  },
  // —— 框架自检（framework scope；devtools-budget 为独立烟测可任意目录） ——
  {
    id: 'coverage',
    group: '框架自检',
    scope: 'framework',
    usage: 'proteus audit coverage',
    desc: '★语义覆盖审计（G-32.1）：能力 100% 覆盖 + catalog↔enum↔tag↔render-map 四向闭环一致性（需框架仓语境）',
    run: () => {
      const result = runCoverageAudit()
      return { ok: result.ok, text: result.text }
    },
  },
  {
    id: 'devtools-budget',
    group: '框架自检',
    scope: 'self',
    usage: 'proteus audit devtools-budget',
    desc: '★DevTools 性能预算烟测（bus.emit / 火焰图 5000 span / 万级 ingest——10 倍余量 CI 上界）',
    run: () => {
      const result = runDevtoolsBudget()
      return { ok: result.ok, text: formatDevtoolsBudget(result) }
    },
  },
  {
    id: 'components',
    group: '框架自检',
    scope: 'framework',
    usage: 'proteus components:audit [dir]',
    desc: '★组件审计：p-* 组件注册表 vs 实际使用（未登记/未使用/标签漂移）',
    run: (root) =>
      safeRun(root, (r) => {
        const result = auditComponents(r)
        return { ok: result.ok, text: formatComponentAudit(result) }
      }, 'components'),
  },
  {
    id: 'host-push',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus host push <module-dir>',
    desc: '★G-45 B3 调试基座：插件模块前置校验（proteus.plugin.json 完整性/签名 sig-*/conformance 覆盖率）\n      + push 信封生成（manifestHash/bundleHash——完整性）',
  },
  {
    id: 'conformance',
    group: '框架自检',
    scope: 'framework',
    usage: 'proteus conformance [--backend <spec>] [--only <C-xx>] [--demo] [--repo <dir>]',
    desc: '★G-38 42 项 conformance（C-01~C-10）+ G-42 仓库治理扫描（多旗标参考实现门禁——经独立命令运行）',
  },
]

/** 可 run 的门禁（已接线执行器） */
export function findGate(id: string): GateInfo | undefined {
  return GATES.find((g) => g.id === id)
}

/** 注册表 usage 集合（★#454 B4-lite：与 HELP「检查与门禁」组一致性守卫用） */
export function gateUsages(): string[] {
  return GATES.map((g) => g.usage)
}

/** 帮助文本入口（HELP「检查与门禁」组的 gate 命令元条目——一致性守卫排除项） */
export const GATE_COMMAND_HELP = {
  usage: 'proteus gate ls [--group=<族>] | gate run <id|preset> [dir]',
  desc: '★统一门禁系统（★#453/#454 Gate 注册表单一来源）：ls = 全量门禁目录；run = 统一执行（● 已接线 / ○ 经独立命令）',
}

/** ★runGate：执行单个门禁/preset（root = 工程/目录根） */
export async function runGate(id: string, root: string): Promise<GateRunResult> {
  const gate = findGate(id)
  if (!gate) throw new Error(`未知门禁：${id}（proteus gate ls 查看注册表；可用 preset：check / audit）`)
  if (!gate.run) throw new Error(`门禁 ${id} 尚未接线统一执行器——请用其独立命令运行：${gate.usage}`)
  const result = await gate.run(root === '.' ? process.cwd() : path.resolve(root))
  if (typeof result.ok !== 'boolean' || typeof result.text !== 'string') throw new Error(`门禁 ${id} 执行器返回异常`)
  return result
}

/** ★formatGateList：注册表目录（按族分组；--group 过滤） */
export function formatGateList(group?: string): string {
  const lines: string[] = []
  lines.push('[proteus] gate —— 统一门禁注册表（★#453/#454；proteus gate run <id> 执行；scope: project/framework/self）')
  const byGroup = new Map<GateGroup, GateInfo[]>()
  for (const g of GATES) {
    const list = byGroup.get(g.group) ?? []
    list.push(g)
    byGroup.set(g.group, list)
  }
  for (const [grp, gates] of byGroup) {
    if (group && grp !== group) continue
    lines.push(`\n── ${grp}`)
    for (const g of gates) {
      const runnable = g.run ? '●' : '○'
      lines.push(`  ${runnable} ${g.id.padEnd(20)} [${g.scope}] ${g.usage}`)
      lines.push(`      ${g.desc}`)
    }
  }
  const total = GATES.filter((g) => !group || g.group === group).length
  lines.push(`\n[proteus] gate 注册表：${total} 个门禁（● = 已接统一执行器 · ○ = 经 preset/独立命令）——run 支持 preset：check / audit`)
  return lines.join('\n')
}

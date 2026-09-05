// packages/cli/src/gate.ts
// ★#453：统一门禁系统 v1——Gate 注册表（单一来源）+ `proteus gate ls/run`
//   框架方法论落点：仓库三先例（HELP_GROUPS→cli.md / CONFIG_FIELD_LAYERS→配置审计规则 / AUDIT_RULE_IDS→audit 配置）
//   的注册表派生模式——门禁目录不再散落；每门禁一条 { id, 族, scope, usage, desc, run? }。
//   v1 范围：注册表全量登记（与 HELP「检查与门禁」组对照）；run 支持 presets（check/audit 复用既有聚合引擎）
//            + 已收敛出独立 runner 的门禁（d2 / devtools-budget / coverage）。
//   后续批次：聚合引擎（audit-all/check）改为遍历注册表成员、独立命令薄壳化、HELP 组由 GATES 派生、config 开关。
import path from 'node:path'
import { runCheck, formatCheck, type CheckOptions } from './check'
import { runAuditAll, formatAuditAll } from './audit-all'
import { runD2Audit, formatD2Audit, resolveD2Target } from './d2-audit'
import { runDevtoolsBudget, formatDevtoolsBudget } from './devtools-budget'
import { runCoverageAudit } from './coverage-audit'

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
  /** 已收敛的统一执行器（缺省 = 经 preset 或独立命令运行，v1 未接线） */
  run?: (root: string, opts?: Record<string, string>) => Promise<GateRunResult> | GateRunResult
}

/** ★#453 门禁注册表（单一来源——新增门禁在此补录；LS/run/文档派生消费） */
export const GATES: GateInfo[] = [
  // —— 快速聚合（G-33 check——css/style/router/cli+app-config 四/五域） ——
  {
    id: 'check',
    group: '快速聚合',
    scope: 'project',
    usage: 'proteus check [dir] [--no-strict-css|--no-strict-style|--no-strict-router|--no-strict-cli]',
    desc: '★一键全量门禁（G-33 M1）：css:check + style:check + router:check + config:check 四域聚合；任一域失败 → exit 1',
    run: async (root) => {
      const opts: CheckOptions = { strictCss: true, strictStyle: true, strictRouter: true, strictCli: true }
      const summary = await runCheck(path.resolve(root), opts)
      return { ok: summary.ok, text: formatCheck(summary) }
    },
  },
  // —— 深度聚合（audit all 八域——route/module/config/i18n/capabilities/components/d2/devtools-budget） ——
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
  // —— 专项检查（project scope——独立命令形态） ——
  {
    id: 'd2',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus audit d2 [dir]',
    desc: '★D-2 dogfooding 门禁：页面不裸平台 API/手写 @media/引第三方 UI——规则级可配（audit.rules）',
    run: async (root, opts) => {
      // 统一执行器：root = dir 参数语义（省略 dir → 与 `proteus audit d2` 同默认解析）
      const dirArg = root && root !== '.' ? root : undefined
      if (dirArg) {
        const report = await runD2Audit(path.resolve(dirArg))
        return { ok: report.ok, text: formatD2Audit(report) }
      }
      const { scanDir, configFile } = await resolveD2Target(undefined, { cwd: process.cwd() })
      const report = await runD2Audit(scanDir, { configFile })
      return { ok: report.ok, text: formatD2Audit(report) }
    },
  },
  {
    id: 'fluid',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus fluid:check [dir|file]',
    desc: '★柔性布局严格规则（FLD001-006）：禁手写 @media / 硬编码断点 / p-fluid 须 min·max 等（FL 系）',
  },
  {
    id: 'api-check',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus api-check [dir]',
    desc: '★CMP007 门禁：回调式平台 API / 同步存储 / 裸全局能力调用 → 改 useXxx() Hook（平台桥文件豁免）',
  },
  {
    id: 'capabilities',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus capabilities:check [dir]',
    desc: '★平台原生模块规范静态检查（B5 §6 禁止清单：业务目录禁 wx.*/window.*）',
  },
  {
    id: 'capabilities-manifest',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus capabilities:manifest [dir] [--platform <web|skyline|app>]',
    desc: '★扫描 capabilities/*.capability.ts → 能力清单 / 平台缺失报告（B3 编译期分叉）',
  },
  {
    id: 'i18n',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus i18n:check [root] [--catalog <path>]',
    desc: '★i18n 用法检查：硬编码文案检测 + catalog 键对照',
  },
  {
    id: 'router',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus router:check [dir]',
    desc: '校验 <route> 块与集中式 meta（来源登记 + 父路由推导依据）',
  },
  {
    id: 'module',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus module:check [dir] [--graph]',
    desc: '校验 proteus-module.config.ts 模块契约（缺失字段/环/重名/版本冲突）',
  },
  {
    id: 'module-duplicates',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus module:duplicates [distDir]',
    desc: '分包间共享依赖去重检测（读 dist/mp-weixin/app.json 的 subPackages）',
  },
  {
    id: 'css',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus css:check [dir|file] [--no-strict] [--fix] [--report <path>]',
    desc: '★CSS 跨端兼容校验（CSS001-012）+ 预算门禁',
  },
  {
    id: 'style',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus style:check [dir|file] [--platform <web|skyline|ios|android|harmony>]',
    desc: '★样式运行时安全（STS001-006：模板 :style 白名单 + 静态推导覆盖率）',
  },
  {
    id: 'config',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus config:check <proteus.config.ts>',
    desc: '★配置校验：必填字段 + 跨层依赖（CONFIG_LAYER_VIOLATION）+ 版本迁移提示',
  },
  {
    id: 'health',
    group: '专项检查',
    scope: 'project',
    usage: 'proteus health [dir]',
    desc: '★工程/环境健康检查：Node/结构/依赖/产物/appid/pagesDir/workspace 链接/IDE（error 级 exit 1）',
  },
  // —— 框架自检（framework scope——需框架仓语境；devtools-budget 为独立烟测可任意目录） ——
  {
    id: 'coverage',
    group: '框架自检',
    scope: 'framework',
    usage: 'proteus audit coverage',
    desc: '★语义覆盖审计（G-32.1）：能力 100% 覆盖 + catalog↔enum↔tag↔render-map 四向闭环一致性',
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
  },
  {
    id: 'conformance',
    group: '框架自检',
    scope: 'framework',
    usage: 'proteus conformance [--backend <spec>] [--only <C-xx>] [--demo] [--repo <dir>]',
    desc: '★G-38 42 项 conformance（C-01~C-10）+ G-42 仓库治理扫描（fork 检测，CI 阻断）',
  },
]

export type GatePresetId = 'check' | 'audit'

/** 可 run 的门禁（已接线执行器） */
export function findGate(id: string): GateInfo | undefined {
  return GATES.find((g) => g.id === id)
}

/** ★runGate：执行单个门禁/preset（root = 工程/目录根；opts 透传门禁参数——v1 仅位置参数） */
export async function runGate(id: string, root: string): Promise<GateRunResult> {
  const gate = findGate(id)
  if (!gate) throw new Error(`未知门禁：${id}（proteus gate ls 查看注册表；可用 preset：check / audit）`)
  if (!gate.run) throw new Error(`门禁 ${id} 尚未接线统一执行器（v1）——请用其独立命令运行：${gate.usage}`)
  const result = await gate.run(root === '.' ? process.cwd() : root)
  if (typeof result.ok !== 'boolean' || typeof result.text !== 'string') throw new Error(`门禁 ${id} 执行器返回异常`)
  return result
}

/** ★formatGateList：注册表目录（按族分组；--group 过滤） */
export function formatGateList(group?: string): string {
  const lines: string[] = []
  lines.push('[proteus] gate —— 统一门禁注册表（★#453；proteus gate run <id> 执行；scope: project/framework/self）')
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

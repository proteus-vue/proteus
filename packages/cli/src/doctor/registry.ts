// packages/cli/src/doctor/registry.ts —— ★体检检查项注册表（SSOT，对齐 gate.ts 的 GATES 范式）
//
// 【单一来源纪律（对齐 gate.ts）】doctor 的检查项**只在这里登记**——编排（index.ts）、`--list`、
//   注册表自检脚本（scripts/check-doctor-registry.mjs）都从这里派生。新增项在此追加 + 若需新码先登 diag.ts。
//
// 【零逻辑复制】每组的 run 一律调用既有模块（health/host-package/check-deps…），不复制探测逻辑。
import type { DoctorCheck } from './types'
import { ENV_CHECKS } from './checks/env'
import { TOOLCHAIN_CHECKS } from './checks/toolchain'
import { DEPS_CHECKS } from './checks/deps'
import { PROJECT_CHECKS } from './checks/project'
import { PORTS_CHECKS } from './checks/ports'
import { DEVICES_CHECKS } from './checks/devices'

/** §4.8 gates 组：门禁**可运行性**（只验"能不能跑"，不验"跑出来绿不绿"——决策 D3） */
const GATES_CHECKS: DoctorCheck[] = [
  {
    id: 'gates/runnable',
    group: 'gates',
    title: '门禁入口可达',
    level: 'warn',
    // 仅框架仓（有 gate.ts + scripts/check-*）
    appliesTo: (ctx) => ctx.exists('scripts/gate.mjs') || ctx.exists('packages/cli/src/gate.ts'),
    run(ctx) {
      // 抽查：check-deps 的入口脚本存在（代表"注册表引用的脚本可达"这一形态）
      const probe = 'scripts/check-deps.mjs'
      return ctx.exists(probe)
        ? { checkId: 'gates/runnable', level: 'ok', title: '门禁入口可达', actual: `抽查 ${probe} 存在`, evidence: [] }
        : { checkId: 'gates/runnable', level: 'warn', title: '门禁入口不可达', expected: `${probe} 存在`, actual: '不存在', diagCode: 'PT-ER-008', evidence: [{ command: `ls ${probe}`, note: 'ENOENT' }] }
    },
  },
]

/** ★全部检查项（SSOT——顺序即默认呈现顺序：env → toolchain → deps → project → hosts → ports → devices → gates） */
export const CHECKS: DoctorCheck[] = [
  ...ENV_CHECKS,
  ...TOOLCHAIN_CHECKS,
  ...DEPS_CHECKS,
  ...PROJECT_CHECKS,
  // hosts 组由 index.ts 的 projectHosts() 投影生成（不在此列——它是聚合，不是独立探测）
  ...PORTS_CHECKS,
  ...DEVICES_CHECKS,
  ...GATES_CHECKS,
]

/** 组顺序（呈现与并行分波用） */
export const GROUP_ORDER: DoctorCheck['group'][] = ['env', 'toolchain', 'deps', 'project', 'ports', 'devices', 'endpoint', 'gates']


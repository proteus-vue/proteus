// packages/animation/src/conformance.ts
// ★★Morpheus conformance —— **AI 说明书 ↔ 实现/内核的对账**（Morpheus §13 第 11 条后半句）
//
// 【为什么必须有（本仓的核心纪律：判据要落在结果上）】`ANIM_RULES` 是**自描述**——
//   如果没人对账，它就会变成"文档说有一套、实现是另一套"（本仓已多次踩到：
//   README 的曲线名曾写成 `snappy/customBezier`，而实现是 `easeIn/springApprox`）。
//   ⇒ conformance 把"说明书里每条声称的能力"与**真实代码/内核数值**对照，可机器执行。
//
// 【三组断言】
//   A. **完整性**：每条 preset 类规则都能在 `presets` 导出面上找到（名称拼错/预设被删 ⇒ 红）；
//   B. **数值一致性**：说明书里引用的**跨语言契约值**必须与实现一致（弹簧 preset、编号）；
//   C. **可验证性**：每条规则的 `verify` 必须指向**真实存在的检查**（测试文件 / 真机判据脚本），
//      不许写"大概测过"——这是"AI 说明书不得自说自话"的机器保证。
//
// 【诚实边界】本套件不执行真机判据（那需要设备）；它保证的是"说明书与代码同源"。

import { CURVE_ID, ANIM_KIND_ID } from './types'
import type { AnimRule } from './rules'
import { ANIM_RULES } from './rules'
import { easing, presets } from './presets'

/** 一条一致性发现（ok=false 时是必须修的红项） */
export interface ConformanceFinding {
  ruleId: string
  check: 'preset-exists' | 'value-matches' | 'verify-exists'
  ok: boolean
  detail: string
}

/**
 * 预设名 → 在 `presets` 导出面上的实际路径（`preset/route.bottomSheet` → `presets.route.bottomSheet`）。
 * 返回 undefined = 说明书声称存在、但导出面上没有（红）。
 */
export function resolvePreset(id: string): { obj: unknown; path: string } | undefined {
  const m = id.match(/^preset\/(\w+)\.(\w+)$/)
  if (!m) return undefined
  const group = (presets as unknown as Record<string, Record<string, unknown>>)[m[1]]
  if (!group) return undefined
  return { obj: group[m[2]], path: `presets.${m[1]}.${m[2]}` }
}

/** 说明书里引用的**跨语言契约值**（以"期望值"形式写在这里，与实现对照——两侧都改才算过） */
const CONTRACT_VALUES: Record<string, () => { actual: unknown; expected: unknown; what: string }> = {
  'preset/route.cupertinoModal': () => ({
    actual: easing.smooth,
    expected: { stiffness: 180, damping: 26, mass: 1 },
    what: 'cupertinoModal 用 smooth 弹簧（说明书称"与内核 SpringParams::smooth 同值"）',
  }),
  'primitive/AnimKind': () => ({
    actual: { translateX: ANIM_KIND_ID.translateX, translateY: ANIM_KIND_ID.translateY, scale: ANIM_KIND_ID.scale, rotate: ANIM_KIND_ID.rotate, opacity: ANIM_KIND_ID.opacity },
    expected: { translateX: 0, translateY: 1, scale: 2, rotate: 3, opacity: 4 },
    what: 'AnimKind 编号 0..4（与内核 AnimKind 同号——改号会静默错位）',
  }),
  'primitive/Curve': () => ({
    actual: { ...CURVE_ID },
    expected: { linear: 0, easeOut: 1, easeIn: 2, easeInOut: 3, springApprox: 4 },
    what: 'Curve 编号 0..4（与内核 CURVE_* 同号）',
  }),
}

/** 解析 `verify` 字段里引用的**检查位置**（文件路径 / 符号名），供"存在性"断言用 */
export function verifiableRefs(rule: AnimRule): string[] {
  // 抓 `tests/xxx.test.ts`、`hosts/.../xxx.py`、反引号里的符号名
  const refs: string[] = []
  for (const m of rule.verify.matchAll(/[\w./-]+\.(?:test\.ts|py|mjs|rs)/g)) refs.push(m[0])
  for (const m of rule.verify.matchAll(/`([A-Za-z_][\w:.]{4,})`/g)) refs.push(m[1]!)
  return [...new Set(refs)]
}

/**
 * ★运行 conformance（**纯函数**，便于测试与生成器共用）
 *
 * @param exists 文件存在性探测（注入——浏览器/包内环境无 fs；Node 侧传 fs.existsSync 包装）
 */
export function runConformance(
  exists?: (p: string) => boolean,
  rules: readonly AnimRule[] = ANIM_RULES,
): ConformanceFinding[] {
  const out: ConformanceFinding[] = []
  for (const r of rules) {
    // A. preset 类：必须在导出面上真实存在
    if (r.kind === 'preset' && r.id.startsWith('preset/')) {
      const hit = resolvePreset(r.id)
      const ok = hit !== undefined && typeof hit.obj === 'function'
      // ★文案必须与事实一致（本仓纪律）：路径能解析 ≠ 该项存在——
      //   首版写成 `${hit.path} 存在` 而实际 obj 是 undefined（破坏性验证当场读出这句自相矛盾的话）。
      out.push({
        ruleId: r.id,
        check: 'preset-exists',
        ok,
        detail: ok
          ? `${hit!.path} 是函数（可用）`
          : hit
            ? `${hit.path} 路径可解析但**不是函数**（预设被删 / 改名）`
            : '说明书声称的预设不在 presets 导出面上（名称拼错 / 预设被删）',
      })
    }
    // B. 契约值对照（有登记的才查）
    const c = CONTRACT_VALUES[r.id]
    if (c) {
      const { actual, expected, what } = c()
      const ok = JSON.stringify(actual) === JSON.stringify(expected)
      out.push({ ruleId: r.id, check: 'value-matches', ok, detail: `${what}：实际 ${JSON.stringify(actual)}` })
    }
    // C. verify 的可追溯性：必须提到至少一处检查（文件或符号）
    //
    // ★boundary 类的例外（**如实设计，不是放水**）：`planned` / `limitation` 的条目**本就没有**
    //   可跑的检查（那是"未做/不做"的如实记录）⇒ 允许只指向文档（README「未做」一节）。
    //   但 implemented 的条目**必须**有可执行的检查——否则说明书就是自说自话。
    const refs = verifiableRefs(r)
    const isDocOnlyAllowed = r.kind === 'boundary' && r.status !== 'implemented'
    if (isDocOnlyAllowed) {
      out.push({
        ruleId: r.id,
        check: 'verify-exists',
        ok: r.verify.trim().length > 0,
        detail: `boundary(${r.status}) ⇒ 允许指向文档：${r.verify.slice(0, 40)}`,
      })
    } else {
      out.push({
        ruleId: r.id,
        check: 'verify-exists',
        ok: refs.length > 0,
        detail: refs.length > 0 ? `可追溯：${refs.slice(0, 2).join(' · ')}` : '`verify` 未指向任何具体检查（不许"大概测过"）',
      })
    }
    // C2. 若注入了文件存在性探测，则 verifiableRefs 里的**文件**必须真实存在
    if (exists) {
      for (const ref of refs) {
        if (!/\.(test\.ts|py|mjs|rs)$/.test(ref)) continue
        out.push({
          ruleId: r.id,
          check: 'verify-exists',
          ok: exists(ref),
          detail: exists(ref) ? `${ref} 存在` : `verify 引用的检查不存在：${ref}`,
        })
      }
    }
  }
  return out
}

/** 汇总（供门禁/生成器：ok=false 的项会被打印出来） */
export function conformanceSummary(findings: readonly ConformanceFinding[]): { ok: boolean; failures: ConformanceFinding[] } {
  const failures = findings.filter((f) => !f.ok)
  return { ok: failures.length === 0, failures }
}

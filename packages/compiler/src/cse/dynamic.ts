// packages/compiler/src/cse/dynamic.ts
// ★★★G-61 B2（2026-10-05）：**动态 `:class` 预计算**（Profile §5 / plan B2）——生成端
//
// 【它解决什么】`:class="{ on: x }"` 的样式此前要么运行期线性匹配（旧 `resolveDynamicClasses`，
//   O(规则数)/次 + 无回退语义），要么把布局字段判为"不支持"（`VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED`）。
//   本模块在**编译期**把动态类的样式影响**按属性维度分解**成小查找表（非 2ⁿ 枚举）：
//
//   Profile §5.2 算法（本实现逐条对应）：
//     1. 收集节点上所有**可能生效**的动态类集合 D —— `enumerateDynamicClassCandidates`（表达式静态枚举）
//     2. 对每个 CSS 属性 p：找 D 中影响 p 的子集 Dp（= 声明了 p 的、被动态类门控的规则里的候选类）
//        枚举 Dp 各组合 ⇒ 用 **B1 CSE**（computeTree）算出该属性在该组合下的**最终值**（含层叠/继承）
//        取值唯一 ⇒ 不进表（零成本）；取值多 ⇒ 生成 `DynamicClassLookup`
//     3. 运行期：`applyDynamicClassPlan`（slot-runtime/dynamic-class.ts）位图查表
//
// 【互斥分组（§5.3）】保守的**可证明**识别（不猜）：
//   · `{ a: v === 'x', b: v === 'y' }`——同源标识符 + 不同字面量 ⇒ a/b 互斥
//   · `cond ? 'a' : 'b'`（数组元素/对象值/直接绑定）——三元两分支互斥（含嵌套链）
//   其余形态不做互斥推断（宁可表大一点，不冒"错误压缩"的风险）。压缩仅在**某字段的影响位全部落于单个互斥组**
//   时启用（group 表：k 个互斥类 k+1 项）。
//
// 【爆炸保护（§5.4）】
//   · 无法静态枚举（`:class="runtimeVar"` 等）⇒ **`E-CSS-004` error**（Profile 的 L5 禁止项）
//   · 单节点表数 > 16 ⇒ warn `CSE_DYNCLASS_TABLE_EXPLOSION`
//   · 单表取值数 > 8 ⇒ warn `CSE_DYNCLASS_VALUE_EXPLOSION`
//   · 候选类 > 32（位图上限）⇒ error `CSE_DYNCLASS_BITMAP_OVERFLOW`
//   · 规则含**后代/子组合**且其中出现候选类（如 `.on .child`）⇒ warn `CSE_DYNCLASS_DESCENDANT_UNSUPPORTED`
//     （如实：本表只覆盖"该类作用在**本节点**"的情形；祖先位动态类影响后代的情形不在 B2 v1）
//
// 【诚实边界（v1）】
//   · 只处理**自匹配纯类规则**（单段、类、无 tag/id/伪类——与旧投影同口径；这类规则的效果
//     只取决于"本节点有哪些类"，运行期可精确复现）
//   · 值计算用 computeTree（整树）逐组合重算——正确性优先；组合数由 Dp 控制（通常 ≤ 2-3）
//   · `stats.combos` = Σ 2^|Dfield|（未压缩口径，供爆炸可视化）

import { parse as babelParse } from '@babel/parser'
import type { CseNode, CseStyleSheet } from './types'

/**
 * ★最小 AST 形状（**不引 @babel/types 依赖**——本仓既有 `style-object.ts` 同款做法：
 *   `@babel/parser` 自述 @babel/types 只是类型定义、非运行期依赖；引它只为类型不值当）。
 *   只声明本模块**实际读到**的节点面（保守：读不到的形态一律按"不可枚举"拒绝）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AstNode = any
/** 表达式节点（本模块处理的都是"表达式位置"的 AST 节点） */
type ClassExpression = AstNode
type ClassObjectExpression = AstNode
type ClassArrayExpression = AstNode
type ClassLogicalExpression = AstNode
type ClassConditionalExpression = AstNode
type ClassMemberExpression = AstNode
import { computeTree } from './compute'
import type { DynamicClassLookup, DynamicClassPlan } from '@proteus-vue/slot-runtime'

/* ────────────────────────── 候选类枚举（babel AST） ────────────────────────── */

export interface EnumerateResult {
  ok: boolean
  /** 候选类（**首次出现序**——位序稳定，产物可复现） */
  classes: string[]
  /** 互斥组（每项 = classes 的位索引列表；可证明者才收录） */
  mutexGroups: number[][]
  /** 不可枚举的原因（ok=false 时给） */
  reason?: string
}

/** 从 AST 节点取"源码文本"（互斥判定的同源比较用） */
function srcOf(node: { start?: number | null; end?: number | null }, src: string): string | null {
  if (node.start == null || node.end == null) return null
  return src.slice(node.start, node.end)
}

/** 表达式内的字面量字符串（StringLiteral / 无表达式模板串）；不是 ⇒ null */
function literalOf(node: ClassExpression | null | undefined): string | null {
  if (!node) return null
  if (node.type === 'StringLiteral') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((q: { value: { cooked?: string | null; raw: string } }) => q.value.cooked ?? q.value.raw).join('')
  }
  return null
}

/**
 * 静态枚举 `:class` 绑定的**候选类名**（Profile §5.4：无法枚举 ⇒ E-CSS-004）。
 *
 * 支持形态（保守——只认能**证明**候选集的写法）：
 *   · 字符串字面量 `'a b'`（空白切分）
 *   · 对象字面量 `{ a: expr, 'b': expr }`（键 = 候选；**不要求** expr 可静态求值——只枚举"可能出现的类"）
 *   · 数组字面量 `['a', { b: x }, cond ? 'c' : 'd']`（递归）
 *   · 三元 `cond ? 'a' : 'b'`（两分支都进候选；链式 `a ? x : b ? y : z` 全部收集）
 *   · 逻辑 `x && 'a'` / `x || 'b'`（两侧都进候选——过近似安全）
 * 其余（标识符/成员访问/函数调用/计算键/展开等）⇒ **不可枚举**（报 E-CSS-004，不猜）。
 */
export function enumerateDynamicClassCandidates(expr: string): EnumerateResult {
  let ast: ClassExpression | null = null
  try {
    // ★包一层括号让任意表达式都能作为语句解析；`parse` 返回 **File** ⇒ 取 `program.body[0].expression`
    //   （与既有 `vapor/style-object.ts` 同款解包——本仓实测踩过"忘了解包 ⇒ 拿到 File"）
    const file = babelParse(`(${expr})`, { sourceType: 'module', plugins: ['typescript'] }) as unknown as {
      program?: { body?: Array<{ expression?: ClassExpression }> }
    }
    ast = file?.program?.body?.[0]?.expression ?? null
    if (!ast) throw new Error('解析结果不是表达式')
  } catch (e) {
    return { ok: false, classes: [], mutexGroups: [], reason: `表达式解析失败：${(e as Error).message.slice(0, 120)}` }
  }
  const classes: string[] = []
  const index = new Map<string, number>()
  const mutexGroups: number[][] = []
  let bad: string | null = null

  const add = (name: string): number => {
    const i = index.get(name)
    if (i !== undefined) return i
    index.set(name, classes.length)
    classes.push(name)
    return classes.length - 1
  }

  /** 处理"候选位置"的表达式（对象键 / 字符串 / 三元 / 数组 / 逻辑） */
  const walk = (node: ClassExpression | null | undefined): void => {
    if (!node || bad) return
    if (node.type === 'StringLiteral') {
      for (const c of node.value.split(/\s+/).filter(Boolean)) add(c)
      return
    }
    if (node.type === 'TemplateLiteral') {
      // 无表达式 ⇒ 字面量；有表达式 ⇒ 不可枚举（候选可能由插值拼出）
      if (node.expressions.length === 0) {
        for (const c of node.quasis.map((q: { value: { cooked?: string | null } }) => q.value.cooked ?? '').join('').split(/\s+/).filter(Boolean)) add(c)
      } else {
        bad = '模板串含插值（类名可能由运行期拼接）'
      }
      return
    }
    if (node.type === 'ConditionalExpression') {
      // 三元两分支互斥（若都可枚举为字符串字面量）
      const before = classes.length
      walkTernaryBranch(node)
      void before
      return
    }
    if (node.type === 'ArrayExpression') {
      for (const el of (node as ClassArrayExpression).elements) {
        if (!el) continue // 稀疏数组洞
        if (el.type === 'SpreadElement') {
          bad = '数组含展开（...）（候选集不可静态枚举）'
          return
        }
        walk(el as ClassExpression)
      }
      return
    }
    if (node.type === 'ObjectExpression') {
      for (const p of (node as ClassObjectExpression).properties) {
        if (p.type === 'SpreadElement' || p.computed) {
          bad = p.computed ? '对象含计算键（[k]）（类名不可静态枚举）' : '对象含展开（...）'
          return
        }
        const keyNode = p.key
        let name: string | null = null
        if (keyNode.type === 'StringLiteral') name = keyNode.value
        else if (keyNode.type === 'Identifier') name = keyNode.name
        else if (keyNode.type === 'NumericLiteral') name = String(keyNode.value)
        if (!name) {
          bad = '对象键形态不支持（非字符串/标识符/数字字面量）'
          return
        }
        for (const c of name.split(/\s+/).filter(Boolean)) add(c)
      }
      // ★互斥：同源标识符 + 不同字面量（`{ a: v === 'x', b: v === 'y' }`）
      detectMutexByIdentity(node as ClassObjectExpression, srcOf, expr, add, mutexGroups)
      return
    }
    if (node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||' || node.operator === '??')) {
      // ★语义（Vue :class 的值语义决定）：
      //   `x && 'z'` ⇒ 左是**条件**（falsy ⇒ 无类；truthy ⇒ 值是右）⇒ 只走右
      //   `x || 'z'` / `x ?? 'z'` ⇒ 左 truthy/非空时**左值就是绑定值** ⇒ 左右都走（左若是标识符 ⇒ 如实拒绝）
      //   链式 `a && b && 'z'`：外层左 = `a && b`（条件链）⇒ 只走右即覆盖
      if (node.operator === '&&') {
        walk((node as ClassLogicalExpression).right as ClassExpression)
      } else {
        walk((node as ClassLogicalExpression).left as ClassExpression)
        walk((node as ClassLogicalExpression).right as ClassExpression)
      }
      return
    }
    // 标识符 / 成员 / 调用 / 条件对象… 均不可枚举
    bad = `表达式形态不可静态枚举（${node.type}）——改用对象语法 { active: bool } 或字面量/三元的静态候选`
  }

  /** 三元分支处理（含链式）；分支为字面量时收进同一互斥组 */
  const walkTernaryBranch = (node: ClassConditionalExpression): void => {
    const group: number[] = []
    const collect = (n: ClassExpression): void => {
      if (n.type === 'ConditionalExpression') {
        collect(n.consequent as ClassExpression)
        collect(n.alternate as ClassExpression)
        return
      }
      const lit = literalOf(n)
      if (lit !== null) {
        for (const c of lit.split(/\s+/).filter(Boolean)) group.push(add(c))
        return
      }
      // 非字面量分支 ⇒ 递归（可能是对象/数组）
      const before = classes.length
      walk(n)
      if (bad) return
      // walk 收进来的新类无法证明互斥（可能同时出现）⇒ 不进互斥组；组里已有的保持
      void before
    }
    collect(node.consequent as ClassExpression)
    collect(node.alternate as ClassExpression)
    if (group.length >= 2) mutexGroups.push([...new Set(group)])
  }

  walk(ast)
  if (bad) return { ok: false, classes: [], mutexGroups: [], reason: bad }
  if (classes.length === 0) return { ok: false, classes: [], mutexGroups: [], reason: '候选类为空（该 :class 不会产生任何类名）' }
  return { ok: true, classes, mutexGroups }
}

/** 互斥识别：对象属性值形如 `X === 'lit'`（同 X、不同 lit）⇒ 对应键互斥 */
function detectMutexByIdentity(
  obj: ClassObjectExpression,
  srcOf: (n: { start?: number | null; end?: number | null }, src: string) => string | null,
  src: string,
  add: (name: string) => number,
  mutexGroups: number[][],
): void {
  const bySource = new Map<string, Array<{ literal: string; bit: number }>>()
  for (const p of obj.properties) {
    if (p.type === 'SpreadElement') continue
    const cond = p.value
    if (cond.type !== 'BinaryExpression' || (cond.operator !== '===' && cond.operator !== '==')) continue
    const left = cond.left
    const right = cond.right
    const leftSrc = srcOf(left as ClassMemberExpression, src)
    const lit = literalOf(right as ClassExpression)
    if (!leftSrc || lit === null) continue
    const keyNode = p.key
    const name =
      keyNode.type === 'StringLiteral' ? keyNode.value : keyNode.type === 'Identifier' ? keyNode.name : null
    if (!name) continue
    const bit = add(name.split(/\s+/)[0]!)
    const arr = bySource.get(leftSrc)
    if (arr) arr.push({ literal: lit, bit })
    else bySource.set(leftSrc, [{ literal: lit, bit }])
  }
  for (const entries of bySource.values()) {
    if (entries.length < 2) continue
    // 同源比较、不同字面量 ⇒ 互斥
    const lits = new Set(entries.map((e) => e.literal))
    if (lits.size !== entries.length) continue // 有重复字面量 ⇒ 不能证明互斥（同一字面量可能都真）
    const bits = [...new Set(entries.map((e) => e.bit))]
    if (bits.length >= 2) mutexGroups.push(bits)
  }
}

/* ────────────────────────── 计划生成（属性维度分解） ────────────────────────── */

export interface DynamicPlanDiagnostic {
  level: 'error' | 'warn'
  code: string
  message: string
  hint?: string
}

export interface BuildDynamicPlansOptions {
  /** 视口（与 CSE 计算一致；默认 390×844） */
  viewport?: { width: number; height: number }
  rootFontSize?: number
  /** inline style（节点 key → 长手声明；与 CSE 一致） */
  inlineStyles?: Record<string, Array<{ prop: string; value: string }>>
  /** 表数阈值（默认 16；超 ⇒ warn） */
  maxTablesPerNode?: number
  /** 单表取值数阈值（默认 8；超 ⇒ warn） */
  maxValuesPerTable?: number
}

export interface BuildDynamicPlansResult {
  /** 节点 key → 计划（无动态影响字段的节点不进表——零成本） */
  plans: Record<string, DynamicClassPlan>
  diagnostics: DynamicPlanDiagnostic[]
}

/** 自匹配纯类规则（B2 只处理这类；见头注诚实边界） */
interface SelfClassRule {
  bits: number[] // 该规则要求的候选类位（可能空——纯静态类规则，不构成动态门控）
  staticClasses: string[] // 规则要求的、非候选的静态类
  /** 该规则的 CSS 属性 → 是否 important（仅记录；值由 CSE 层叠算，无需这里排） */
  props: string[]
}

/** 该规则是否是"纯类单段"（无 combinator / tag / id / 伪类 / 通配 / :not） */
function selfClassRuleOf(rule: CseStyleSheet['rules'][number]): { classes: string[] } | null {
  if (rule.chain.combinators.length !== 0) return null
  const seg = rule.chain.segments[0]
  if (!seg) return null
  if (seg.tag || seg.id || seg.pseudo || seg.not || seg.universal || seg.root) return null
  if (seg.classes.length === 0) return null
  return { classes: seg.classes }
}

/** 生成端主函数：SFC 提取的 roots/sheet + 各节点的 `:class` 绑定表达式 → 逐节点计划 */
export function buildDynamicClassPlans(
  roots: CseNode[],
  sheet: CseStyleSheet,
  classBindings: Record<string, string>,
  opts: BuildDynamicPlansOptions = {},
): BuildDynamicPlansResult {
  const maxTables = opts.maxTablesPerNode ?? 16
  const maxValues = opts.maxValuesPerTable ?? 8
  const diagnostics: DynamicPlanDiagnostic[] = []
  const plans: Record<string, DynamicClassPlan> = {}

  // 节点索引（key → node + 祖先链静态类集不参与——computeTree 自己走）
  const nodeByKey = new Map<string, CseNode>()
  const collect = (n: CseNode): void => {
    nodeByKey.set(n.key, n)
    for (const c of n.children) collect(c)
  }
  for (const r of roots) collect(r)

  // 全表规则预筛：纯类单段（其余形态与"动态类作用在本节点"无关）
  const selfRules: Array<{ classes: string[]; props: string[] }> = []
  for (const rule of sheet.rules) {
    const cls = selfClassRuleOf(rule)
    if (!cls) continue
    selfRules.push({ classes: cls.classes, props: rule.decls.map((d) => d.prop) })
  }

  const computeOpts = {
    ...(opts.viewport ? { viewport: opts.viewport } : {}),
    ...(opts.rootFontSize !== undefined ? { rootFontSize: opts.rootFontSize } : {}),
    ...(opts.inlineStyles ? { inlineStyles: opts.inlineStyles } : {}),
  }

  for (const [key, expr] of Object.entries(classBindings)) {
    const node = nodeByKey.get(key)
    if (!node) continue
    const en = enumerateDynamicClassCandidates(expr)
    if (!en.ok) {
      diagnostics.push({
        level: 'error',
        code: 'E-CSS-004',
        message: `${key}（:class="${expr.slice(0, 60)}"）无法编译期枚举候选类：${en.reason}`,
        hint: '改用对象语法 `:class="{ active: bool, done: bool }"`（键即时类名）或字面量/三元',
      })
      continue
    }
    if (en.classes.length > 32) {
      diagnostics.push({
        level: 'error',
        code: 'CSE_DYNCLASS_BITMAP_OVERFLOW',
        message: `${key}: 候选类 ${en.classes.length} 个 > 32（位图上限）`,
        hint: '拆分组件/减少单节点动态类维度，或改用互斥组形态（ternary / v===L）',
      })
      continue
    }
    const staticClasses = new Set(node.classes)
    const bitOf = new Map<string, number>()
    en.classes.forEach((c, i) => bitOf.set(c, i))

    // 适用的动态门控规则：规则类里的候选（动态位）+ 其余类必须在节点静态类上
    const applicable: SelfClassRule[] = []
    for (const r of selfRules) {
      const dynBits: number[] = []
      let ok = true
      for (const c of r.classes) {
        const b = bitOf.get(c)
        if (b !== undefined) dynBits.push(b)
        else if (!staticClasses.has(c)) {
          ok = false
          break
        }
      }
      if (!ok || dynBits.length === 0) continue
      applicable.push({ bits: dynBits, staticClasses: [], props: r.props })
    }
    if (applicable.length === 0) continue // 动态类不影响任何自匹配纯类规则 ⇒ 零表

    // 属性维度分解：CSS 属性 → 动态位集（Dp）
    const propBits = new Map<string, Set<number>>()
    for (const r of applicable) {
      for (const p of r.props) {
        let s = propBits.get(p)
        if (!s) {
          s = new Set<number>()
          propBits.set(p, s)
        }
        for (const b of r.bits) s.add(b)
      }
    }

    // CSS 属性 → IR 字段（一个属性可能映射多个候选字段（如 overflow 合并 / 圆角合并）——
    //   v2 简化：字段候选名单，值取"该属性相关字段"的并集；表按字段聚合）
    /** 字段 → 影响位集（Dfield） */
    const fieldBits = new Map<string, Set<number>>()
    for (const [prop, bits] of propBits) {
      for (const f of irFieldCandidatesOf(prop)) {
        let s = fieldBits.get(f)
        if (!s) {
          s = new Set<number>()
          fieldBits.set(f, s)
        }
        for (const b of bits) s.add(b)
      }
    }

    // 基线（位图 0：静态类）——含继承上下文
    const baselineFields = computeWithClasses(roots, sheet, node, [], computeOpts)

    const tables: Record<string, DynamicClassLookup> = {}
    let combos = 0
    let maxValuesSeen = 0
    let compressed: { before: number; after: number } | undefined

    for (const [field, bitsSet] of fieldBits) {
      const bits = [...bitsSet].sort((a, b) => a - b)
      if (bits.length === 0) continue
      const mask = bits.reduce((m, b) => m | (1 << b), 0) >>> 0
      const nStates = 1 << bits.length
      combos += nStates

      // 该字段的影响位是否全落在**单个**互斥组内 ⇒ 用组表（k+1 项）
      const group = en.mutexGroups.find((g) => bits.every((b) => g.includes(b)))
      let lookup: DynamicClassLookup
      if (group) {
        // 组内 index 序 = `en.mutexGroups` 里的**组内序号**（运行期 groupStateOf 同口径）
        const groupIdx = en.mutexGroups.indexOf(group)
        const values: unknown[] = []
        // state 0 = 组内无影响位活跃 ⇒ 基线
        values.push(baselineFields[field])
        for (const member of group) {
          if (bits.includes(member)) {
            values.push(computeWithClasses(roots, sheet, node, [en.classes[member]!], computeOpts)[field])
          } else {
            // 组内非影响位：激活它不改该字段（按定义）⇒ 基线
            values.push(baselineFields[field])
          }
        }
        lookup = { kind: 'group', group: groupIdx, values }
        // 压缩口径：未压缩（该字段的影响位全枚举）= 2^|bits|；压缩后 = 组内 k+1
        const before = nStates
        const after = values.length
        if (!compressed || before > compressed.before) compressed = { before, after }
      } else {
        // ★稠密化（关键）：masked bitmap 含高位（位 i 可能 = 7），直接当数组下标会开 2^32 的洞。
        //   ⇒ 生成 `map: { maskedValue → denseIndex }`，运行期 O(1) 两跳（一次位与 + 一次字典查 + 一次数组索引）。
        const map: Record<number, number> = {}
        const values: unknown[] = []
        for (let i = 0; i < nStates; i++) {
          const active: string[] = []
          let masked = 0
          for (let j = 0; j < bits.length; j++) {
            if ((i & (1 << j)) !== 0) {
              active.push(en.classes[bits[j]!]!)
              masked |= (1 << bits[j]!) >>> 0
            }
          }
          map[masked] = values.length
          values.push(computeWithClasses(roots, sheet, node, active, computeOpts)[field])
        }
        lookup = { kind: 'bits', mask, map, values }
      }
      tables[field] = lookup
      maxValuesSeen = Math.max(maxValuesSeen, lookup.values.length)
    }

    if (Object.keys(tables).length === 0) continue

    // 爆炸保护（§5.4）
    if (Object.keys(tables).length > maxTables) {
      diagnostics.push({
        level: 'warn',
        code: 'CSE_DYNCLASS_TABLE_EXPLOSION',
        message: `${key}: 动态字段表 ${Object.keys(tables).length} 个 > ${maxTables}（建议拆分组件）`,
        hint: '把动态类用于状态色/字体等少数绘制属性；大量动态布局属性改静态类或 :style 数值绑定',
      })
    }
    if (maxValuesSeen > maxValues) {
      diagnostics.push({
        level: 'warn',
        code: 'CSE_DYNCLASS_VALUE_EXPLOSION',
        message: `${key}: 单表最大取值 ${maxValuesSeen} > ${maxValues}（动态类维度过多）`,
        hint: '用互斥组形态（`v === "x"` / 三元）减少状态数，或拆分组件',
      })
    }

    const plan: DynamicClassPlan = {
      classes: en.classes,
      tables,
      ...(en.mutexGroups.length > 0 ? { mutexGroups: en.mutexGroups } : {}),
      stats: {
        dynamicProps: Object.keys(tables).length,
        maxValues: maxValuesSeen,
        combos,
        ...(compressed ? { compressed } : {}),
      },
    }
    plans[key] = plan
  }

  // 后代/子组合规则引用候选类 ⇒ 如实提示（本表不覆盖该情形）
  for (const [key, expr] of Object.entries(classBindings)) {
    const en = enumerateDynamicClassCandidates(expr)
    if (!en.ok) continue
    const cand = new Set(en.classes)
    for (const rule of sheet.rules) {
      if (rule.chain.combinators.length === 0) continue
      // 非末尾段含候选类
      const segs = rule.chain.segments
      for (let i = 0; i < segs.length - 1; i++) {
        if (segs[i]!.classes.some((c) => cand.has(c))) {
          diagnostics.push({
            level: 'warn',
            code: 'CSE_DYNCLASS_DESCENDANT_UNSUPPORTED',
            message: `${key}: 规则 \`${rule.chain.raw}\` 的**祖先段**含动态类——该类激活时会改变**后代**样式，B2 v1 表只覆盖本节点字段`,
            hint: '祖先位动态类（如 `.on .child`）暂不支持：改用状态类挂到受影响节点自身',
          })
          break
        }
      }
    }
    void key
  }

  return { plans, diagnostics }
}

/** 用指定"额外激活类"重算该节点字段（临时改 node.classes——单线程编译期安全；算完恢复） */
function computeWithClasses(
  roots: CseNode[],
  sheet: CseStyleSheet,
  node: CseNode,
  extraClasses: string[],
  opts: { viewport?: { width: number; height: number }; rootFontSize?: number; inlineStyles?: Record<string, Array<{ prop: string; value: string }>> },
): Record<string, unknown> {
  const saved = node.classes
  node.classes = extraClasses.length > 0 ? [...saved, ...extraClasses] : saved
  try {
    const result = computeTree(roots, sheet, opts)
    return result.byKey[node.key]?.fields ?? {}
  } finally {
    node.classes = saved
  }
}

/** CSS 长手 → 可能承载它的 IR 字段候选（与 compute.ts 的 mapToIrField 对齐；保守列全部可能） */
function irFieldCandidatesOf(prop: string): string[] {
  const direct: Record<string, string> = {
    opacity: 'opacity',
    'flex-grow': 'flexGrow',
    'flex-shrink': 'flexShrink',
    'letter-spacing': 'letterSpacing',
    display: 'display',
    position: 'position',
    visibility: 'visibility',
    'text-align': 'textAlign',
    'text-overflow': 'textOverflow',
    'text-decoration-line': 'textDecoration',
    'flex-direction': 'flexDirection',
    'flex-wrap': 'flexWrap',
    'justify-content': 'justifyContent',
    'align-items': 'alignItems',
    'align-content': 'alignContent',
    'align-self': 'alignSelf',
    // ★★★justify-self 项（2026-10-06）：网格项行内轴自对齐（动态类字段候选——与 compute.ts 对齐）
    'justify-self': 'justifySelf',
    'box-sizing': 'boxSizing',
    'pointer-events': 'pointerEvents',
    'white-space': 'whiteSpace',
    width: 'width',
    height: 'height',
    'min-width': 'minWidth',
    'max-width': 'maxWidth',
    'min-height': 'minHeight',
    'max-height': 'maxHeight',
    'margin-top': 'marginTop',
    'margin-right': 'marginRight',
    'margin-bottom': 'marginBottom',
    'margin-left': 'marginLeft',
    'padding-top': 'paddingTop',
    'padding-right': 'paddingRight',
    'padding-bottom': 'paddingBottom',
    'padding-left': 'paddingLeft',
    top: 'top',
    right: 'right',
    bottom: 'bottom',
    left: 'left',
    'row-gap': 'rowGap',
    'column-gap': 'columnGap',
    color: 'color',
    'background-color': 'backgroundColor',
    'border-top-color': 'borderTopColor',
    'border-right-color': 'borderRightColor',
    'border-bottom-color': 'borderBottomColor',
    'border-left-color': 'borderLeftColor',
    'font-size': 'fontSize',
    'font-weight': 'fontWeight',
    'line-height': 'lineHeight',
    'font-family': 'fontFamily',
    'flex-basis': 'flexBasis',
    'border-top-width': 'borderTopWidth',
    'border-right-width': 'borderRightWidth',
    'border-bottom-width': 'borderBottomWidth',
    'border-left-width': 'borderLeftWidth',
    'aspect-ratio': 'aspectRatio',
  }
  const f = direct[prop]
  if (f) return [f]
  if (prop === 'overflow-x' || prop === 'overflow-y') return ['overflow']
  if (/^border-(top-left|top-right|bottom-right|bottom-left)-radius$/.test(prop)) return ['borderRadius', 'borderRadiusCorners', 'borderRadiusPct']
  return []
}

/* ────────────────────────── 计划 → 运行期 nodeId 映射（带校验） ────────────────────────── */

/**
 * ★★★B2 集成：把计划（键 = CSE 节点 key，路径形态）映射到**运行期 nodeId**（数字，模板 DFS 序）。
 *
 * 【为什么需要（两套 id 体系）】CSE 提取的 key 是**路径**（`"0.1"`）；模板/订阅表用**DFS 序号**
 *   （`0,1,2…`）。二者同源（同一棵元素树的前序），但格式不同 ⇒ 必须显式映射。
 *
 * 【★校验纪律（宁可不出表，不可错配）】逐位置比对 **tag**（数量也必须相等）——任一处不符即
 *   **返回 null 形态**（reason 非空），调用方记诊断。理由：错配会让"某节点的动态类"落到别的节点上
 *   ——静默错样式，比"不支持"危险得多（本仓纪律：拿不准一律否）。
 */
export function mapPlansToTemplateNodes(
  roots: CseNode[],
  plans: Record<string, DynamicClassPlan>,
  templateNodes: Array<{ id: number; tag: string }>,
): { byNodeId: Record<string, DynamicClassPlan>; reason?: string } {
  const cseByKey = new Map<string, CseNode>()
  const order: string[] = []
  const walk = (n: CseNode): void => {
    cseByKey.set(n.key, n)
    order.push(n.key)
    for (const c of n.children) walk(c)
  }
  for (const r of roots) walk(r)
  if (order.length !== templateNodes.length) {
    return { byNodeId: {}, reason: `元素数不一致（CSE ${order.length} vs 模板 ${templateNodes.length}）` }
  }
  for (let i = 0; i < order.length; i++) {
    const cseNode = cseByKey.get(order[i]!)!
    const tplNode = templateNodes[i]!
    if (cseNode.tag.toLowerCase() !== tplNode.tag.toLowerCase()) {
      return { byNodeId: {}, reason: `第 ${i} 位元素不同（CSE \`${cseNode.tag}\` vs 模板 \`${tplNode.tag}\`）` }
    }
  }
  const byNodeId: Record<string, DynamicClassPlan> = {}
  for (let i = 0; i < order.length; i++) {
    const plan = plans[order[i]!]
    if (plan) byNodeId[String(templateNodes[i]!.id)] = plan
  }
  return { byNodeId }
}

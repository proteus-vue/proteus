// packages/compiler/src/gap-counter.ts
// ★★卡 C4：**编译期漏点计数器**（`Proteus_实战采集埋点清单` §2 的落地）
//
// 【卡要什么】「编译流水线加**漏点计数器**（记录不阻断）」+ 三条验收：
//   ① 三类（fallback / degraded / unsupported）分别统计
//   ② **degraded 类单独高亮**（行为可能不一致，不报错，最难查——清单 §2.5 明说"必须"）
//   ③ 产出"表达不了"清单
//
// 【为什么不能靠"猜字符串"（本仓纪律）】
//   编译器已有 **50 处诊断点**（`ctx.warnings.push(...)`）与 **64 条结构化规则 ID**
//   （`ctx.trace.add('directive/v-html', …)`）。若计数器自己写一份"哪些写法算漏点"的表，
//   就是**第 N 份手写副本**（必随编译器改动静默过期）。
//   ⇒ 正解：计数器**不判断"是不是漏点"**（那由既有诊断决定），只做两件事：
//     · 从既有诊断**归纳**（按规则 ID / 关键词 → severity 分类）
//     · **计数 + 汇总 + 报告**（三类分列，degraded 单独高亮）
//
// 【severity 三类的判据（按后果分，不按写法分）】
//   · `degraded`  —— **行为可能不一致**：功能在，但**语义/外观与 Web 不同**（端对齐问题来源）
//     特征词：不可用 / 恒不可用 / 不渲染 / 不生效 / 不一致 / 失效 / 丢失 / 无 scoped / 已忽略
//   · `fallback`  —— **功能可用但路径退化**（性能或能力降档，语义仍对）
//     特征词：回退 / 剥离 / 降级 / 已跳过 / 原样输出 / 转义 / 按普通…渲染
//   · `unsupported` —— **编译期阻断**（真正无法表达；`rules.failFast` 开启时抛错的那批）
//     来源：`failFastThrow` 调用点（本仓已有该机制，见 template.ts）
//
//   ★判定顺序：unsupported（有硬证据：failFast）→ degraded → fallback → 未归类。
//   ★**未归类的必须显式列出来**（不能静默丢掉）——否则"计数器说 0 漏点"可能只是分类表没覆盖。
//
// 【不阻断（清单 §2.1 明确要求）】本模块**只收集**，从不抛错、从不改产物。

/** 漏点类别（与埋点清单 §2.2 的 `PrimitiveGapRecord.severity` 同名同义） */
export type GapSeverity = 'fallback' | 'degraded' | 'unsupported'

/** 一条漏点记录（字段对齐埋点清单 §2.2；`line` 在本仓诊断里多数拿不到 ⇒ 可选） */
export interface PrimitiveGapRecord {
  /** 源文件 */
  file: string
  /** 行号（诊断文本未携带行号时为 undefined——不伪造） */
  line?: number
  /** 具体写法（原始诊断文本，未脱敏——本仓诊断本身即为可读中文，不含用户数据） */
  construct: string
  /** 归类：由规则 ID / 关键词归纳（见文件头） */
  category: string
  severity: GapSeverity
  /** 命中的规则 ID（若有——比关键词更可靠，来自 trace） */
  ruleId?: string
  /** 若可映射到近似原语 */
  suggestedPrimitive?: string
}

/**
 * 归类规则表（★每次修改都要问：这条规则是在**归纳既有诊断**，还是在**新增判断**？
 *   后者应当改编译器诊断本身，而不是往这张表里加——否则又多一份"漏点定义"的副本）。
 *
 * `match` 按顺序尝试：**规则 ID 优先**（结构化，来自 trace）→ 关键词（诊断文本特征）。
 */
interface ClassifyRule {
  /** 规则 ID 前缀/全名（来自 `trace.add(id)`） */
  ruleId?: RegExp
  /** 诊断文本关键词 */
  text?: RegExp
  severity: GapSeverity
  category: string
  suggestedPrimitive?: string
}

const RULES: ClassifyRule[] = [
  // ── unsupported：编译期阻断（failFast 路径——与 template.ts 的 failFastThrow 同源）──
  { text: /fail-fast|硬报错|不能继续/, severity: 'unsupported', category: '阻断' },

  // ── degraded：行为可能不一致（端对齐问题来源——须单独高亮）──
  { text: /恒不可用|不可用|不渲染|不生效|不一致|失效|丢失|无 scoped|已忽略|不匹配/, severity: 'degraded', category: '语义偏差' },
  { ruleId: /svg-p2-unsupported/, severity: 'degraded', category: '平台不支持（Skyline SVG）', suggestedPrimitive: '改用 <path> 或 WebView 渲染模式' },
  { ruleId: /slot-scope|scope-slot/, severity: 'degraded', category: '作用域插槽无对等', suggestedPrimitive: 'props 传子 + 事件回调' },
  { ruleId: /pre/, severity: 'degraded', category: 'v-pre 无 raw 模式' },
  { ruleId: /unknown-p-star|unknown-kebab/, severity: 'degraded', category: '未登记标签', suggestedPrimitive: '检查组件名或移除 p- 前缀' },

  // ── 脚本侧（C4 真项目实测补：这三条占未归类的绝大多数）──
  //
  // 【为什么"无法解析的 import"是 degraded 而非 fallback（真项目实测 235 处，最大一类）】
  //   产物里该 import 变成 `undefined` ⇒ 引用它的模板/computed **运行期失效**，
  //   且编译期不报错 —— 正是"行为可能不一致、最难查"的定义（须单独高亮）。
  { text: /无法解析的 import/, severity: 'degraded', category: '跨模块 import 失效（产物 undefined）', suggestedPrimitive: '改相对路径共享模块 或 用框架 store 桥' },
  { text: /是函数调用.*已编译为运行时初始化|初始值.*函数调用/, severity: 'fallback', category: '初始值函数调用（转运行时初始化）' },
  { ruleId: /script\/module-import/, severity: 'degraded', category: '跨模块 import 失效（产物 undefined）' },
  // ★模板函数调用：WXML 不支持 ⇒ **真机运行期会抛错**（诊断原文如此）⇒ degraded（不是"慢"，是"会错"）
  { text: /WXML 不支持函数调用/, severity: 'degraded', category: '模板函数调用（真机抛错）', suggestedPrimitive: 'computed 派生数据 或 方法内预计算' },
  { ruleId: /directive\/v-bind-key/, severity: 'fallback', category: 'key 绑定简化' },
  { ruleId: /script\/const-to-data/, severity: 'fallback', category: 'script 提升（const→data）' },
  { ruleId: /script\/computed-to-data/, severity: 'fallback', category: 'script 提升（computed→data）' },
  { ruleId: /script\//, severity: 'fallback', category: 'script 转换' },

  // ── fallback：功能可用、路径退化 ──
  { text: /回退|剥离|降级|已跳过|原样输出|转义|按普通|暂不支持|已原样输出/, severity: 'fallback', category: '路径退化' },
  { ruleId: /v-html/, severity: 'fallback', category: '富文本（rich-text 通道）', suggestedPrimitive: 'rich-text' },
  { ruleId: /class|style/, severity: 'fallback', category: '样式通道退化' },
  { ruleId: /grid/, severity: 'fallback', category: '语义编译回退运行时组件' },
  { ruleId: /event|inline-expression/, severity: 'fallback', category: '事件处理器简化' },
]

/** 计数器（一个编译单元一个实例；`collectGaps` 汇总） */
export class GapCounter {
  readonly records: PrimitiveGapRecord[] = []

  /** 记录一条诊断（`ruleId` 有则更可靠；两者可同时给） */
  record(file: string, construct: string, opts: { line?: number; ruleId?: string } = {}): void {
    const cls = classify(construct, opts.ruleId)
    this.records.push({
      file,
      line: opts.line,
      construct,
      category: cls.category,
      severity: cls.severity,
      ruleId: opts.ruleId,
      suggestedPrimitive: cls.suggestedPrimitive,
    })
  }

  /** 按 severity 汇总 */
  summary(): { fallback: number; degraded: number; unsupported: number; total: number } {
    let fallback = 0
    let degraded = 0
    let unsupported = 0
    for (const r of this.records) {
      if (r.severity === 'degraded') degraded++
      else if (r.severity === 'unsupported') unsupported++
      else fallback++
    }
    return { fallback, degraded, unsupported, total: this.records.length }
  }
}

/** 归类：规则 ID 优先（结构化）→ 关键词 → 兜底 fallback（**显式标记**，不静默丢） */
function classify(text: string, ruleId?: string): { severity: GapSeverity; category: string; suggestedPrimitive?: string } {
  for (const r of RULES) {
    if (r.ruleId && ruleId && r.ruleId.test(ruleId)) {
      return { severity: r.severity, category: r.category, suggestedPrimitive: r.suggestedPrimitive }
    }
  }
  for (const r of RULES) {
    if (r.text && r.text.test(text)) {
      return { severity: r.severity, category: r.category, suggestedPrimitive: r.suggestedPrimitive }
    }
  }
  // ★兜底：**显式标记为「未归类」而不是猜一个 severity**——否则"计数器说 0"可能只是没覆盖
  return { severity: 'fallback', category: '未归类（待补分类规则）' }
}

/**
 * 汇总多文件的计数器 → 埋点清单 §2.3 要求的人读报告。
 *
 * ★**degraded 单独成节且排最前**（清单 §2.5 硬要求：它不报错、最难查，最容易被淹没）。
 */
export function formatGapReport(counters: Array<{ file: string; counter: GapCounter }>): string {
  const all: PrimitiveGapRecord[] = []
  for (const { counter } of counters) all.push(...counter.records)
  const bySev = (s: GapSeverity): PrimitiveGapRecord[] => all.filter((r) => r.severity === s)
  const degraded = bySev('degraded')
  const unsupported = bySev('unsupported')
  const fallback = bySev('fallback')

  const lines: string[] = []
  lines.push('【编译期漏点报告】')
  lines.push(`  总计 ${all.length} 处`)
  lines.push(`  ├─ degraded     ${String(degraded.length).padStart(3)} 处（行为可能不一致 ← ★端对齐问题来源）`)
  lines.push(`  ├─ fallback     ${String(fallback.length).padStart(3)} 处（功能可用，性能/路径受损）`)
  lines.push(`  └─ unsupported  ${String(unsupported.length).padStart(3)} 处（编译期阻断）`)

  // ★degraded 单独高亮（最前）
  if (degraded.length) {
    lines.push('')
    lines.push('★★ degraded（行为可能不一致——最优先处理）')
    for (const r of groupTop(degraded)) lines.push(`  ${String(r.count).padStart(4)}×  ${r.category}${r.suggested ? ` → 建议：${r.suggested}` : ''}`)
  }
  if (fallback.length) {
    lines.push('')
    lines.push('fallback（路径退化）')
    for (const r of groupTop(fallback)) lines.push(`  ${String(r.count).padStart(4)}×  ${r.category}`)
  }
  if (unsupported.length) {
    lines.push('')
    lines.push('unsupported（阻断）')
    for (const r of groupTop(unsupported)) lines.push(`  ${String(r.count).padStart(4)}×  ${r.category}`)
  }
  const unclassified = all.filter((r) => r.category.startsWith('未归类'))
  if (unclassified.length) {
    lines.push('')
    lines.push(`⚠ 未归类 ${unclassified.length} 处（分类表未覆盖——**不应静默**，请补 RULES 或改诊断文本）`)
    for (const r of unclassified.slice(0, 5)) lines.push(`      ${r.file}: ${r.construct.slice(0, 70)}`)
  }
  lines.push('')
  lines.push('按文件（top 5）：')
  const byFile = new Map<string, number>()
  for (const r of all) byFile.set(r.file, (byFile.get(r.file) ?? 0) + 1)
  for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) lines.push(`  ${String(n).padStart(4)}×  ${f}`)
  return lines.join('\n')
}

/** 按 category 分组计数（报告用——比逐条列更可读） */
function groupTop(rs: PrimitiveGapRecord[]): Array<{ count: number; category: string; suggested?: string }> {
  const m = new Map<string, { count: number; suggested?: string }>()
  for (const r of rs) {
    const cur = m.get(r.category) ?? { count: 0, suggested: r.suggestedPrimitive }
    cur.count++
    m.set(r.category, cur)
  }
  return [...m.entries()].map(([category, v]) => ({ count: v.count, category, suggested: v.suggested })).sort((a, b) => b.count - a.count)
}

// packages/compiler/src/vapor/build.ts
// Vapor for Proteus IR · V2 Step 3-6 —— **依赖图 / 求值函数 / 订阅表 / 分层判定**
//
// 【本文档实现的四步（方案 §4.3）】
//   Step 3 依赖图构建：sourceId → slotId[] 静态映射（编译期产物，运行时直接查表）
//   Step 4 求值函数生成：每个槽位一个纯函数 `(源值快照) => 槽位值`
//   Step 5 订阅代码生成：SubscriptionTable（**可序列化**，不是 JS 源码字符串）
//   Step 6 安全性判定：逐槽位 L0/L1（方案 §5 七项条件；判定复用 slot-runtime/tier.ts，
//          ★同一语义只允许一处实现）
//
// 【★本模块的核心纪律：失败即整体降级，绝不半信半疑】
//   若某一步无法静态证明（表达式解析失败 / 宏语义不可得 / 依赖含动态结构），
//   对应槽位判 **L0**（走标准 Vue 路径）——不是"猜一个"。
//   误判为 L1 会导致**静默的 UI 不更新**，比慢 10 倍严重（方案 §12 第 3 条）。
import { SlotRuntime } from '@proteus-vue/slot-runtime'
import { decideTier } from '@proteus-vue/slot-runtime'
import type {
  ExplainRow,
  SlotKind,
  UpdateTier,
  SubscriptionTable,
  // ★本地也要用（不只是 re-export）——订阅表条目的构造引用了它们
  SlotSubscription,
  SourceSubscription,
  EvaluatorSpec,
} from '@proteus-vue/slot-runtime'
import { scanReactiveSources } from './sources'
import { compileExpr } from './expr'
import type { ReactiveSource } from './sources'
import { analyzeExprDeps, collectTemplateBindings } from './deps'
import type { ExprDeps, TemplateBindingRef } from './deps'

/* ────────────────────────── 产物形态（方案 §4.4） ────────────────────────── */

// ★类型定义在 **@proteus-vue/slot-runtime**（消费端），本模块 re-export——
//   依赖方向单向：compiler → slot-runtime。反过来会成环；复制一份必然分叉。
//   （与 V1 的 OpCode 同理：契约定义在消费端，生产端 import。）
export type { SubscriptionTable, SourceSubscription, SlotSubscription, EvaluatorSpec } from '@proteus-vue/slot-runtime'

/* ────────────────────────── 构建选项与结果 ────────────────────────── */

export interface VaporBuildOptions {
  /** 节点 id 分配起点（与 component-ir 的 builder 对齐；缺省 0） */
  startNodeId?: number
  /** 槽位 id 分配起点（缺省 0） */
  startSlotId?: number
  /** 人工标注为纯函数的符号名（等价 `// @proteus-pure`：方案 §5.6 逃生通道） */
  pureSymbols?: string[]
  /** 人工强制降级的槽位 id（等价 `<!-- @proteus-tier=L0 -->`） */
  forceL0Slots?: number[]
  /**
   * ★★逃生通道：允许 v-for 不带 `:key`（此时运行时用**行下标**）
   *
   * 【为什么需要它】无 `:key` 会被判为 **error**（方案坑位 #5：splice 后命中错行，
   *   静默错内容）。但存在**确实安全**的情形——例如列表只追加不删改、
   *   或开发者明确接受下标语义。⇒ 提供**显式**放行，而非把判据放宽（默认从严）。
   *
   * `true` = 全部放行；`number[]` = 只放行指定 listId（推荐，粒度细）。
   */
  allowIndexKey?: boolean | number[]
  /**
   * ★★Vue 解析器注入（方案 §8.1：编译器不依赖 Vue 版本）
   *
   * 【用法】兼容性测试传 3.4 / 3.6 的 `parse` / `compileScript` / `domParse`，
   *   断言三版产物**逐字节相同** ⇒ 这才是"不绑版本"的**证据**（而非声明）。
   * 缺省用本仓锁定的版本（`package.json` 的 `@vue/compiler-sfc`）。
   */
  compat?: import('./sources').VueCompatDeps
}

/**
 * ★★结构化诊断（**带严重级**——区别于 `notes` 的自由文本）
 *
 * 【为什么需要（本仓实测的动机）】`notes` 是给人看的字符串，**无法被门禁消费**——
 *   于是「无 `:key`」这类会导致**静默错行**（方案坑位 #5）的问题只能是"提示"，
 *   永远拦不住。⇒ 引入带 `severity` / `code` 的结构化通道：
 *   · `error`  ⇒ 调用方（构建流水线 / 门禁）**应当阻断**
 *   · `warn`   ⇒ 提示，可继续
 *   · `info`   ⇒ 追溯用（如"`:key` 不建槽位"这类正常行为）
 */
export interface VaporDiagnostic {
  severity: 'error' | 'warn' | 'info'
  /** 机器可判别的稳定代号（门禁与测试按它断言，不依赖文案） */
  code: string
  message: string
  /** 修复建议（面向开发者/LLM 的可执行指引） */
  hint?: string
  /** 涉及的槽位 / 列表（可用时给出） */
  slotId?: number
  listId?: number
  /** 源码行号（1-based；可用时给出） */
  line?: number
}

export interface VaporBuildResult {
  table: SubscriptionTable
  sources: ReactiveSource[]
  /** 分层判定明细（`proteus explain` 消费；方案 §5.5 硬性要求） */
  decisions: ExplainRow[]
  /** 诊断（不阻断编译；说明为何降级）——自由文本，供人读 */
  notes: string[]
  /** ★★结构化诊断（**带严重级**，供门禁与工具消费） */
  diagnostics: VaporDiagnostic[]
  /** 整体是否可信（false = 源扫描失败 ⇒ 全部 L0；调用方应提示用户） */
  ok: boolean
  /**
   * ★★是否存在 `error` 级诊断（**调用方应据此阻断**）
   *
   * 【为什么单列】`ok` 的语义是"产物结构上可用"（源扫描成功）；
   *   而 `hasErrors` 表达"存在会静默出错的问题（如无 :key）"——
   *   两者**不可合并**：源扫描失败时全部降 L0（安全）；无 :key 时产物可用但**会错**。
   */
  hasErrors: boolean
}

/**
 * 主入口：SFC 源码 → 订阅表 + 分层判定
 *
 * 【为什么 nodeId 由参数控制】槽位要定位到具体节点，而节点 id 由 IR builder 分配
 *   （同一个 SFC 在两处构建必须给出同一套 id）。这里按模板出现顺序**自增**，
 *   与 component-ir 的 builder 顺序一致（同为模板序 DFS）。
 */
export function buildVaporSubscriptions(source: string, filename = 'anonymous.vue', opts: VaporBuildOptions = {}): VaporBuildResult {
  const notes: string[] = []
  const diagnostics: VaporDiagnostic[] = []
  const srcScan = scanReactiveSources(source, filename, opts.compat)
  if (!srcScan.ok) {
    // ★整体降级：源不可信 ⇒ 全部 L0（不猜）
    return {
      table: emptyTable(),
      sources: [],
      decisions: [],
      notes: [`源扫描失败，全部降级 L0：${srcScan.error ?? '未知原因'}`],
      diagnostics: [
        {
          severity: 'error',
          code: 'VAPOR_SOURCE_SCAN_FAILED',
          message: `响应式源扫描失败：${srcScan.error ?? '未知原因'}`,
          hint: '全部槽位已降级 L0（标准 Vue 渲染路径）——行为正确但无加速；请检查 SFC 语法',
        },
      ],
      ok: false,
      hasErrors: true,
    }
  }

  const bindings = collectTemplateBindings(source, filename, opts.compat)
  const pure = new Set(opts.pureSymbols ?? [])
  const forceL0 = new Set(opts.forceL0Slots ?? [])

  let slotId = opts.startSlotId ?? 0
  /** ★每个列表的「行模板内槽位序号」计数器（itemSlotId 的来源） */
  const listSlotCounters = new Map<number, number>()
  const slotsBySource = new Map<number, SlotSubscription[]>()
  const evaluators: EvaluatorSpec[] = []
  const l0Slots: SubscriptionTable['l0Slots'] = []
  const decisions: ExplainRow[] = []
  const slotRecords: Array<{ slot: SlotSubscription; deps: ExprDeps; ref: TemplateBindingRef }> = []

  for (const ref of bindings) {
    const deps = analyzeExprDeps(ref.code, ref.scopes)
    const kind = slotKindOf(ref.propKey)
    // 每个绑定 = 一个槽位；★nodeId 取「该元素在模板序 DFS 中的序号」
    //
    // 【本仓实测的真缺陷】首版用「绑定序号」当 nodeId ⇒ `<p-view><p-view :width="w"/></p-view>`
    //   里那个绑定拿到 nodeId=0（根），而它在树里是第 2 个节点 ⇒ **指令写到错误的节点**，
    //   且不报错（几何静默不对）。⇒ nodeId 必须与 IR builder 同源（模板序 DFS 给每个元素编号）。
    const mySlot = slotId++
    const myNode = ref.elementIndex

    // ★Step 6：分层判定（复用 slot-runtime/tier.ts 的七条件实现——同一语义一处实现）
    //
    // ★C1 的两条通路必须区分（本仓实测：首版混在一起 ⇒ 诊断把"人工担保"显示成"静态证明"）：
    //   · 表达式里**没有**函数调用 ⇒ 静态即可判纯（`pureExpression: true`，forced=false）
    //   · 有调用但**全部**在 `pureSymbols`（= `@proteus-pure` 注解）⇒ 走**人工担保**
    //     （置 `forcePure: true` ⇒ tier.ts 会标记 forced=true，explain 显示 ⚠）
    //   两者的可信度不同：静态证明是可复算的，人工担保是开发者的承诺——诊断必须能区分。
    const allCallsWhitelisted = deps.calls.length > 0 && deps.calls.every((c) => pure.has(c))
    const decision = decideTier({
      pureExpression: !deps.hasCall,
      forcePure: allCallsWhitelisted,
      // C2：依赖全部静态可枚举（解析成功 + 每个标识符要么是已知源、要么是全局）
      depsEnumerable: !deps.parseFailed,
      // C3–C7：本模块在 SFC 模板的静态范围内，逐项判定
      insideDynamicComponent: /<component\s+[^>]*:is=/.test(source),
      insideDynamicSlot: /<template\s+[^>]*#\[/.test(source),
      insideRuntimeBranch: ref.inRuntimeBranch,
      insideRenderFunction: /render\s*\(|setup\s*\(\)\s*\{[^}]*\breturn\s*\(\)\s*=>/.test(source),
      usesInstanceInternals: /\bgetCurrentInstance\s*\(|\bthis\.\$/.test(source),
      forceTier: forceL0.has(mySlot) ? 'L0' : undefined,
    })

    const evaluatorId = evaluators.length
    const evBuilt = makeEvaluator(evaluatorId, ref.code, deps)
    evaluators.push(evBuilt.spec)
    // ★★编译期就上报「参考实现无法求值」的表达式（比运行时上报更早、更可行动）
    //
    // 【为什么提前到编译期】运行时上报只能告诉"某槽位未生效"；
    //   而编译期知道**具体是什么语法不被支持**（如"不支持宽松相等 ==/!="）⇒ 可直接给出改法。
    //   ★注：这不是 error 级——该槽位仍会走 L0（标准 Vue 渲染）或由各端执行器消费，
    //     行为正确、只是无加速。故定为 warn（可在门禁里按需升级）。
    if (evBuilt.unsupported) {
      diagnostics.push({
        severity: 'warn',
        code: 'VAPOR_EXPR_UNSUPPORTED',
        message: `表达式 \`${ref.code}\` 无法编译为可求值程序：${evBuilt.unsupported}`,
        hint: '该槽位在参考实现下不会更新（各端可注入自己的表达式执行器）；或改写为受支持的子集',
        slotId: mySlot,
        line: ref.line,
      })
    }

    // ★★v-for 行内绑定 ⇒ 产出 **list-item 槽位**（方案 §2.3；本仓实测补的功能缺口）
    //
    // 【为什么不能当普通槽位】`{{ item.title }}` 的 nodeId 是**模板级**的，而 v-for 的行会实例化
    //   N 次 ⇒ 没有单一固定 nodeId ⇒ 指令会写到"模板那个节点"上（几何/内容静默不对）。
    //   ⇒ 产出 `list-item`：运行时按 (listId, itemKey, itemSlotId) 解析出**具体行**的节点。
    //   `:key` 绑定自身**建槽位时跳过**——它是 diff 提示、不是可更新渲染属性；
    //   但它的表达式已作为 `keyField` 记进上下文（运行时的行标识字段）。
    const inList = ref.listContext && !ref.listContext.isKeyBinding
    if (inList) {
      const listId = ref.listContext!.listId
      const itemSlotId = listSlotCounters.get(listId) ?? 0
      listSlotCounters.set(listId, itemSlotId + 1)
      const itemKind: 'style' | 'text' = ref.propKey.startsWith('text.') && ref.propKey !== 'text.color' && ref.propKey !== 'text.fontSize' ? 'text' : 'style'
      // ★从依赖路径里取「相对行对象的字段名」（`item.title` → `title`）
      const scope = ref.listContext!.scope
      const relPath = deps.listRelative.find((r) => r.scope === scope)?.path ?? ''
      const itemValueField = relPath.startsWith(`${scope}.`) ? relPath.slice(scope.length + 1) : undefined
      // ★行标识字段：来自 `:key="item.id"`（相对路径 `id`）
      const keyExpr = ref.listContext!.keyField
      const itemKeyField = keyExpr && keyExpr.startsWith(`${scope}.`) ? keyExpr.slice(scope.length + 1) : undefined
      const itemSlot: SlotSubscription = {
        slotId: mySlot,
        nodeId: myNode, // 模板级序号（诊断用；实际目标由 ListRegistry 解析）
        evaluatorId,
        tier: decision.tier,
        kind: 'list-item',
        propKey: ref.propKey,
        listId,
        itemSlotId,
        itemKind,
        itemValueField,
        itemKeyField,
        scope, // ★v-for 别名（运行时行作用域求值用）
        sourceExpr: ref.listContext!.sourceExpr,     // ★列表源表达式（嵌套如 group.items）
        parentListId: ref.listContext!.parentListId, // ★外层列表 id（嵌套时才有）
      }
      slotRecords.push({ slot: itemSlot, deps, ref })
      decisions.push({
        slotId: mySlot,
        snippet: `${ref.where}="${ref.code}"`,
        tier: decision.tier,
        reason: `${decision.reason} · ★行内槽位（listId=${listId} itemSlotId=${itemSlotId} key=${ref.listContext!.keyField ?? '<无 :key>'}）`,
        mark: decision.forced ? '⚠' : decision.tier === 'L1' ? '✓' : '✗',
      })
      if (decision.tier === 'L0') {
        l0Slots.push({ slotId: mySlot, nodeId: myNode, propKey: ref.propKey, reason: decision.reason })
        continue
      }
      // 挂到列表源（行由该列表驱动）
      const listRoots = [...new Set(deps.listRelative.map((r) => ref.scopeSources[r.scope] ?? r.scope))]
      for (const rootName of listRoots) {
        const src = srcScan.byName.get(rootName)
        if (!src) continue
        const list = slotsBySource.get(src.sourceId) ?? []
        if (!list.some((x) => x.slotId === mySlot)) list.push(itemSlot)
        slotsBySource.set(src.sourceId, list)
      }
      // ★★无 `:key` ⇒ **error 级诊断**（本仓实测：这是"静默错行"的来源）
      //
      // 【为什么是 error 而不是 warn（依据）】没有 `:key` 时运行时用**行下标**兜底；
      //   而 `splice` 之后下标会指向**另一行** ⇒ `LIST_UPDATE` 写到错误的行
      //   ⇒ **静默错内容**（方案坑位 #5 明列）。这类失效没有报错、没有崩，
      //   只有肉眼在滚动/增删后才可能发现——属最该被拦下的一类。
      //   ⇒ 定为 error；真需要下标语义时用**显式逃生通道** `allowIndexKey`
      //     （显式 = 开发者已确认该列表不会被 splice / 或接受下标语义）。
      const hasKey = Boolean(ref.listContext!.keyField)
      const allowIndex = opts.allowIndexKey === true || (Array.isArray(opts.allowIndexKey) && opts.allowIndexKey.includes(listId))
      if (!hasKey && !allowIndex) {
        diagnostics.push({
          severity: 'error',
          code: 'VAPOR_VFOR_WITHOUT_KEY',
          message: `v-for 缺少 :key（listId=${listId}）：行标识不稳定，splice 后会命中错误的行（静默错内容）`,
          hint:
            '给该 v-for 加稳定 :key（如 `:key="item.id"`，不要用下标）；' +
            '若该列表确实不会被 splice / 你接受下标语义，可显式传入 opts.allowIndexKey',
          slotId: mySlot,
          listId,
          line: ref.line,
        })
      }
      const keyNote = hasKey ? '' : allowIndex ? '（无 :key，已由 allowIndexKey 显式放行 ⇒ 用下标）' : ''
      notes.push(`slot_${mySlot} 行内槽位：${ref.code} → listId=${listId} itemSlotId=${itemSlotId}${keyNote}`)
      continue
    }
    if (ref.listContext?.isKeyBinding) {
      // :key 不建槽位（非渲染属性）——跳过但要留痕，便于 explain 追查
      notes.push(`:key="${ref.code}" 不建槽位（行标识字段，非可更新渲染属性）`)
      diagnostics.push({
        severity: 'info',
        code: 'VAPOR_KEY_IS_ROW_IDENTITY',
        message: `:key="${ref.code}" 用作行标识字段（非可更新渲染属性）`,
      })
      continue
    }

    const slot: SlotSubscription = { slotId: mySlot, nodeId: myNode, evaluatorId, tier: decision.tier, kind, propKey: ref.propKey }
    slotRecords.push({ slot, deps, ref })

    const snippet = `${ref.where}="${ref.code}"`
    decisions.push({ slotId: mySlot, snippet, tier: decision.tier, reason: decision.reason, mark: decision.forced ? '⚠' : decision.tier === 'L1' ? '✓' : '✗' })

    if (decision.tier === 'L0') {
      l0Slots.push({ slotId: mySlot, nodeId: myNode, propKey: ref.propKey, reason: decision.reason })
      continue
    }

    // Step 3：依赖图（sourceId → slots）
    const roots = deps.roots.filter((r) => srcScan.byName.has(r))
    const missing = deps.roots.filter((r) => !srcScan.byName.has(r))
    if (missing.length > 0) notes.push(`slot_${mySlot} 引用未识别标识符：${missing.join(', ')}（已计入 L1，若为运行时值请加 @proteus-pure 或降级）`)
    for (const rootName of roots) {
      const src = srcScan.byName.get(rootName)!
      const list = slotsBySource.get(src.sourceId) ?? []
      list.push(slot)
      slotsBySource.set(src.sourceId, list)
    }
    if (deps.listRelative.length > 0) {
      // ★列表内相对路径：归属**该列表的源**（`item` → `list`），由 LIST_UPDATE 承接（V1 已实现指令）。
      //
      // 【本仓实测的坑】首版直接拿 scope 名（`item`）去找同名源 ⇒ 找不到 ⇒ **这条绑定从依赖图里消失**
      //   （现象：槽位标了 L1，但依赖图里没有它 = 运行时那个源变化不会写这个槽位 → 静默不更新）。
      //   正解：走 `scopeSources` 别名映射（`item` → `list`）回到真正的列表源。
      const listRoots = [...new Set(deps.listRelative.map((r) => ref.scopeSources[r.scope] ?? r.scope))]
      let hooked = 0
      for (const rootName of listRoots) {
        const src = srcScan.byName.get(rootName)
        if (!src) continue
        const list = slotsBySource.get(src.sourceId) ?? []
        if (!list.some((x) => x.slotId === mySlot)) list.push(slot)
        slotsBySource.set(src.sourceId, list)
        hooked++
      }
      if (hooked === 0) {
        notes.push(`★slot_${mySlot} 依赖列表相对路径 ${deps.listRelative.map((r) => r.path).join(', ')} 但**未挂到任何列表源**（scopeSources=${JSON.stringify(ref.scopeSources)}）——请检查 v-for 形态`)
        diagnostics.push({
          severity: 'warn',
          code: 'VAPOR_LIST_BINDING_NOT_HOOKED',
          message: `slot_${mySlot} 的列表相对路径未挂到任何列表源`,
          hint: '该槽位不会被任何源驱动 ⇒ 可能静默不更新；请检查 v-for 形态（如 v-for 是否写在正确的元素上）',
          slotId: mySlot,
        })
      } else {
        notes.push(`slot_${mySlot} 依赖列表相对路径 ${deps.listRelative.map((r) => r.path).join(', ')} ⇒ 归属列表源 ${listRoots.join('/')}，由 LIST_UPDATE 承接（item 级）`)
      }
    }
  }

  // 组装源表（只保留有 L1 槽位的源；按 sourceId 升序 ⇒ 产物可复现）
  const sources: SourceSubscription[] = []
  for (const s of [...srcScan.sources].sort((a, b) => a.sourceId - b.sourceId)) {
    const slots = slotsBySource.get(s.sourceId)
    if (!slots || slots.length === 0) continue
    sources.push({ sourceId: s.sourceId, sourceName: s.name, sourceKind: s.kind, slots: slots.slice().sort((a, b) => a.slotId - b.slotId) })
  }

  const l1 = slotRecords.filter((r) => r.slot.tier === 'L1').length
  const l0 = slotRecords.length - l1
  void SlotRuntime // 类型引用（产物与运行时同源）

  return {
    diagnostics,
    hasErrors: diagnostics.some((d) => d.severity === 'error'),
    table: {
      version: 1,
      sources,
      evaluators,
      l0Slots,
      stats: { l1, l0, l1Rate: l1 + l0 === 0 ? 0 : Math.round((l1 / (l1 + l0)) * 10000) / 10000 },
    },
    sources: srcScan.sources,
    decisions,
    notes,
    ok: true,
  }
}

function emptyTable(): SubscriptionTable {
  return { version: 1, sources: [], evaluators: [], l0Slots: [], stats: { l1: 0, l0: 0, l1Rate: 0 } }
}

/** 求值函数规格：能静态判定的走 `member`（热路径免解析），否则 `expr` */
function makeEvaluator(
  evaluatorId: number,
  code: string,
  deps: ExprDeps,
): { spec: EvaluatorSpec; unsupported?: string } {
  const trimmed = code.trim()
  void deps
  // ① 纯成员访问（最常见形态：`item.name`）：免解析直接取值
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(trimmed)) {
    const [root] = trimmed.split('.')
    return { spec: { evaluatorId, form: 'member', root, path: trimmed, pure: true } }
  }
  // ② 字面量常量
  if (/^(\d+(\.\d+)?|'[^']*'|"[^"]*"|true|false|null)$/.test(trimmed)) {
    return { spec: { evaluatorId, form: 'const', expr: trimmed, pure: true } }
  }
  // ③ ★★结构化表达式程序（方案 §4.3 Step 4 的落地）
  //
  // 【为什么要有这一档（本仓实测的功能缺口）】`{{ n + 1 }}` / `{{ group.title + item.name }}`
  //   这类**含运算**的表达式此前落到 ④ 的 `expr` 形态 ⇒ 参考实现**不认识** ⇒ 该槽位永不更新。
  //   而这类表达式在实际模板里极常见 ⇒ 编译成程序（可序列化、跨端可执行）。
  const compiled = compileExpr(trimmed)
  if (compiled.ok) {
    return { spec: { evaluatorId, form: 'program', program: compiled.program, pure: true } }
  }
  // ④ 兜底：保留原始文本（**参考实现不支持** ⇒ 运行时会上报；各端可用自家表达式执行器消费）
  return {
    spec: { evaluatorId, form: 'expr', expr: trimmed, pure: false },
    unsupported: compiled.unsupported,
  }
}

/** propKey → 槽位种类（与 component-ir 的 inferUpdateKind 同口径，但归到 slot-runtime 的 SlotKind） */
export function slotKindOf(propKey: string): SlotKind {
  if (propKey === 'text.content' || propKey.startsWith('text.')) return propKey === 'text.color' || propKey === 'text.fontSize' ? 'style' : 'text'
  if (propKey === 'visible') return 'visibility'
  if (propKey.startsWith('layout.') || propKey.startsWith('paint.')) return 'style'
  if (propKey.startsWith('list.')) return 'list-data'
  return 'prop'
}

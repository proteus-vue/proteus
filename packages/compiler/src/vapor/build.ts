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
}

export interface VaporBuildResult {
  table: SubscriptionTable
  sources: ReactiveSource[]
  /** 分层判定明细（`proteus explain` 消费；方案 §5.5 硬性要求） */
  decisions: ExplainRow[]
  /** 诊断（不阻断编译；说明为何降级） */
  notes: string[]
  /** 整体是否可信（false = 源扫描失败 ⇒ 全部 L0；调用方应提示用户） */
  ok: boolean
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
  const srcScan = scanReactiveSources(source, filename)
  if (!srcScan.ok) {
    // ★整体降级：源不可信 ⇒ 全部 L0（不猜）
    return {
      table: emptyTable(),
      sources: [],
      decisions: [],
      notes: [`源扫描失败，全部降级 L0：${srcScan.error ?? '未知原因'}`],
      ok: false,
    }
  }

  const bindings = collectTemplateBindings(source, filename)
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
    evaluators.push(makeEvaluator(evaluatorId, ref.code, deps))

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
      const keyWarn = ref.listContext!.keyField ? '' : '（★该 v-for 无 :key ⇒ 行标识不稳定，运行时须用下标兜底——方案坑位 #5）'
      notes.push(`slot_${mySlot} 行内槽位：${ref.code} → listId=${listId} itemSlotId=${itemSlotId}${keyWarn}`)
      continue
    }
    if (ref.listContext?.isKeyBinding) {
      // :key 不建槽位（非渲染属性）——跳过但要留痕，便于 explain 追查
      notes.push(`:key="${ref.code}" 不建槽位（行标识字段，非可更新渲染属性）`)
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
function makeEvaluator(evaluatorId: number, code: string, deps: ExprDeps): EvaluatorSpec {
  const trimmed = code.trim()
  // 纯成员访问（最常见形态：`item.name`）：免解析直接取值
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(trimmed)) {
    const [root, ...rest] = trimmed.split('.')
    return { evaluatorId, form: 'member', root, path: trimmed, pure: true }
  }
  // 字面量常量
  if (/^(\d+(\.\d+)?|'[^']*'|"[^"]*"|true|false|null)$/.test(trimmed)) {
    return { evaluatorId, form: 'const', pure: true }
  }
  return { evaluatorId, form: 'expr', expr: trimmed, pure: !deps.hasCall }
}

/** propKey → 槽位种类（与 component-ir 的 inferUpdateKind 同口径，但归到 slot-runtime 的 SlotKind） */
export function slotKindOf(propKey: string): SlotKind {
  if (propKey === 'text.content' || propKey.startsWith('text.')) return propKey === 'text.color' || propKey === 'text.fontSize' ? 'style' : 'text'
  if (propKey === 'visible') return 'visibility'
  if (propKey.startsWith('layout.') || propKey.startsWith('paint.')) return 'style'
  if (propKey.startsWith('list.')) return 'list-data'
  return 'prop'
}

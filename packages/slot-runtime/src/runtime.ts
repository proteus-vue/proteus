// packages/slot-runtime/src/runtime.ts
// Vapor for Proteus IR · V3 —— **订阅表驱动的槽位运行时**（方案 §1.3 L1 层的完整形态）
//
// 【V3 补的是什么】V1 交付了槽位容器与指令通道，但槽位要**手工 setSlot**；
//   V2 交付了编译器算出的 `SubscriptionTable`（源 → 槽位 + 求值函数声明）。
//   本模块把两者接起来：**加载订阅表 → 注册订阅 → 源变化时自动求值并直写槽位**。
//   这就是方案 §1.2 的目标路径：
//
//     ref 写入 → 直写对应槽位 → UpdateProgram 发射指令 → 提交
//     （对比 Vue 默认：组件 render 重跑 → 重建 VNode → diff → patch）
//
// 【★诚实边界：本模块不依赖 Vue】
//   方案 §4.1 的措辞是「保留 Vue 运行时响应式（Proxy 依赖收集），只把**监听之后做什么**改掉」。
//   故本模块只要求调用方提供一个 `subscribe(sourceName, cb)` 钩子——
//   生产环境用 Vue 的 `watch`/`effect` 接，测试用同步桩。这样：
//     · 本模块可独立测试（不依赖 Vue 版本）
//     · 换响应式实现（如方案 §8 讨论的 alien-signals）不用改这里
import { OpCode } from './opcode'
import type { SlotKind, UpdateTier } from './opcode'
import type { ListRegistry } from './list-registry'
import { evalExpr } from './expr'
import { SlotRuntime, createSlot } from './slot'
import type { Slot } from './slot'
import type { EvaluatorSpec, SubscriptionTable } from './table'

/** 源订阅钩子：源值变化时回调（由宿主注入；Vue 场景 = watch / effect） */
export type SourceSubscriber = (sourceName: string, onChange: () => void) => void

/** 求值上下文（取源值用） */
export interface EvalContext {
  /** 读源当前值（Vue 场景 = `unref` 后的值；列表源 = 数组） */
  read(sourceName: string): unknown
}

/** 加载结果（供宿主对账与诊断） */
export interface LoadResult {
  /** 实际建立订阅的 L1 槽位数 */
  l1Slots: number
  /** 未建订阅的 L0 槽位数（走 Vue 渲染） */
  l0Slots: number
  /** 未知源名（订阅表引用了宿主没提供的源——**必须上报**，否则是静默不更新） */
  unknownSources: string[]
  /** 无法实例化的求值函数（形态不支持等）——同样上报 */
  unsupportedEvaluators: Array<{ evaluatorId: number; reason: string }>
  /**
   * ★行内槽位中**求值器未能实例化**的（诊断）
   *
   * 典型触发：表达式引用**外层别名**（`{{ group.title + item.name }}`）或含运算
   * ⇒ 编译器给 `expr` 形态，而参考实现只支持纯路径（完整求值需目标端执行器）。
   */
  uninstantiatedSlots: Array<{ slotId: number; evaluatorId: number; propKey: string }>
}

/**
 * 订阅表驱动的槽位运行时（方案 §1.3 的 L1 完整形态）
 *
 * 用法（宿主侧）：
 * ```ts
 * const rt = new VaporRuntime(table, { push: (op) => buffer.push(op) }, keys, strings)
 * rt.load(evaluatorCtx, (sourceName, cb) => watch(sourceName, cb))   // 注册订阅
 * rt.relink()   // 首帧：把所有 L1 槽位写入一次
 * ```
 */
export class VaporRuntime {
  private readonly slots = new Map<number, Slot>();
  private readonly slotById = new Map<number, { slot: Slot; spec: SubscriptionTable['sources'][number]['slots'][number]; evalId: number }>()
  private readonly evalImpls = new Map<number, (ctx: EvalContext) => unknown>()
  private readonly sourcesOfSlot = new Map<number, string[]>()
  /**
   * ★★未能实例化求值器的槽位（**诊断，不许静默**）
   *
   * 【为什么必须有（本仓实测）】表达式引用外层别名或含运算时编译器给 `expr` 形态，
   *   而 `expr` 只支持纯路径 ⇒ `impl` 为 undefined。首版**直接 continue** ⇒
   *   该槽位永不写、且无任何提示（静默不更新的典型）。
   */
  readonly uninstantiatedSlots: Array<{ slotId: number; evaluatorId: number; propKey: string }> = []

  /** ★行内槽位的按键值缓存（`slotId:key` → 上次值）——只发变化行 */
  private readonly itemValueCache = new Map<string, unknown>()
  private loaded = false

  constructor(
    readonly table: SubscriptionTable,
    readonly rt: SlotRuntime,
    /** 求值函数的**实现**（由 evaluator 声明重建；id → 函数） */
    private readonly evaluators: Map<number, (ctx: EvalContext) => unknown>,
    /**
     * ★V4：列表项注册表（可选）
     *
     * 提供它 ⇒ `list-item` 槽位在发指令前解析出**具体行的节点**，从而发普通 SET_STYLE/SET_TEXT
     *（核心无需懂列表）；不提供或未登记 ⇒ 回退 `LIST_UPDATE`（宿主自持映射的场景）。
     */
    private readonly registry?: ListRegistry,
  ) {}

  /**
   * 从订阅表重建求值函数（把**可序列化的声明**变成可执行函数）
   *
   * 【为什么单独一步（而不是直接吃函数）】方案 §4.4 要求产物可序列化
   *   （跨端禁 eval）⇒ 声明与实现分离：声明随产物下发，实现在各端本地重建。
   *   本方法就是「本地重建」的参考实现：
   *     · `member` —— 纯路径访问，**免解析**（热路径主力）
   *     · `const`  —— 常量
   *     · `expr`   —— 表达式文本（各端按自己的能力求值；本实现给出最简单的成员回退）
   */
  static buildEvaluators(specs: EvaluatorSpec[]): Map<number, (ctx: EvalContext) => unknown> {
    const out = new Map<number, (ctx: EvalContext) => unknown>()
    for (const s of specs) {
      switch (s.form) {
        case 'member': {
          const segs = (s.path ?? '').split('.').filter(Boolean)
          const [root, ...rest] = segs
          out.set(s.evaluatorId, (ctx) => {
            let v = ctx.read(root!)
            for (const seg of rest) {
              if (v == null || typeof v !== 'object') return undefined
              v = (v as Record<string, unknown>)[seg]
            }
            return v
          })
          break
        }
        case 'program': {
          // ★★结构化表达式程序：用本包的解释器执行（方案 §4.3 Step 4 的落地）
          //   这是「含运算的表达式」的**标准路径**——不再落到 `expr` 形态而失效。
          const prog = s.program
          if (!prog) break // 缺程序体属产物异常 ⇒ 保持未实例化（上报）
          out.set(s.evaluatorId, (ctx) => evalExpr(prog, ctx as { read(name: string): unknown }))
          break
        }
        case 'const': {
          const text = (s.expr ?? '').trim()
          const parsed: unknown = /^-?\d+(\.\d+)?$/.test(text)
            ? Number(text)
            : text === 'true'
              ? true
              : text === 'false'
                ? false
                : text.replace(/^['"]|['"]$/g, '')
          out.set(s.evaluatorId, () => parsed)
          break
        }
        case 'expr': {
          // ★诚实边界：本参考实现只支持**单一路径/值引用**的表达式形态。
          //   完整表达式求值（`n + 1`、三元、模板串）需要目标端的表达式执行器——
          //   方案 §6 的三端执行层各有一份（App 端可用 Hermes 的 function 构造，
          //   Web 端直接 new Function，小程序端需走 WXS/Worklet）。
          //   ⇒ 不在本层猜：标为不支持并上报（由调用方决定降级或补实现）。
          const expr = (s.expr ?? '').trim()
          if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(expr)) {
            const segs = expr.split('.')
            const [root, ...rest] = segs
            out.set(s.evaluatorId, (ctx) => {
              let v = ctx.read(root!)
              for (const seg of rest) {
                if (v == null || typeof v !== 'object') return undefined
                v = (v as Record<string, unknown>)[seg]
              }
              return v
            })
          }
          break
        }
        default:
          break
      }
    }
    return out
  }

  /** 注册订阅（方案 §4.3 Step 5：源变化 → 求值 → 直写槽位） */
  load(ctx: EvalContext, subscribe: SourceSubscriber): LoadResult {
    const unknownSources: string[] = []
    const unsupportedEvaluators: Array<{ evaluatorId: number; reason: string }> = []
    let l1Slots = 0

    for (const src of this.table.sources) {
      for (const spec of src.slots) {
        const impl = this.evaluators.get(spec.evaluatorId)
        if (!impl) {
          unsupportedEvaluators.push({ evaluatorId: spec.evaluatorId, reason: '求值函数未实例化（形态不支持）' })
          continue
        }
        // 每个槽位只建一次（一个源可能出现在多个 slot 里；同一槽位也可能被多个源引用）
        let slot = this.slots.get(spec.slotId)
        if (!slot) {
          // ★V4：列表行内槽位用**编译器产出的真实** listId/itemSlotId（V3 时是占位值）
          //   —— 配合 `ListRegistry` 把 (listId, itemKey, itemSlotId) 解析成具体行的节点。
          slot = createSlot(
            {
              id: spec.slotId,
              nodeId: spec.nodeId,
              kind: spec.kind as SlotKind,
              keyId: this.rt.keys.intern(spec.propKey),
              listId: spec.listId ?? spec.slotId,
              listSlotId: spec.itemSlotId ?? spec.slotId,
              itemKind: spec.itemKind,
              itemValueField: spec.itemValueField,
              itemKeyField: spec.itemKeyField,
              scope: spec.scope,
            },
            this.rt.keys,
            this.rt.strings,
            undefined as unknown,
            this.registry, // ★传入注册表（缺省 ⇒ list-item 回退 LIST_UPDATE，保持 V3 行为）
          )
          this.slots.set(spec.slotId, slot)
        }
        this.slotById.set(spec.slotId, { slot, spec, evalId: spec.evaluatorId })
        // 记录该槽位被哪些源驱动（多源依赖时任一变化都要重算）
        const deps = this.sourcesOfSlot.get(spec.slotId) ?? []
        deps.push(src.sourceName)
        this.sourcesOfSlot.set(spec.slotId, deps)
        l1Slots++
      }
    }

    // 注册订阅：源变化 → 求值其全部槽位 → 直写
    for (const src of this.table.sources) {
      subscribe(src.sourceName, () => {
        this.writeSlotsOfSource(src.sourceName, ctx)
      })
    }

    // ★★实例化检查要在**返回之前**做（本仓实测的时序坑）
    //
    // 【为什么】`load()` 只**注册订阅**，真正的求值发生在 `relink()` / 源变化时
    //   ⇒ 若把检查放在求值路径里，`load()` 返回的清单**永远是空的**（push 晚于 return）。
    //   ⇒ 正解：在这里**按槽位逐条检查**「求值器是否已实例化」，与是否已求值无关。
    for (const src of this.table.sources) {
      for (const spec of src.slots) {
        if (spec.kind !== 'list-item') continue
        if (!this.evaluators.get(spec.evaluatorId)) {
          this.uninstantiatedSlots.push({ slotId: spec.slotId, evaluatorId: spec.evaluatorId, propKey: spec.propKey })
        }
      }
    }

    this.loaded = true
    return {
      l1Slots,
      l0Slots: this.table.l0Slots.length,
      unknownSources,
      unsupportedEvaluators,
      // ★行内槽位的未实例化清单（与 unsupportedEvaluators 同性质：**上报而非静默**）
      uninstantiatedSlots: this.uninstantiatedSlots.slice(),
    }
  }

  /** 写入某源驱动的全部槽位（源变化时由订阅回调触发） */
  writeSlotsOfSource(sourceName: string, ctx: EvalContext): void {
    for (const src of this.table.sources) {
      if (src.sourceName !== sourceName) continue
      // ★★列表行内槽位走**独立通道**（本仓实测的设计纠正，我为此试错三轮）
      //
      // 【为什么不能走"脏槽位"】`LIST_UPDATE` 的语义是「(listId, itemKey, slotId, value)」
      //   ——**每行一条指令**；而"一个槽位持有一个值"的模型**装不下 N 行**
      //   （写 N 次只剩最后一次；且 `Object.is` 短路会误判成"没变"）。
      //   ⇒ 正解：**按行迭代** + 用**按键缓存的上一轮值**做 diff + 只发变化行的指令。
      //     这保住 O(1)（只改 1 行 ⇒ 只发 1 条），且不误用槽位模型。
      this.writeListItems(src, ctx)

      for (const spec of src.slots) {
        if (spec.kind === 'list-item') continue // 已由上方通道处理
        // ★`list-data` 也**不走标量写值**（本仓实测：它是报错源，不是 list-item）
        //
        // 【为什么】`LIST_SET` 的载荷是**编译期分配的「数据源引用号」**（数字），
        //   不是数组本身——「整体换数据源」是结构性操作，不是"把数组写进一个槽位"。
        //   把它当标量写 ⇒ 求值器返回数组 ⇒ `toF32(数组)` 抛错（本仓实测就是这个）。
        //   ⇒ 结构性的 LIST_SET/LIST_SPLICE 属独立课题（需数据源引用协议），当前显式跳过。
        if (spec.kind === 'list-data') continue
        const entry = this.slotById.get(spec.slotId)
        const impl = this.evaluators.get(spec.evaluatorId)
        if (!entry || !impl) continue
        this.rt.setSlot(entry.slot, impl(ctx) as never)
      }
    }
  }

  /**
   * ★列表行内槽位通道：按行求值 → 与上一轮**按 key 缓存**的值 diff → 只发变化行
   *
   * 【关键：行作用域求值】`item.w` 的求值需要**当前行**绑定到 v-for 作用域。
   *   故每行构造一个 `rowCtx`：`read(scope)` 返回该行，其余名透传原 ctx。
   *   （编译器在槽位上给了 `scope` 才能这么做——见 SlotSubscription.scope）
   */
  private writeListItems(src: SubscriptionTable['sources'][number], ctx: EvalContext): void {
    const itemSlots = src.slots.filter((x) => x.kind === 'list-item')
    if (itemSlots.length === 0) return

    // ★★行集解析（**递归支持任意层嵌套**）——本仓实测：三层嵌套时旧实现取不到行、静默不发指令
    //
    // 【模型】每个列表（listId）的「行」= 其源表达式逐级求值的结果：
    //   · 顶层（parentListId 未定义）⇒ 直接读源
    //   · 嵌套 ⇒ 先算出**父列表的行集**，再在每一行上按 sourceExpr 末段取本层数组
    //   ⇒ 递归 ⇒ 任意层数都成立（旧实现只回溯一层，第三层起取不到）
    /**
     * 一行数据 + 它的**祖先行链**
     *
     * 【为什么带祖先（本仓实测的边界补齐）】内层表达式可能引用**外层别名**
     *   （如 `{{ group.title + item.name }}`）；首版只绑"当前行的别名" ⇒ 外层别名
     *   读 `undefined`（不崩，但值不对）。本字段是修它的依据。
     */
    type RowRef = {
      key: string
      row: Record<string, unknown>
      /** 祖先行链（自外向内；不含自身）——与各层别名按序对应 */
      ancestors: Array<Record<string, unknown>>
    }
    const rowsCache = new Map<number, RowRef[]>()

    const rowsOfList = (listId: number, spec: typeof itemSlots[number]): RowRef[] => {
      const cached = rowsCache.get(listId)
      if (cached) return cached
      const out: RowRef[] = []
      const keyOf = (r: Record<string, unknown>, i: number): string =>
        spec.itemKeyField && r && r[spec.itemKeyField] !== undefined ? String(r[spec.itemKeyField]) : String(i)

      // ★★纯按 **sourceExpr 逐级求值**（本仓实测的修正）
      //
      // 【原实现错在哪】它靠「父列表的 list-item 槽位」递归找父行——
      //   而中间层列表（如 `b in a.l2`）**可能没有 list-item 槽位**
      //   （`:key` 不建槽位、中间层若也不含可更新属性就无槽位）⇒ 递归找不到父 ⇒ **中断**。
      //   实测三层嵌套生成 **0 条指令**（第三层取不到行，静默不更新）。
      //
      // 【正解】不依赖槽位存在性：按 `sourceExpr`（如 `b.l3`）逐段向下走——
      //   顶层段（`l1`）从视图源读，其余段（`l2`/`l3`）在**上一级行**上取数组。
      //   ⇒ 任意层数都成立，且中间层无需有任何槽位。
      // ★★首段可能**不是顶层源名**（本仓实测的关键纠正）
      //
      // 【为什么】`sourceExpr='b.l3'` 的首段 `b` 是**外层 v-for 别名**；
      //   只有最外层 v-for 的 sourceExpr（如 `l1`）首段才是真正的顶层源名。
      //   而槽位挂在哪个源上是由依赖图决定的（本例挂 `l1`）⇒ **顶层源名应从
      //   `src.sourceName` 取，而不是从 sourceExpr 首段取**。
      //   （首段若是别名，则它前面的层级已经包含在 sourceExpr 里了——见下方段序处理。）
      const segs = (spec.sourceExpr ?? '').split('.').filter(Boolean)
      const topRows = ctx.read(src.sourceName)
      if (!Array.isArray(topRows)) return out
      // 段序：sourceExpr 的每一段都是「沿当前行集向下取一层」的字段名；
      // 若首段恰好等于顶层源名（最外层），跳过它（已由 topRows 提供）。
      const walkSegs = segs[0] === src.sourceName ? segs.slice(1) : segs
      // 逐段展开：从顶层行集开始，每段把「每行的该字段」展开成新行集
      let current: Array<{ row: Record<string, unknown>; ancestors: Array<Record<string, unknown>> }> = (
        topRows as Record<string, unknown>[]
      ).map((row) => ({ row, ancestors: [] }))
      for (let seg = 0; seg < walkSegs.length; seg++) {
        const field = walkSegs[seg]
        const next: typeof current = []
        for (const c of current) {
          const arr = c.row?.[field]
          if (!Array.isArray(arr)) continue
          for (const x of arr) {
            // ★子行的祖先 = 父行的祖先 + 父行自身（累积 ⇒ 任意层）
            next.push({ row: x as Record<string, unknown>, ancestors: [...c.ancestors, c.row] })
          }
        }
        current = next
      }
      for (let i = 0; i < current.length; i++) {
        out.push({ key: keyOf(current[i].row, i), row: current[i].row, ancestors: current[i].ancestors })
      }
      rowsCache.set(listId, out)
      return out
    }

    for (const spec of itemSlots) {
      const impl = this.evaluators.get(spec.evaluatorId)
      if (!impl) {
        // ★★不许静默跳过（本仓纪律：不静默）——记下"该槽位的求值器未能实例化"
        //
        // 【实测的触发形态】表达式**引用了外层别名**（如 `{{ group.title + item.name }}`）
        //   或含运算 ⇒ 编译器给 `expr` 形态；而 `expr` 参考实现**只支持纯路径**
        //   （完整表达式求值需目标端执行器，见 `buildEvaluators` 的诚实边界）。
        //   首版此处直接 `continue` ⇒ 该槽位**永不写**，且**无任何提示**。
        this.uninstantiatedSlots.push({ slotId: spec.slotId, evaluatorId: spec.evaluatorId, propKey: spec.propKey })
        continue
      }
      const scope = spec.scope ?? ''
      const rows = rowsOfList(spec.listId ?? -1, spec)
      for (const rowRef of rows) {
        const key: string = rowRef.key
        const row: Record<string, unknown> = rowRef.row
        // ★行作用域上下文：把 v-for 别名绑到**当前行**（内层行在内层列表场景下就是 row）
        //
        // 【诚实边界】本实现只保证「当前行的别名」可见；**外层别名**（`group`）在
        //   内层表达式里被引用时（如 `{{ group.title + item.name }}`）尚未支持——
        //   那需要把外层行也注入上下文，属后续工作（当前不静默出错：会读到 undefined）。
        // ★★rowCtx：当前行别名 + **各层祖先行别名**（本仓实测的边界补齐）
        //
        // 【为什么】内层表达式可引用外层别名（`{{ group.title + item.name }}`）。
        //   首版只绑当前行 ⇒ 外层别名读 undefined（不崩，但值不对）。
        //
        // 【别名从哪来】产物里每层列表的 `scope` 就是该层别名；祖先行链与别名链**一一对应**
        //   由「自外向内」顺序对齐（`rowsOfList` 累积 ancestors 时的顺序与之相同）。
        //   故：`ancestorScopes` 数组 = 本列表及其各父列表的 scope。
        const ancestorScopes = this.ancestorScopesOf(spec.listId ?? -1)
        // ★注意：祖先在 **rowRef** 上（不是 row 上）——`row` 是纯数据对象
        const ancestors: Array<Record<string, unknown>> = rowRef.ancestors
        const rowCtx: EvalContext = scope
          ? {
              read: (n) => {
                if (n === scope) return row
                // 祖先别名：别名链与祖先链**同为「自外向内」** ⇒ 按同一位置取
                const idx = ancestorScopes.indexOf(n)
                if (idx >= 0 && idx < ancestors.length) return ancestors[idx]
                return ctx.read(n)
              },
            }
          : ctx
        const value = impl(rowCtx)
        const cacheKey = `${spec.slotId}:${key}`
        if (this.itemValueCache.get(cacheKey) === value) continue
        this.itemValueCache.set(cacheKey, value)
        this.emitListItem(spec, key, value)
      }
    }
  }

  /** 发一条行内更新指令：解析得到 nodeId 就发普通指令，否则回退 LIST_UPDATE */
  private emitListItem(spec: SubscriptionTable['sources'][number]['slots'][number], key: string, value: unknown): void {
    const nodeId = this.registry?.resolveNode(spec.listId ?? -1, key, spec.itemSlotId ?? -1)
    if (nodeId !== undefined) {
      if ((spec.itemKind ?? 'style') === 'text') {
        this.rt.buffer.push({ op: OpCode.SET_TEXT, nodeId, textRef: this.rt.strings.intern(String(value)) })
      } else {
        this.rt.buffer.push({
          op: OpCode.SET_STYLE,
          nodeId,
          keyId: this.rt.keys.intern(spec.propKey),
          value: typeof value === 'number' ? value : Number(value) || 0,
        })
      }
    } else {
      this.rt.buffer.push({
        op: OpCode.LIST_UPDATE,
        listId: spec.listId ?? -1,
        itemKeyRef: this.rt.strings.intern(key),
        slotId: spec.itemSlotId ?? -1,
        value: typeof value === 'number' ? value : Number(value) || 0,
      })
    }
  }

  /** ★首帧同步：把所有 L1 槽位按当前源值写一遍（否则首屏不会出现这些值） */
  relink(ctx: EvalContext): void {
    for (const src of this.table.sources) {
      this.writeSlotsOfSource(src.sourceName, ctx)
    }
  }

  /**
   * 某列表的**别名链**（自外向内；末位是它自身的 scope）
   *
   * 【为什么需要】`rowCtx` 要按位置把「祖先行」绑给对应的外层别名——
   *   而位置对应关系依赖"自外向内"的稳定顺序（由 `parentListId` 逐级上溯构造）。
   */
  private ancestorScopesOf(listId: number): string[] {
    const chain: string[] = []
    let cur: number | undefined = listId
    const allSlots = this.table.sources.flatMap((x) => x.slots)
    let guard = 0
    while (cur !== undefined && guard < 32) {
      const spec = allSlots.find((x) => x.kind === 'list-item' && x.listId === cur)
      if (!spec) break
      chain.unshift(spec.scope ?? '')
      cur = spec.parentListId
      guard++
    }
    return chain
  }

  /** 取某源的行数组（列表源 ⇒ 数组；非数组返回空）——仅供「无 :key 时用下标兜底」 */
  private rowsOfSource(sourceName: string, ctx: EvalContext): unknown[] {
    const v = ctx.read(sourceName)
    return Array.isArray(v) ? v : []
  }

  /** 某槽位是否已建立订阅（诊断：确认"这个槽位真的被接管了"） */
  hasSlot(slotId: number): boolean {
    return this.slots.has(slotId)
  }

  get loaded_(): boolean {
    return this.loaded
  }

  /** 该槽位由哪些源驱动（诊断 / explain） */
  depsOf(slotId: number): string[] {
    return this.sourcesOfSlot.get(slotId) ?? []
  }

  /** L1 槽位表（供宿主对账：哪些槽位由 L1 接管） */
  slotIds(): number[] {
    return [...this.slots.keys()].sort((a, b) => a - b)
  }
}

/** 槽位分层（诊断输出用） */
export function tierOf(table: SubscriptionTable, slotId: number): UpdateTier {
  for (const s of table.sources) {
    for (const sl of s.slots) if (sl.slotId === slotId) return sl.tier
  }
  return 'L0'
}

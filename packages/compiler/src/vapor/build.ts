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
import { isPureCallExprName } from '@proteus-vue/slot-runtime'
import { scanReactiveSources } from './sources'
import { compileExpr } from './expr'
import type { ReactiveSource } from './sources'
import { analyzeExprDeps, collectTemplateBindings } from './deps'
import type { ExprDeps, TemplateBindingRef } from './deps'
// ★混合文本合成绑定（P2-2）：段表来自**模板产物**（唯一实现）——不在此处重算切分
import { buildLayoutTemplate } from './template'
import type { TextSegment } from '@proteus-vue/slot-runtime'
// ★P1-3 生命周期：脚本级钩子诊断要读 `<script setup>` 源码（复用唯一的 SFC 解析入口）
import { parse as sfcParse } from '@vue/compiler-sfc'

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
  /** ★批次 9：设计令牌表（`--name`→值）——SFC 内 `var()` 编译期折叠（与屏内容路径同源） */
  tokens?: Record<string, string>
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
  // ★批次 30（对齐 Web · 削减胶水）：动态 `:class`——规则表（下面块内捕获）+ 是否真的用到
  let tplDynamicClassRules: import('./template').DynamicClassRule[] | undefined
  const hasDynamicClass = bindings.some((b) => b.propKey === 'paint.class')
  /* ═══════════ ★★★P1-3 生命周期诊断（2026-10-03）═══════════
   *
   * 【为什么必须有（本仓实测的静默缺陷）】Vapor 的分工是"**端上不执行 script**"
   *   （见 entry-vapor 头注：脚本逻辑在构建期抽数据快照，端上只实例化模板）。
   *   而 `onMounted(() => { count.value = 99 })` 这类**脚本级钩子**写起来毫无征兆：
   *   编译期零诊断、端上不执行 ⇒ **钩子里的事永远不会发生**，且没有任何提示。
   *   ⇒ 本诊断把"钩子不会运行"变成可见的（并给出替代路径：模板 vnode 钩子 `@vue:mounted`，
   *     它是**模板产物**、端上真执行）。
   *   ★脚本级钩子的完整支持（把钩子体编成动作表在端上跑）为独立批次——需要
   *     "钩子体语句 → 动作"的编译通道（与 handler 动作表同族，但生命周期顺序语义更复杂）。
   */
  {
    const SCRIPT_HOOKS = ['onMounted', 'onUnmounted', 'onBeforeMount', 'onBeforeUnmount', 'onUpdated', 'onActivated', 'onDeactivated']
    let scriptSrc = ''
    try {
      // 复用唯一的 SFC 解析入口（与 sources.ts 同一处置；解析失败已在上游拦下）
      const desc = (opts.compat?.sfcParse ?? sfcParse)(source, { filename }).descriptor
      scriptSrc = desc.scriptSetup?.content ?? desc.script?.content ?? ''
    } catch {
      scriptSrc = ''
    }
    for (const hook of SCRIPT_HOOKS) {
      // 词边界匹配（防 `myonMounted` 误报）；`import { onMounted }` 单独出现不算调用
      const re = new RegExp(`(^|[^\\w$.])${hook}\\s*\\(`)
      if (!re.test(scriptSrc)) continue
      const supported = hook === 'onMounted'
      diagnostics.push({
        severity: 'warn',
        code: 'VAPOR_SCRIPT_LIFECYCLE_NOT_RUN',
        message: `脚本级 \`${hook}\` 不会在端上运行（Vapor 不执行 script——见端上分工）`,
        hint:
          `把该钩子的逻辑改写为**模板 vnode 钩子**（如 \`<p-view @vue:mounted="..." />\`）` +
          (supported
            ? '——`@vue:mounted` 已真支持（动作表 + 首帧 mount 后触发）'
            : '（本版只支持 @vue:mounted）'),
      })
    }
  }
  // ★★**混合文本的合成绑定**（2026-10-03 · P2-2）：`a{{x}}b` 的插值子节点在 `collectTemplateBindings`
  //   里是**独立**的 `text.content` 绑定（每个插值一条）⇒ 两条问题：
  //     ① 它们都指向**同一个节点**（元素级）⇒ 运行时会发**两条** SET_TEXT，**后者覆盖前者**
  //        （现象：只显示最后一个插值，且无报错——静默错内容）；
  //     ② 静态段（`a` / `b`）完全不参与 ⇒ 文本永远缺前后缀。
  //   ⇒ 正解：从**模板产物**取该节点的 `textSegments`，把**该元素上的全部插值绑定**合并成
  //     **一条合成绑定**（源码 = `'a' + (x) + 'b'`，走表达式编译器 ⇒ 与单段插值同一套求值）。
  //     **同一语义一处实现**：合成的表达式文本为此后唯一入口，独立绑定不再各发一条。
  //   ★单段插值（`{{ x }}`，无静态段）**不合成**——产物与既有逐字节一致（既有回归锁）。
  const textSegsByNode = new Map<number, TextSegment[]>()
  {
    const tplRes = buildLayoutTemplate(source, filename, opts.compat, opts.tokens)
    // ★批次 30：捕获动态类规则（同一次模板产物，零额外开销）
    tplDynamicClassRules = tplRes.dynamicClassRules
    for (const n of tplRes.template.nodes) {
      if (n.textSegments && n.textSegments.length > 0) textSegsByNode.set(n.id, n.textSegments)
    }
  }
  /** 节点 id → 各插值绑定（按出现序）——按元素聚组后决定"合成"还是"原样" */
  const textBindingsByNode = new Map<number, TemplateBindingRef[]>()
  for (const ref of bindings) {
    if (ref.propKey !== 'text.content' || ref.where !== '{{ }}') continue
    const list = textBindingsByNode.get(ref.elementIndex) ?? []
    list.push(ref)
    textBindingsByNode.set(ref.elementIndex, list)
  }
  /** 该绑定是否属于"被合成"的一组（合成后由合成绑定代表；原独立绑定跳过建槽） */
  const synthesizedMembers = new Set<TemplateBindingRef>()
  for (const [nodeId, refs] of textBindingsByNode) {
    const segs = textSegsByNode.get(nodeId)
    if (!segs) continue // 单段插值（无静态段）⇒ 不合成
    // 该元素的**表达式段源码**（与 refs 按出现序对应——两者都来自同一份模板的子节点序）
    const exprSrcs = segs.filter((s) => 'expr' in s).map((s) => (s as { src: string }).src)
    if (exprSrcs.length !== refs.length) continue // 形态不匹配（防御：不合成，保持既有行为）
    // 合成源码：静态段 → 字符串字面量，表达式段 → 括号包裹的原码（保优先级）
    const parts = segs.map((s) => ('text' in s ? JSON.stringify(s.text) : `(${(s as { src: string }).src})`))
    // ★单表达式段且无静态段（`{{ a }}` 且只有它）⇒ 不必合成（产物更小、与既有形态一致）
    if (parts.length === 1) continue
    const composedSrc = parts.join(' + ')
    // 用第一个成员的身份承载合成绑定（nodeId/propKey/scopes/listContext 都正确）
    const first = refs[0]!
    const synthetic: TemplateBindingRef = { ...first, code: composedSrc }
    for (const r of refs) synthesizedMembers.add(r)
    bindings[bindings.indexOf(first)] = synthetic
  }
  // ★★P2-5：**memo 组依赖表**（`v-memo="[a, b]"` 的依赖程序）——按 memoId 去重收集
  //
  // 【为什么在编译期编成程序】运行时"依赖变了没有"要**逐项比较**；比较的输入是求值结果，
  //   而求值必须走同一套表达式执行器（可序列化、跨端禁 eval）⇒ 依赖也编成 ExprProgram。
  // 【不支持的形态】依赖不是数组字面量 / 单项编不出 ⇒ 产诊断 + **不建组**
  //   （不建组 = 该子树照常更新——"少一层优化"而不是"错"；与修法提示一致）。
  const memoGroups: import('@proteus-vue/slot-runtime').MemoGroup[] = []
  const memoSeen = new Set<number>()
  // ★非法形态（非数组字面量）⇒ 诊断（模板产物侧已有同类诊断；订阅产物侧也报，因为
  //   "优化没生效"必须在自己这张产物上可见——门禁/工具可能只读订阅产物）
  const memoInvalidSeen = new Set<number>()
  for (const ref of bindings) {
    if (ref.memoInvalid && !memoInvalidSeen.has(ref.elementIndex)) {
      memoInvalidSeen.add(ref.elementIndex)
      diagnostics.push({
        severity: 'warn',
        code: 'VAPOR_MEMO_SHAPE',
        message: `v-memo（元素 ${ref.elementIndex}）的依赖需为数组字面量（如 v-memo="[a, b]"）——当前形态无法静态建依赖表`,
        hint: '把依赖写成数组字面量，或去掉 v-memo（该子树会照常更新，仅少一层优化）',
      })
    }
  }
  for (const ref of bindings) {
    if (!ref.memo || memoSeen.has(ref.memo.memoId)) continue
    if (ref.listContext) {
      // v-for 行内 + v-memo：组依赖是**行作用域**表达式 ⇒ 需要按行比较（本版未做）
      diagnostics.push({
        severity: 'warn',
        code: 'VAPOR_MEMO_IN_LIST',
        message: `v-memo 用在 v-for 行内（元素 ${ref.elementIndex}）——行作用域的依赖比较未支持`,
        hint: '该子树会照常更新（仅少一层优化）；如必须，请把 v-memo 提到列表外层元素',
      })
      memoSeen.add(ref.memo.memoId)
      continue
    }
    const deps: import('@proteus-vue/slot-runtime').ExprProgram[] = []
    let failed: string | undefined
    for (const src of ref.memo.deps) {
      const c = compileExpr(src)
      if (c.ok) deps.push(c.program)
      else {
        failed = `${src}（${c.unsupported}）`
        break
      }
    }
    if (failed) {
      diagnostics.push({
        severity: 'warn',
        code: 'VAPOR_MEMO_DEP_UNSUPPORTED',
        message: `v-memo 依赖无法编译：${failed}`,
        hint: '依赖需为可静态求值的表达式（成员/算术/比较/逻辑）——该子树会照常更新（仅少一层优化）',
      })
      memoSeen.add(ref.memo.memoId)
      continue
    }
    memoGroups.push({ memoId: ref.memo.memoId, deps, depsSrc: [...ref.memo.deps] })
    memoSeen.add(ref.memo.memoId)
  }
  // ★v-once 在 v-for 行内：官方语义是**共享缓存槽**（首项内容冻结后复用给所有行）——
  //   反直觉且与"每行独立冻结"差很远 ⇒ 明确诊断（不照抄、不静默按行冻结）
  for (const ref of bindings) {
    if (ref.once && ref.listContext && !ref.listContext.isKeyBinding) {
      diagnostics.push({
        severity: 'warn',
        code: 'VAPOR_ONCE_IN_LIST',
        message: `v-once 用在 v-for 行内（元素 ${ref.elementIndex}）——行内 once 语义（官方为共享缓存槽）未支持`,
        hint: '该绑定会随行数据正常更新（仅少一层优化）；静态内容请去掉插值',
      })
      break // 每个模板报一条即可（避免同子树刷屏）
    }
  }

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
  // ★★★P1-3 作用域插槽（2026-10-03）：父级 `#x="sp"` 内容里引用 `sp.*` 的绑定——
  //   没有可订阅的源（出口 props 分发时才算得出）⇒ 单列本表，实例化期**分发时求值**。
  //   见 `SubscriptionTable.slotScopedSlots` 注释（含诚实边界：只做初始分发）。
  const slotScopedSlots: NonNullable<SubscriptionTable['slotScopedSlots']> = []
  // ★★★P3 动态组件（2026-10-03）：`<component :is="expr">` 的组件名表达式——实例化期解析。
  const componentIs: NonNullable<SubscriptionTable['componentIs']> = []

  for (const ref of bindings) {
    // ★被合成组里的其余成员**跳过建槽**（合成绑定已代表整条文本；见上方合成段注释）
    if (synthesizedMembers.has(ref)) continue
    // ★★P2-7：真动态属性名（`:[]` 标记绑定）⇒ 诊断 + **不建槽位**（键名运行时才知——
    //   建出来也是永不生效的垃圾键；模板产物侧同样有一条诊断）
    if (ref.propKey === 'attr.__dynamic__') {
      diagnostics.push({
        severity: 'warn',
        code: 'VAPOR_DYNAMIC_ATTR',
        message: `动态属性名在元素 ${ref.elementIndex} 上未支持（键名运行时才知 ⇒ 无法静态建槽位）`,
        hint: "字符串字面量形态可直接用（如 :['width'] 编译期等价于 :width）；真动态键名请改用静态属性名或条件分支",
      })
      continue
    }
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
    // ★★P2-8（2026-10-03）：**白名单内建纯函数**（`Math.round` 等）与**人工担保**（`@proteus-pure`）
    //   走同一条"非静态但可信"通道；
    //   区分如下（两者都置 forcePure，但来源不同 —— explain 的 reason 会写明）：
    //     · 内建白名单 ⇒ **语言级静态可证**（表在 slot-runtime/PURE_CALLS，跨端语义一致）
    //     · pureSymbols ⇒ **开发者承诺**（人工担保）
    const builtinPure = deps.calls.length > 0 && deps.calls.every((c) => isPureCallExprName(c))
    // 内建白名单之外若还有人工担保符号 ⇒ 仍然是 forcePure（人工承诺）而非 builtinPure
    const allCallsWhitelisted = deps.calls.length > 0 && deps.calls.every((c) => pure.has(c) || isPureCallExprName(c))
    const onlyBuiltin = builtinPure
    const decision = decideTier({
      pureExpression: !deps.hasCall,
      // ★P2-8：内建白名单（静态可证）与人工担保（@proteus-pure）**分开上报**——explain 要能区分
      builtinPure: onlyBuiltin,
      forcePure: allCallsWhitelisted && !onlyBuiltin,
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
    // ★★★**动态组件 `:is`**（P3 批次，2026-10-03）：该绑定**不是渲染槽位**——它是"选哪个组件"，
    //   要在实例化期解析。⇒ 记进 `componentIs` 表后 `continue`（不建 sources/constantSlots 槽位）。
    //   【为什么必须单列（本仓实测的静默丢弃）】此前它既不进任何表、也**无诊断** ⇒
    //     `<component :is>` 渲染成空壳且零提示（最危险的一类静默）。
    if (ref.propKey === 'attr.is' && ref.tag === 'component') {
      componentIs.push({ nodeId: myNode, evaluatorId, expr: ref.code })
      notes.push(`slot_${mySlot} 动态组件 \`:is="${ref.code}"\` ⇒ 实例化期解析组件名（见 componentIs 表）`)
      decisions.push({
        slotId: mySlot,
        snippet: `${ref.where}="${ref.code}"`,
        tier: 'L1',
        reason: '动态组件 :is（实例化期解析——非渲染槽位）',
        mark: '✓',
      })
      continue
    }
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
        hint:
          '该槽位在参考实现下不会更新（各端可注入自己的表达式执行器）；' +
          '或改写为受支持的子集（白名单内建纯函数见 slot-runtime/expr.ts 的 PURE_CALLS）',
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
    if (ref.listContext?.isKeyBinding || ref.propKey === 'attr.key') {
      // :key 不建槽位（非渲染属性）——跳过但要留痕，便于 explain 追查
      //
      // ★★2026-10-03 修（P2-5 实测抓出的潜在缺陷）：**非列表**元素上的 `:key`（如
      //   `<p-text :key="'memo'">`）此前**会建槽位**（`attr.key` → kind='prop'）
      //   ⇒ 运行时 `toF32('memo')` **抛错**（prop 槽位只接受数值）——或若值是数字，
      //     则向宿主发一条**无意义**的 SET_PROP。`:key` 在任何位置都**不是可渲染属性**
      //     （它只是 diff 提示）⇒ 统一跳过（不只列表内）。
      const inList = Boolean(ref.listContext?.isKeyBinding)
      notes.push(`:key="${ref.code}" 不建槽位（${inList ? '行标识字段' : 'diff 提示'}，非可更新渲染属性）`)
      diagnostics.push({
        severity: 'info',
        code: 'VAPOR_KEY_IS_ROW_IDENTITY',
        message: `:key="${ref.code}" 用作${inList ? '行标识字段' : ' diff 提示'}（非可更新渲染属性）`,
      })
      continue
    }

    // ★★`list-data` 槽位必须带 `listId`（2026-10-03 嵌套批次实测修正）：
    //   运行时 `rowsOfList(listId, ...)` 按它找数据源——缺它 ⇒ 一律 `undefined` ⇒
    //   嵌套列表（以及"行内无绑定的外层列表"）**整行不展开**（实测：外层 li 全丢）。
    //   ★单层列表既有行为不变：listId 本就是该列表自己的 id。
    const slot: SlotSubscription = {
      slotId: mySlot,
      nodeId: myNode,
      evaluatorId,
      tier: decision.tier,
      kind,
      propKey: ref.propKey,
      // ★list-data（v-for 源绑定）用 **ownListId**；行内绑定用 listContext.listId
      ...(kind === 'list-data' ? { listId: ref.ownListId ?? ref.listContext?.listId } : {}),
      // ★★P2-5（v-once / v-memo）：标记随槽位进产物（缺省省略字段 ⇒ 既有产物不变）
      ...(ref.once ? { once: true } : {}),
      ...(ref.memo ? { memoId: ref.memo.memoId } : {}),
    }
    slotRecords.push({ slot, deps, ref })

    const snippet = `${ref.where}="${ref.code}"`
    decisions.push({ slotId: mySlot, snippet, tier: decision.tier, reason: decision.reason, mark: decision.forced ? '⚠' : decision.tier === 'L1' ? '✓' : '✗' })

    if (decision.tier === 'L0') {
      l0Slots.push({ slotId: mySlot, nodeId: myNode, propKey: ref.propKey, reason: decision.reason })
      continue
    }

    // Step 3：依赖图（sourceId → slots）
    // ★★P2-5（关键）：memo **依赖的根也必须在订阅图里**——否则"依赖变了"不触发求值
    //   ⇒ 该子树静默不更新（组语义的反面：本该更新的却漏了）。
    const depRoots = ref.memo
      ? ref.memo.deps.flatMap((d) => analyzeExprDeps(d, ref.scopes).roots)
      : []
    const allRoots = [...new Set([...deps.roots, ...depRoots])]
    const roots = allRoots.filter((r) => srcScan.byName.has(r))
    const missing = allRoots.filter((r) => !srcScan.byName.has(r))
    if (missing.length > 0) notes.push(`slot_${mySlot} 引用未识别标识符：${missing.join(', ')}（已计入 L1，若为运行时值请加 @proteus-pure 或降级）`)
    for (const rootName of roots) {
      const src = srcScan.byName.get(rootName)!
      const list = slotsBySource.get(src.sourceId) ?? []
      list.push(slot)
      slotsBySource.set(src.sourceId, list)
    }
    // ★进入条件：**成员链**相对路径（`item.x` / `sp.x`）**或**裸作用域引用（解构后的 `count`）
    //   —— 后者此前没有入口（`listRelative` 只收成员链）⇒ 解构依赖完全不可见（实测）。
    if (deps.listRelative.length > 0 || (deps.scopeRefs ?? []).length > 0) {
      // ★★★**两类相对路径必须区分**（P1-3 作用域插槽，2026-10-03）：
      //   · **v-for 行相对**（`item.title`）⇒ 归属该列表源，由 LIST_UPDATE 承接（既有行为）；
      //   · **插槽作用域相对**（`sp.count`，`sp` 来自 `#x="sp"`）⇒ 没有可订阅的源——
      //     出口 props 在**分发时**才算得出来（见 SubscriptionTable.slotScopedSlots）。
      //   ★判别：v-for 别名一定在 `scopeSources` 里（建行上下文时写入），插槽作用域变量**不在**
      //     （depper 只把它加进 `scopes` 用于屏蔽幽灵源）。
      //   【为什么必须分开（本仓实测的静默丢弃）】此前两者都进"列表相对"分支 ⇒ 插槽作用域
      //   路径找不到源 ⇒ 只留一条误导性的"未挂到任何列表源"警告，**绑定整条消失** ⇒
      //   `:width="sp.w"` 静默不生效（产物里连槽位都没有）。
      const rowRels = deps.listRelative.filter((r) => ref.scopeSources[r.scope] !== undefined)
      const slotRels = deps.listRelative.filter((r) => ref.scopeSources[r.scope] === undefined)
      // ★★**裸作用域引用**（2026-10-03 · 解构批次）：解构后内容是裸标识符（`{{ count }}`、
      //   `dw as number` 里的 `dw`）——它们不进 `listRelative`（那只收 `sp.w` 成员链）
      //   ⇒ 此前**完全不被识别为插槽作用域依赖** ⇒ 分发时求值不覆盖 ⇒ 静默空值（实测）。
      //   判别与上面同源：v-for 别名在 `scopeSources` 里、插槽作用域变量不在。
      const slotRefs = (deps.scopeRefs ?? []).filter((nm) => ref.scopeSources[nm] === undefined)
      const scopedHits = [...slotRels.map((r) => r.scope), ...slotRefs]
      if (scopedHits.length > 0) {
        slotScopedSlots.push({
          slotId: mySlot,
          nodeId: myNode,
          propKey: ref.propKey,
          evaluatorId,
          scope: scopedHits[0]!,
        })
        notes.push(
          `slot_${mySlot} 依赖**插槽作用域** ${[...slotRels.map((r) => r.path), ...slotRefs].join(', ')}` +
            `（${scopedHits[0]} 来自 \`#x="${scopedHits[0]}"\`）⇒ 分发时求值（见 slotScopedSlots）`,
        )
      }
      // ★列表相对路径：归属**该列表的源**（`item` → `list`），由 LIST_UPDATE 承接（V1 已实现指令）。
      //
      // 【本仓实测的坑】首版直接拿 scope 名（`item`）去找同名源 ⇒ 找不到 ⇒ **这条绑定从依赖图里消失**
      //   （现象：槽位标了 L1，但依赖图里没有它 = 运行时那个源变化不会写这个槽位 → 静默不更新）。
      //   正解：走 `scopeSources` 别名映射（`item` → `list`）回到真正的列表源。
      const listRoots = [...new Set(rowRels.map((r) => ref.scopeSources[r.scope] ?? r.scope))]
      let hooked = 0
      for (const rootName of listRoots) {
        const src = srcScan.byName.get(rootName)
        if (!src) continue
        const list = slotsBySource.get(src.sourceId) ?? []
        if (!list.some((x) => x.slotId === mySlot)) list.push(slot)
        slotsBySource.set(src.sourceId, list)
        hooked++
      }
      if (hooked === 0 && rowRels.length > 0) {
        notes.push(`★slot_${mySlot} 依赖列表相对路径 ${rowRels.map((r) => r.path).join(', ')} 但**未挂到任何列表源**（scopeSources=${JSON.stringify(ref.scopeSources)}）——请检查 v-for 形态`)
        diagnostics.push({
          severity: 'warn',
          code: 'VAPOR_LIST_BINDING_NOT_HOOKED',
          message: `slot_${mySlot} 的列表相对路径未挂到任何列表源`,
          hint: '该槽位不会被任何源驱动 ⇒ 可能静默不更新；请检查 v-for 形态（如 v-for 是否写在正确的元素上）',
          slotId: mySlot,
        })
      } else if (hooked > 0) {
        notes.push(`slot_${mySlot} 依赖列表相对路径 ${rowRels.map((r) => r.path).join(', ')} ⇒ 归属列表源 ${listRoots.join('/')}，由 LIST_UPDATE 承接（item 级）`)
      }
    }
  }

  // ★★P2-8：**常量槽位**收集（无源依赖 ⇒ 不进 sources，但必须参与首帧回填——见 constantSlots 注释）
  const constantSlots: SlotSubscription[] = []
  const slotScopedIds = new Set(slotScopedSlots.map((s) => s.slotId))
  for (const rec of slotRecords) {
    if (rec.slot.kind === 'list-item' || rec.slot.kind === 'list-data') continue
    // ★P1-3 作用域插槽绑定**不是常量**：它依赖分发时才存在的出口 props（见 slotScopedSlots）
    if (slotScopedIds.has(rec.slot.slotId)) continue
    const rootsOf = rec.deps.roots.filter((r) => srcScan.byName.has(r))
    const listRel = rec.deps.listRelative.length > 0
    if (rec.slot.tier === 'L1' && rootsOf.length === 0 && !listRel && rec.deps.calls.length === 0) {
      constantSlots.push(rec.slot)
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
      // ★P2-5：memo 组表（无 v-memo ⇒ 不产出字段，既有产物逐字节不变）
      ...(memoGroups.length > 0 ? { memoGroups } : {}),
      // ★P2-8：常量槽位（无 ⇒ 不产出字段）
      ...(constantSlots.length > 0 ? { constantSlots } : {}),
      // ★P1-3 作用域插槽（无 ⇒ 不产出字段——既有产物逐字节不变）
      ...(slotScopedSlots.length > 0 ? { slotScopedSlots } : {}),
      // ★P3 动态组件 `:is`（无 ⇒ 不产出字段）
      ...(componentIs.length > 0 ? { componentIs } : {}),
      // ★批次 30：动态 `:class` 自匹配类规则（**仅在存在动态 :class 且规则非空时**发射——既有产物逐字节不变）
      ...(hasDynamicClass && (tplDynamicClassRules?.length ?? 0) > 0 ? { classRules: tplDynamicClassRules } : {}),
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
  // ★★P2-8/P2-9（2026-10-03）：**已知内置全局**不得走下面的 `member` 快捷路径——
  //   那条路的实现是 `ctx.read('Math')`，运行时恒为 **undefined**（模板上下文只有业务源）
  //   ⇒ `Math.PI` 会**静默渲染成空**、`Math.round(...)` 同理。
  //   ⇒ 全局形态一律交给 `compileExpr`（常量内联 / 白名单调用 / 已知全局成员拒绝）。
  const isKnownGlobalExpr = /^(Math|JSON|Number|String|Boolean|Array|Object|Date|RegExp|Intl|console)\b/.test(trimmed)
  if (isKnownGlobalExpr) {
    const compiledGlobal = compileExpr(trimmed)
    if (compiledGlobal.ok) {
      return { spec: { evaluatorId, form: 'program', program: compiledGlobal.program, pure: true } }
    }
    return { spec: { evaluatorId, form: 'expr', expr: trimmed, pure: false }, unsupported: compiledGlobal.unsupported }
  }
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
  // ★组件 props（P1 组件系统）：`component.<name>` → component-prop 槽位
  //   ⇒ 运行时发 CALL_COMPONENT_UPDATE（opcode 已存在；内核侧"s 需组件边界调度"是**预期**——
  //     该指令由**宿主/组件运行时**消费，不归内核几何。）
  if (propKey.startsWith('component.')) return 'component-prop'
  return 'prop'
}

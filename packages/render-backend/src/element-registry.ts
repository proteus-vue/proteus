// packages/render-backend/src/element-registry.ts
// ★★★决策 #1081 / #1082（2026-10-19）：**元素身份索引 + 选择器匹配**——`useElement` 选择器通路的映射层。
//
// 【它解决什么（取证 + 用户指定）】
//   用户 2026-10-19：「这个选择器正常应该是通过 vue 自定义渲染通道做映射吧？因为拿到的肯定是 vue 元素信息
//   不是原生元素信息」+「验证通路没问题后真正落地就需要和 web 的查询结构保持同步了」。
//   `useElement('#hero')` 里的选择器是**元素层**的名字，引擎只认**数字节点 id** ⇒ 映射必须发生在
//   **知道元素身份的那一层**。两条渲染链各有一个这样的层，都往**同一个索引**写：
//     · **Vapor 链**（superapp 实际走的）：`instantiateTemplate()` 产 `InstantiatedNode[]`，
//       编译器把静态 id/class/data-* 透传（见 `LayoutNode.elementId/elementClasses/elementDataset`）；
//     · **Vue 自定义渲染器链**（G-41 B3）：`createRenderer(nodeOps)` → `ProteusNodeOpsDispatcher`，
//       `patchProp(el,'id'|'class'|'data-*',…)` 与 `insert(child,parent)` 是唯一知道元素身份的位置。
//
// 【★Web 基准（用户指定：与 web 查询结构同步）】选择器语义以浏览器 `querySelector` 为准。
//   本模块实现**下列子集**，边界之外**明确拒绝**（返回 unsupported，不近似匹配——错节点比 unsupported 危险）：
//
//   | 形态 | 支持 | 说明 |
//   |---|---|---|
//   | `#id` / 裸 id | ✅ | 裸 id 是本仓既有约定（MP/web 的 `norm()` 同法） |
//   | `.class` | ✅ | 静态 class（含 `:class="'a b'"` 字面量形态，编译期折入） |
//   | `tag`（`view` / `p-text` / `*`） | ✅ | 与 Web 类型选择器同义；`*` 匹配任意元素 |
//   | 复合（`p-view.foo#bar[data-x="1"]`） | ✅ | 同一元素上多个条件**同时**满足 |
//   | 后代（`A B`） | ✅ | 祖先链任意层级 |
//   | 子（`A > B`） | ✅ | 直接父级 |
//   | 选择器列表（`A, B`） | ✅ | **文档序**取第一个命中的（与 `querySelector` 一致，不是"按列表顺序"） |
//   | `[attr]` / `[attr="v"]` / `[attr='v']` | ✅ | 属性名按 HTML `dataset` 语义比对（`data-foo-bar`） |
//   | `+` / `~`（兄弟） | ❌ | 需兄弟序；当前索引未记兄弟位置 ⇒ unsupported |
//   | 伪类/伪元素（`:hover` / `:nth-child` / `::before`） | ❌ | 无 CSS 引擎语义 ⇒ unsupported |
//   | `[attr~=v]` / `^=` / `$=` / `*=` | ❌ | 未实现 ⇒ unsupported（不悄悄按 `=` 处理） |
//
// 【文档序（为什么重要）】`querySelector` 返回**文档序第一个**匹配。Vapor 的实例化产物天然是 pre-order
//   （父在子前），但 v-for 展开/组件展开后仍保持；Vue 链由 `insert` 边还原父子关系后 DFS 求序。
//   重复 id 也按文档序取第一个（与 Web 一致；HTML 规格里重复 id 是无效文档，但浏览器不报错）。
//
// 【索引失效】Vapor 每次实例化**整桶替换**（旧树 id 已失效，合并会留幽灵条目）；
//   Vue 链由调用方在 renderer 重建时 `clearVueElementIds()`。

/** 查询来源（诊断用：能区分"命中的是 Vapor 链还是 Vue 渲染链"） */
export type ElementIndexSource = 'screen' | 'vue'

/** 一次成功的解析结果 */
export interface ElementResolution {
  /** 引擎节点 id（Vapor 链 = 内核节点 id；Vue 链 = 渲染句柄 id） */
  nodeId: number
  /** 命中来自哪条链（诊断/判据用） */
  source: ElementIndexSource
}

/** 索引里的一条元素记录（字段都是**编译期静态**身份，运行期不改） */
export interface ElementRecord {
  nodeId: number
  tag?: string
  id?: string
  classes?: string[]
  dataset?: Record<string, string>
  parentId?: number | null
}

/** 一棵已索引的树（记录表 + 注册序，用于 DFS 求文档序） */
interface ElementTree {
  records: Map<number, ElementRecord>
  /** 注册序（Vapor = 实例化数组序 = pre-order；Vue = 句柄首次出现序） */
  order: number[]
}

/** Vue 渲染链的索引：句柄 id → 记录（跨屏不冲突由调用方 clear 保证） */
const vueTree: ElementTree = { records: new Map(), order: [] }
/** Vapor 链：屏名 → 该屏当前树的索引 */
const screenTrees = new Map<string, ElementTree>()

/* ══════════════════════ 选择器解析（Web querySelector 子集） ══════════════════════ */

/** 一个复合选择器（同一元素上的全部条件） */
interface Compound {
  tag?: string
  id?: string
  classes: string[]
  attrs: Array<{ name: string; value?: string }>
}

/** 组合符：后代（' '）或子（'>'） */
type Combinator = ' ' | '>'

interface ComplexSelector {
  compounds: Compound[]
  /** `combinators[i]` 连接 `compounds[i]` 与 `compounds[i+1]` */
  combinators: Combinator[]
}

/** 选择器支持性检查结果 */
export type SelectorSupport =
  | { ok: true }
  | { ok: false; reason: string }

/** 不支持的选择器形态 → 人读原因（`useElement` 的 unsupported 消息直接用它） */
export interface SelectorParseResult {
  /** 空 = 解析失败（`reason` 有值） */
  selectors: ComplexSelector[]
  /** 不支持时的原因（对用户可见） */
  reason?: string
}

/** HTML `dataset` 命名：`data-foo-bar` ⇒ `fooBar`（与浏览器一致） */
export function datasetKeyOf(attrName: string): string {
  return attrName
    .replace(/^data-/, '')
    .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

// ★锚定 `^`：`IDENT_RE.test(text.slice(i))` 对 `#hero` 这种"非类型开头"的片段必须为 false，
//   否则 `hero` 会被误当 tag、`#hero` 的 id 凭空丢失（首次跑测试即抓到）。
const IDENT_RE = /^[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5-]*/
const CLASS_RE = /^-?[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5-]*/

/**
 * 解析选择器文本为选择器列表。
 * ★解析失败一律返回 `reason`（调用方映射成 `element.unsupported`）——**绝不**退化成"当成 id 查"。
 */
export function parseSelector(selector: string | undefined | null): SelectorParseResult {
  if (typeof selector !== 'string') return { selectors: [], reason: '选择器为空' }
  const raw = selector.trim()
  if (!raw) return { selectors: [], reason: '选择器为空' }
  // 先拒绝明确不支持的形态（给出可操作原因，而不是含糊的"解析失败"）。
  // ★顺序有讲究：属性运算符要在 `~` 兄弟检测**之前**——`[data-k~="v"]` 属于属性运算，不是兄弟选择器。
  // ★引号内的内容不参与形态检测（`[href="http://x"]` 的 `://` 不是伪元素）
  const bare = raw.replace(/(['"])(?:[^\\]|\\.)*?\1/g, '""')
  if (/::/.test(bare)) return { selectors: [], reason: '伪元素（`::before` 等）未支持：App 端无 CSS 引擎语义' }
  if (/\[[^\]]*[*^$|~]=/.test(bare)) {
    return { selectors: [], reason: '属性运算符（`~=` / `^=` / `$=` / `*=` / `|=`）未支持；请用 `[attr]` 或 `[attr="v"]`' }
  }
  if (/[+~]/.test(bare)) {
    return { selectors: [], reason: '兄弟选择器（`+` / `~`）未支持：App 端索引不记兄弟位置' }
  }
  // 伪类：` :name` 出现在开头/空白/`>`/`,` 之后，**或**紧跟在类型/`#id`/`.class`/`]` 之后（`li:nth-child`）
  // ★第二分支覆盖「类型/`#id`/`.class`/`]` 后紧跟伪类」（`li:nth-child(2)`）——
  //   字符类必须写成 `[A-Za-z0-9_\]-]`（首版误写成 `[]A-Za-z0-9_-]` = 空类 + 字面量 ⇒ 永不匹配）
  if (/(^|[\s>,(])::?[A-Za-z-]|[A-Za-z0-9_\]-]:[A-Za-z-]/.test(bare)) {
    return { selectors: [], reason: '伪类（`:hover` / `:nth-child` 等）未支持：App 端无 CSS 引擎语义' }
  }

  const selectors: ComplexSelector[] = []
  // 选择器列表：顶层逗号切分（本子集里逗号不会出现在引号内的属性值中——括号内已排除）
  for (const part of raw.split(',')) {
    const one = parseComplex(part.trim())
    if (!one) return { selectors: [], reason: `选择器解析失败：\`${part.trim().slice(0, 40)}\`` }
    selectors.push(one)
  }
  return { selectors }
}

/** 解析单个组合选择器（`A B > C`） */
function parseComplex(text: string): ComplexSelector | null {
  if (!text) return null
  const compounds: Compound[] = []
  const combinators: Combinator[] = []
  let i = 0
  let pendingComb: Combinator | null = null
  while (i < text.length) {
    // 跳过空白并判定组合符
    let sawSpace = false
    while (i < text.length && /\s/.test(text[i]!)) { sawSpace = true; i++ }
    if (i >= text.length) break
    if (text[i] === '>') {
      if (pendingComb !== null || compounds.length === 0) return null // `A > > B` / `> A`
      pendingComb = '>'
      i++
      while (i < text.length && /\s/.test(text[i]!)) i++
      if (i >= text.length) return null // 尾随 `>`
      continue
    }
    if (compounds.length > 0) {
      if (pendingComb === '>') combinators.push('>')
      else if (sawSpace) combinators.push(' ')
      else return null // `A.B` 应在同一个 compound 里被解析；走到这说明形态异常
      pendingComb = null
    }
    const parsed = parseCompound(text, i)
    if (!parsed) return null
    compounds.push(parsed.compound)
    i = parsed.next
  }
  if (compounds.length === 0 || pendingComb !== null) return null
  if (combinators.length !== compounds.length - 1) return null
  return { compounds, combinators }
}

/** 解析一个复合选择器（tag + `#id` + `.class` + `[attr]`，顺序不限） */
function parseCompound(text: string, start: number): { compound: Compound; next: number } | null {
  let i = start
  const compound: Compound = { classes: [], attrs: [] }
  let any = false
  // 类型选择器只在**开头**出现（`p-view.foo` 合法；`.foo p-view` 的 `p-view` 是新 compound）
  if (text[i] === '*') { i++; any = true }
  else if (IDENT_RE.test(text.slice(i))) {
    const m = IDENT_RE.exec(text.slice(i))!
    compound.tag = m[0]
    i += m[0].length
    any = true
  }
  while (i < text.length) {
    const c = text[i]
    if (c === '#') {
      i++
      const m = CLASS_RE.exec(text.slice(i))
      if (!m) return null
      compound.id = m[0]
      i += m[0].length
      any = true
      continue
    }
    if (c === '.') {
      i++
      const m = CLASS_RE.exec(text.slice(i))
      if (!m) return null
      compound.classes.push(m[0])
      i += m[0].length
      any = true
      continue
    }
    if (c === '[') {
      const close = text.indexOf(']', i + 1)
      if (close < 0) return null
      const body = text.slice(i + 1, close).trim()
      i = close + 1
      if (!body) return null
      const eq = body.indexOf('=')
      if (eq < 0) {
        compound.attrs.push({ name: body })
      } else {
        const name = body.slice(0, eq).trim()
        let v = body.slice(eq + 1).trim()
        const q = /^(['"])([\s\S]*)\1$/.exec(v)
        if (q) v = q[2]!
        else if (!/^[A-Za-z0-9_\u4e00-\u9fa5-]+$/.test(v)) return null // 无引号且非简单标识符
        if (!name) return null
        compound.attrs.push({ name, value: v })
      }
      any = true
      continue
    }
    break // 空白 / `>` / `,` ⇒ compound 结束
  }
  return any ? { compound, next: i } : null
}

/* ══════════════════════ 索引写入 ══════════════════════ */

function upsert(tree: ElementTree, rec: ElementRecord): void {
  if (!tree.records.has(rec.nodeId)) tree.order.push(rec.nodeId)
  const prev = tree.records.get(rec.nodeId)
  tree.records.set(rec.nodeId, { ...prev, ...rec, dataset: rec.dataset ?? prev?.dataset })
}

/** Vue 渲染链：登记/更新一个元素的身份（`patchProp` / `createElement` 时调用）。 */
export function registerVueElement(rec: ElementRecord): void {
  if (!Number.isFinite(rec.nodeId)) return
  upsert(vueTree, rec)
}

/** Vue 渲染链：登记父子边（`insert(child, parent)` 时调用——后代/子组合符要用）。 */
export function registerVueElementParent(child: number, parent: number | null): void {
  if (!Number.isFinite(child)) return
  upsert(vueTree, { nodeId: child, parentId: parent })
}

/** 兼容旧调用（`patchProp(el,'id',…)`）：只登记 id。 */
export function registerVueElementId(elementId: string, nodeId: number): void {
  if (!elementId || !Number.isFinite(nodeId)) return
  const prev = vueTree.records.get(nodeId)
  if (prev?.id) return // 与 Web 一致：重复 id 取文档序第一个
  upsert(vueTree, { nodeId, id: elementId })
}

/** Vue 渲染链：清空（renderer 重建 / 卸载时调用——旧句柄 id 已无意义）。 */
export function clearVueElementIds(): void {
  vueTree.records.clear()
  vueTree.order.length = 0
}

/** Vapor 链入参：实例化产物的身份子集 */
export interface ScreenElementNode {
  id: number
  elementId?: unknown
  elementClasses?: unknown
  elementDataset?: unknown
  tag?: unknown
  parentId?: unknown
}

/**
 * Vapor 链：用**一棵新实例化的树**替换某屏的索引（不是增量合并——旧树 id 已失效）。
 * @returns 登记条数 + 重复 id 列表（重复按文档序取第一个，但**如实记账**，不静默丢）
 */
export function registerScreenElements(
  screen: string,
  nodes: Iterable<ScreenElementNode>,
): { registered: number; duplicates: string[] } {
  const tree: ElementTree = { records: new Map(), order: [] }
  const firstIdAt = new Map<string, number>()
  const duplicates: string[] = []
  let registered = 0
  for (const n of nodes) {
    if (!Number.isFinite(n.id)) continue
    const id = typeof n.elementId === 'string' && n.elementId ? n.elementId : undefined
    if (id !== undefined) {
      if (firstIdAt.has(id)) duplicates.push(id)
      else firstIdAt.set(id, n.id)
    }
    const classes = Array.isArray(n.elementClasses)
      ? (n.elementClasses.filter((c) => typeof c === 'string' && c) as string[])
      : undefined
    const dataset = n.elementDataset && typeof n.elementDataset === 'object'
      ? (n.elementDataset as Record<string, string>)
      : undefined
    upsert(tree, {
      nodeId: n.id,
      ...(id !== undefined ? { id } : {}),
      ...(classes && classes.length ? { classes: [...new Set(classes)] } : {}),
      ...(dataset && Object.keys(dataset).length ? { dataset } : {}),
      ...(typeof n.tag === 'string' ? { tag: n.tag } : {}),
      parentId: typeof n.parentId === 'number' ? n.parentId : null,
    })
    registered++
  }
  screenTrees.set(screen, tree)
  return { registered, duplicates }
}

/** Vapor 链：清掉某屏索引（屏销毁/无产物时）。 */
export function clearScreenElements(screen: string): void {
  screenTrees.delete(screen)
}

/* ══════════════════════ 匹配 ══════════════════════ */

/** 文档序：从根按注册序 DFS（`querySelector` 取第一个匹配必须用这个序） */
function documentOrder(tree: ElementTree): ElementRecord[] {
  const children = new Map<number, number[]>()
  const roots: number[] = []
  for (const nodeId of tree.order) {
    const rec = tree.records.get(nodeId)
    if (!rec) continue
    const p = rec.parentId
    if (p === null || p === undefined || !tree.records.has(p)) roots.push(nodeId)
    else {
      const arr = children.get(p)
      if (arr) arr.push(nodeId)
      else children.set(p, [nodeId])
    }
  }
  const out: ElementRecord[] = []
  const visit = (id: number): void => {
    const rec = tree.records.get(id)
    if (!rec) return
    out.push(rec)
    for (const c of children.get(id) ?? []) visit(c)
  }
  for (const r of roots) visit(r)
  // ★兜底：环/孤立节点（数据异常）也要在结果里（否则 selection 静默漏节点）
  if (out.length !== tree.order.length) {
    const seen = new Set(out.map((r) => r.nodeId))
    for (const id of tree.order) { const r = tree.records.get(id); if (r && !seen.has(id)) out.push(r) }
  }
  return out
}

function matchesCompound(rec: ElementRecord, c: Compound): boolean {
  if (c.tag && c.tag !== '*' && rec.tag !== c.tag) return false
  if (c.id !== undefined && rec.id !== c.id) return false
  if (c.classes.length) {
    const set = rec.classes
    if (!set) return false
    for (const cls of c.classes) if (!set.includes(cls)) return false
  }
  for (const a of c.attrs) {
    const key = a.name.startsWith('data-') ? datasetKeyOf(a.name) : a.name
    const v = rec.dataset?.[key]
    if (v === undefined) return false
    if (a.value !== undefined && v !== a.value) return false
  }
  return true
}

function matchesComplex(rec: ElementRecord, tree: ElementTree, sel: ComplexSelector, idx: number): boolean {
  if (!matchesCompound(rec, sel.compounds[idx]!)) return false
  if (idx === 0) return true
  const comb = sel.combinators[idx - 1]!
  let p = rec.parentId
  if (p === null || p === undefined) return false
  const parent = tree.records.get(p)
  if (!parent) return false
  if (comb === '>') return matchesComplex(parent, tree, sel, idx - 1)
  // 后代：祖先链任意层级
  let cur: ElementRecord | undefined = parent
  while (cur) {
    if (matchesComplex(cur, tree, sel, idx - 1)) return true
    const pp: number | null | undefined = cur.parentId
    cur = pp === null || pp === undefined ? undefined : tree.records.get(pp)
  }
  return false
}

/** 在给定树上按选择器列表取文档序第一个命中 */
function queryFirst(tree: ElementTree, sels: ComplexSelector[]): number | null {
  for (const rec of documentOrder(tree)) {
    for (const sel of sels) {
      if (matchesComplex(rec, tree, sel, sel.compounds.length - 1)) return rec.nodeId
    }
  }
  return null
}

/* ══════════════════════ 对外查询 ══════════════════════ */

/**
 * 解析选择器 → 引擎节点 id（`querySelector` 语义：**文档序第一个**匹配）。
 * 顺序：**当前屏的 Vapor 索引**优先（它就是屏幕上那棵树），再回落 Vue 渲染链。
 *
 * @returns `null` = 没找到**或**选择器不受支持（用 `parseSelector` 区分：先解析再查）
 */
export function resolveElement(selector: string | undefined | null, screen?: string): ElementResolution | null {
  const parsed = parseSelector(selector)
  if (parsed.reason || !parsed.selectors.length) return null
  if (screen) {
    const tree = screenTrees.get(screen)
    if (tree) {
      const hit = queryFirst(tree, parsed.selectors)
      if (hit !== null) return { nodeId: hit, source: 'screen' }
    }
  }
  const vueHit = queryFirst(vueTree, parsed.selectors)
  return vueHit !== null ? { nodeId: vueHit, source: 'vue' } : null
}

/**
 * 支持性检查（能力层用它分档：不支持 ⇒ `unsupported` + 原因；支持但没找到 ⇒ `not-found`）。
 * ★与 `resolveElement` 共用同一份解析器——不会出现"检查说支持、查询却按另一套解析"的分叉。
 */
export function selectorSupport(selector: string | undefined | null): SelectorSupport {
  const parsed = parseSelector(selector)
  if (parsed.reason) return { ok: false, reason: parsed.reason }
  if (!parsed.selectors.length) return { ok: false, reason: '选择器为空' }
  return { ok: true }
}

/** 兼容旧名（#1081 的调用方/测试）：只接受 `#id` / 裸 id 时返回 id，否则 null。 */
export function parseIdSelector(selector: string | undefined | null): string | null {
  const parsed = parseSelector(selector)
  if (parsed.reason || parsed.selectors.length !== 1) return null
  const one = parsed.selectors[0]!
  if (one.compounds.length !== 1) return null
  const c = one.compounds[0]!
  if (c.classes.length || c.attrs.length) return null
  return c.id ?? (c.tag && c.tag !== '*' ? c.tag : null)
}

/** 当前屏的**第一个元素 id**（探针/诊断用：跨页探针不该硬编码某一页的 id）。 */
export function firstScreenElementId(screen: string): string | null {
  const tree = screenTrees.get(screen)
  if (!tree) return null
  for (const rec of documentOrder(tree)) if (rec.id) return rec.id
  return null
}

/** 诊断读数（判据/面板用：证明索引里真有东西，而不是"查询恒 not-found"）。 */
export function elementRegistryStats(): {
  vue: number
  screens: Record<string, number>
} {
  const screens: Record<string, number> = {}
  for (const [k, v] of screenTrees) screens[k] = v.records.size
  return { vue: vueTree.records.size, screens }
}

/** 测试用：全清（生产路径不应调用——按屏/按链各自清）。 */
export function resetElementRegistry(): void {
  clearVueElementIds()
  screenTrees.clear()
}

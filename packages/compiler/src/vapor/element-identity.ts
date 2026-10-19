// packages/compiler/src/vapor/element-identity.ts
// ★★★决策 #1081 / #1082（2026-10-19）：模板**元素身份**（`id` / `class` / `data-*`）的提取与诊断
//   —— `useElement` 选择器通路的**源头**。
//
// 【为什么需要（取证）】App 的 superapp 走 vapor 链：
//   `.vue` → 编译器 → `LayoutTemplate`（节点 = 数字 id + 扁平样式）→ `instantiateTemplate()`
//   → `InstantiatedNode[]` → `host.mount(nodes)` → 宿主自绘。**链上没有 vnode**
//   （`render-backend/src/vue-bridge.ts` 的真实 `createRenderer` 存在，但 superapp 不用它）。
//   而模板里的 `id="hero"` / `class="a b"` / `data-x="1"` 此前被当**普通属性丢弃** ⇒
//   产物里没有元素身份 ⇒ `useElement('#hero')` 不是"映射难"，是**源头没有信息**。
//   ⇒ 本模块把这些收进 `LayoutNode.elementId` / `.elementClasses` / `.elementDataset`
//     （与引擎节点 id `LayoutNode.id` 是**两个空间**）。
//
// 【★Web 基准（用户 2026-10-19：「真正落地就需要和 web 的查询结构保持同步」）】
//   选择器语义一律以浏览器 `querySelector` 为准；本模块只负责**把源信息完整保留下来**，
//   匹配规则在 `render-backend/src/element-registry.ts`（与 Web 逐条对齐，见那里的表）。
//
// 【本批边界（诚实，不静默半支持）】
//   · 静态 `id` / `class` / `data-*`（Vue AST type=6 ATTRIBUTE）全部收；
//   · 动态 `:id` / `:class` / `:data-*` 的取值构建期不可知 ⇒ **精确诊断**（不静默丢——
//     静默丢会让 `useElement` 无声失效）。★`:class` 只诊断**对象/数组形态**带来的
//     "类名集合不可静态确定"；字符串字面量形态（`:class="'a b'"`）按静态收（Vue 语义等价）。
//
// 【为什么单列一个文件】`template.ts` 是 4651 行的存量巨型文件，`check:file-size` 基线**只减不增**
//   ⇒ 新增逻辑落在新文件，主文件只留一次调用（本仓「反大文件巨型化」纪律）。

/** Vue AST 节点中本模块用到的字段子集（`@vue/compiler-sfc` 的 `ElementNode`） */
export interface ElementIdentitySourceNode {
  props?: Array<{
    /** 1=ATTRIBUTE · 6=ATTRIBUTE · 7=DIRECTIVE */
    type: number
    name?: string
    arg?: { content?: string }
    value?: { content?: string } | null
    exp?: { content?: string } | null
  }> | null
}

/** 诊断出口（与 `template.ts` 的 `diag` 同形：消息 / 修复提示 / 码） */
export type ElementIdentityDiag = (message: string, hint?: string, code?: string) => void

/** 节点上要写回的元素身份字段（全空 ⇒ 空对象，便于在节点字面量里直接展开） */
export interface ElementIdentityFields {
  elementId?: string
  elementClasses?: string[]
  elementDataset?: Record<string, string>
}

/**
 * 把 `:class` 的**字符串字面量**形态折成静态类名（Vue 语义等价：值就是这些类）。
 * 其它形态（对象 / 数组 / 含变量的表达式）⇒ `null`（调用方产诊断）。
 */
export function staticClassFromExpr(expr: string | undefined | null): string[] | null {
  const s = (expr ?? '').trim()
  if (!s) return null
  // 只认 `'a b'` / `"a b"`（含转义最少的那两种引号）；模板字面量/拼接/对象/数组一律不收
  const m = /^(['"])([^'"`$\\]*)\1$/.exec(s)
  if (!m) return null
  return m[2]!.split(/\s+/).filter(Boolean)
}

/**
 * 提取模板元素上的**元素身份**（静态 id / class / data-*），并把动态形态变成可观测的诊断。
 *
 * @returns `ElementIdentityFields`（无任何身份 ⇒ `{}`）
 *   —— 返回值刻意是**对象而不是多个 undefined**：`...(elementIdentityFields(...))` 让主文件
 *   的节点构造保持一行（大文件棘轮不增长）。
 */
export function elementIdentityFields(
  n: ElementIdentitySourceNode,
  diag: ElementIdentityDiag,
  tag: string,
  nodeId: number,
): ElementIdentityFields {
  const props = n.props ?? []
  const out: ElementIdentityFields = {}

  // ── id ──
  const idAttr = props.find((p) => p.type === 6 && p.name === 'id' && p.value?.content)
  const staticId = idAttr?.value?.content?.trim()
  if (staticId) out.elementId = staticId
  const dynId = props.find((p) => p.type === 7 && p.name === 'bind' && p.arg?.content === 'id')
  if (dynId) {
    diag(
      `${tag}(id=${nodeId}) 动态 \`:id\` 不会被保留到模板产物（构建期无法得知取值）⇒ App 端 \`useElement\` 查不到该节点`,
      'App 端元素查询只支持**静态** id（`id="foo"` ⇒ `useElement(\'#foo\')`）；若 id 依赖运行期数据，改用静态 id + 数据驱动的显隐/样式',
      'VAPOR_DYNAMIC_ID_UNSUPPORTED',
    )
  }

  // ── class ──
  const clsAttr = props.find((p) => p.type === 6 && p.name === 'class' && p.value?.content)
  const staticClasses = (clsAttr?.value?.content ?? '').trim().split(/\s+/).filter(Boolean)
  const dynClass = props.find((p) => p.type === 7 && p.name === 'bind' && p.arg?.content === 'class')
  const dynClassExpr = dynClass?.exp?.content
  const fromLiteral = dynClass ? staticClassFromExpr(dynClassExpr) : null
  const allClasses = new Set(staticClasses)
  if (fromLiteral) for (const c of fromLiteral) allClasses.add(c)
  if (dynClass && !fromLiteral) {
    // ★不静默：`:class` 的**对象/数组/表达式**形态会让"这个节点有哪些类"变成运行期事实。
    //   App 端元素查询只收静态类名 ⇒ 这类节点在 `useElement('.x')` 下可能查不到。
    diag(
      `${tag}(id=${nodeId}) 动态 \`:class\` 的类名集合构建期不可确定 ⇒ App 端 \`useElement('.x')\` 可能查不到该节点`,
      '元素查询的类名匹配只认**静态** class（`class="a b"` 或 `:class="\'a b\'"`）；动态类名请改用静态 id 查询',
      'VAPOR_DYNAMIC_CLASS_QUERY_UNSUPPORTED',
    )
  }
  if (allClasses.size) out.elementClasses = [...allClasses]

  // ── data-* ──
  const dataset: Record<string, string> = {}
  for (const p of props) {
    if (p.type !== 6) continue
    const name = p.name ?? ''
    if (!name.startsWith('data-') || name.length <= 5) continue
    // ★HTML 规格：`data-foo-bar` ⇒ `dataset.fooBar`（连字符后字母大写）
    const key = name
      .slice(5)
      .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    dataset[key] = p.value?.content ?? ''
  }
  const dynData = props.filter((p) => p.type === 7 && p.name === 'bind' && (p.arg?.content ?? '').startsWith('data-'))
  if (dynData.length) {
    diag(
      `${tag}(id=${nodeId}) 动态 \`:${dynData.map((p) => p.arg?.content).join(' / :')}\` 不会被保留到模板产物 ⇒ App 端 \`useElement\` 的 dataset 匹配查不到该节点`,
      'App 端元素查询只支持**静态** `data-*`（`data-key="v"`）；动态值请改用静态属性 + 数据驱动的样式/文本',
      'VAPOR_DYNAMIC_DATASET_UNSUPPORTED',
    )
  }
  if (Object.keys(dataset).length) out.elementDataset = dataset

  return out
}

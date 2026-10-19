// packages/compiler/src/vapor/element-id.ts
// ★★★决策 #1081（2026-10-19）：模板**元素身份**（静态 `id`）的提取与诊断 —— `useElement` 选择器通路的**源头**。
//
// 【为什么需要（取证）】App 的 superapp 走 vapor 链：
//   `.vue` → 编译器 → `LayoutTemplate`（节点 = 数字 id + 扁平样式）→ `instantiateTemplate()`
//   → `InstantiatedNode[]` → `host.mount(nodes)` → 宿主自绘。**链上没有 vnode**
//   （`render-backend/src/vue-bridge.ts` 的真实 `createRenderer` 存在，但 superapp 不用它）。
//   而模板里的 `id="hero"` 此前被当**普通属性丢弃** ⇒ 产物里没有元素身份 ⇒
//   `useElement('#hero')` 不是"映射难"，是**源头没有信息**。
//   ⇒ 本模块把静态 id 收进 `LayoutNode.elementId`（与引擎节点 id `LayoutNode.id` 是**两个空间**）。
//
// 【本切片边界（诚实，不静默半支持）】
//   · 只收**静态** `id="foo"`（Vue AST `type=6` ATTRIBUTE）；
//   · 动态 `:id="expr"` 的取值构建期不可知 ⇒ **精确诊断**（`VAPOR_DYNAMIC_ID_UNSUPPORTED`）——
//     静默丢会让 `useElement` 无声失效（本仓最忌的缺陷形态）；
//   · `class` / `data-*` / 组合选择器是**下一批**（走同一元素身份通道，届时扩索引形态）。
//
// 【为什么单列一个文件】`template.ts` 是 4651 行的存量巨型文件，`check:file-size` 基线**只减不增**
//   ⇒ 新增逻辑落在新文件，主文件只留一次调用（本仓「反大文件巨型化」纪律）。

/** Vue AST 节点中本模块用到的字段子集（`@vue/compiler-sfc` 的 `ElementNode`） */
export interface ElementIdSourceNode {
  props?: Array<{
    /** 1=ATTRIBUTE · 6=ATTRIBUTE · 7=DIRECTIVE */
    type: number
    name?: string
    arg?: { content?: string }
    value?: { content?: string } | null
  }> | null
}

/** 诊断出口（与 `template.ts` 的 `diag` 同形：消息 / 修复提示 / 码） */
export type ElementIdDiag = (message: string, hint?: string, code?: string) => void

/**
 * 提取模板元素上的**静态 id**，并把动态 `:id` 变成可观测的诊断。
 *
 * @returns `{ elementId }`（无静态 id ⇒ 空对象，便于在节点字面量里直接展开）
 *   —— 返回值刻意是**对象而不是 `string | undefined`**：`...(elementIdFields(...))` 让主文件
 *   的节点构造保持一行（大文件棘轮不增长）。
 */
export function elementIdFields(
  n: ElementIdSourceNode,
  diag: ElementIdDiag,
  tag: string,
  nodeId: number,
): { elementId?: string } {
  const props = n.props ?? []
  const idAttr = props.find(
    (p) => p.type === 6 /* ATTRIBUTE */ && p.name === 'id' && p.value?.content,
  )
  const staticId = idAttr?.value?.content?.trim()
  const dynId = props.find(
    (p) => p.type === 7 /* DIRECTIVE */ && p.name === 'bind' && p.arg?.content === 'id',
  )
  if (dynId) {
    diag(
      `${tag}(id=${nodeId}) 动态 \`:id\` 不会被保留到模板产物（构建期无法得知取值）⇒ App 端 \`useElement\` 查不到该节点`,
      'App 端元素查询只支持**静态** id（`id="foo"` ⇒ `useElement(\'#foo\')`）；若 id 依赖运行期数据，改用静态 id + 数据驱动的显隐/样式',
      'VAPOR_DYNAMIC_ID_UNSUPPORTED',
    )
  }
  return staticId ? { elementId: staticId } : {}
}

// packages/render-backend/src/element-registry.ts
// ★★★决策 #1081（2026-10-19）：**元素身份索引**（模板静态 id → 引擎节点 id）——`useElement` 选择器通路的映射层。
//
// 【为什么需要这一层（取证 + 用户指定）】
//   用户 2026-10-19：「这个选择器正常应该是通过 vue 自定义渲染通道做映射吧？因为拿到的肯定是 vue 元素信息
//   不是原生元素信息」。完全正确——`useElement('#hero')` 里的 `#hero` 是**模板/元素层**的名字，
//   引擎只认**数字节点 id**。⇒ 映射必须发生在**知道元素身份的那一层**，且两条渲染链各有一个这样的层：
//     · **Vue 自定义渲染器链**（G-41 B3：`createRenderer(nodeOps)` → `ProteusNodeOpsDispatcher`）——
//       `patchProp(el, 'id', …, next)` 是唯一能拿到「元素 id ↔ 渲染句柄」的位置；
//     · **Vapor 链**（superapp 实际走的链）：`instantiateTemplate()` 产 `InstantiatedNode[]`，
//       编译器把模板静态 `id` 透传到 `elementId`（见 `LayoutNode.elementId`）。
//   两条链都往**同一个索引**写 ⇒ 能力层（`useElement`）只面对一套查询语义。
//
// 【本切片边界（诚实，不静默半支持）】
//   · 只支持 **`#id` / 裸 id** 一种选择器（`parseIdSelector`）。`.class` / `a[data-x]` / 组合选择器是下一批
//     ——Web 基准是用 `querySelector` 的全语义，这里**明确拒绝**而不是近似匹配（近似匹配会给出错节点，
//     比 unsupported 危险得多）。
//   · 重复 id：与 Web `querySelector` 一致取**文档序第一个**（注册顺序 = 树的构建顺序：Vapor 为实例化序遍历，
//     Vue 为 patchProp 到达序）。重复本身按 HTML 规格是无效文档，但**不报错**（与 Web 同行为）。
//   · 索引随「树重建」失效：Vapor 每次 `instantiate` 重建该屏的桶（旧 id 不会残留）；
//     Vue 链由调用方在 renderer 重建时 `clearVueElementIds()`。
//
// 【为什么单列文件】`render-backend` 的既有文件都是责任明确的小模块；本索引被两条渲染链 + 能力层共用，
//   单列才能被 `check:file-size` 与单测直接对准（不塞进 dispatcher 或 screen-runtime 任一侧）。

/** 查询来源（诊断用：能区分"命中的是 Vapor 链还是 Vue 渲染链"） */
export type ElementIndexSource = 'screen' | 'vue'

/** 一次成功的解析结果 */
export interface ElementResolution {
  /** 引擎节点 id（宿主/内核认识的那个 id） */
  nodeId: number
  /** 命中来自哪条链（诊断/判据用） */
  source: ElementIndexSource
}

/** Vue 渲染链的索引：元素 id → 渲染句柄 id（`ProteusNodeOpsDispatcher` 的 `idOf`） */
const vueIds = new Map<string, number>()
/** Vapor 链的索引：屏名 → (元素 id → 引擎节点 id)。按屏分桶 ⇒ 跨屏同名 id 不串。 */
const screenIds = new Map<string, Map<string, number>>()

/**
 * 把选择器归一成**元素 id**；不是 `#id`/裸 id 形态 ⇒ `null`。
 *
 * ★为什么拒绝而不是"尽力匹配"：Web 的 `querySelector` 支持完整 CSS 选择器；本索引只有 id 维度。
 *   若把 `.foo` 近似当成 `foo` 去查，会返回**错节点**（静默错位）——比如实 unsupported 危险。
 *   下一批扩 class/dataset 时，本函数与解析实现一起扩（单一入口）。
 */
export function parseIdSelector(selector: string | undefined | null): string | null {
  if (typeof selector !== 'string') return null
  const s = selector.trim()
  if (!s) return null
  // `#id`（id 内允许 CSS 转义之外的一切可打印字符：与 Web 一致，只在这里做最小判据）
  if (s[0] === '#') {
    const id = s.slice(1).trim()
    return id && !/[\s.[\]>+~:#]/.test(id) ? id : null
  }
  // 裸 id：沿用本仓既有约定（MP `norm()` / web `norm()` 都把裸串当 id）
  if (/[\s.[\]>+~:#]/.test(s)) return null
  return s
}

/** Vue 渲染链：登记一个元素 id（`patchProp(el,'id',…,next)` 时调用）。 */
export function registerVueElementId(elementId: string, nodeId: number): void {
  if (!elementId || !Number.isFinite(nodeId)) return
  if (!vueIds.has(elementId)) vueIds.set(elementId, nodeId)
}

/** Vue 渲染链：清空（renderer 重建 / 卸载时调用——旧句柄 id 已无意义）。 */
export function clearVueElementIds(): void {
  vueIds.clear()
}

/**
 * Vapor 链：用**一棵新实例化的树**替换某屏的索引（不是增量合并——旧树 id 已失效）。
 * 入参是 `InstantiatedNode[]` 形态（只读 `id` 与 `elementId`）。
 */
export function registerScreenElements(
  screen: string,
  nodes: Iterable<{ id: number; elementId?: unknown }>,
): { registered: number; duplicates: string[] } {
  const bucket = new Map<string, number>()
  const duplicates: string[] = []
  for (const n of nodes) {
    const eid = typeof n.elementId === 'string' ? n.elementId : ''
    if (!eid) continue
    if (bucket.has(eid)) {
      // ★与 Web 一致：重复 id 取**第一个**（文档序）；但要**如实记账**（不静默丢）
      duplicates.push(eid)
      continue
    }
    bucket.set(eid, n.id)
  }
  screenIds.set(screen, bucket)
  return { registered: bucket.size, duplicates }
}

/** Vapor 链：清掉某屏索引（屏销毁/无产物时）。 */
export function clearScreenElements(screen: string): void {
  screenIds.delete(screen)
}

/**
 * 解析选择器 → 引擎节点 id。
 * 顺序：**当前屏的 Vapor 索引**优先（它就是屏幕上那棵树），再回落 Vue 渲染链。
 */
export function resolveElement(selector: string | undefined | null, screen?: string): ElementResolution | null {
  const id = parseIdSelector(selector)
  if (!id) return null
  if (screen) {
    const hit = screenIds.get(screen)?.get(id)
    if (hit !== undefined) return { nodeId: hit, source: 'screen' }
  }
  const vueHit = vueIds.get(id)
  return vueHit !== undefined ? { nodeId: vueHit, source: 'vue' } : null
}

/** 诊断读数（判据/面板用：证明索引里真的有东西，而不是"查询返回 undefined"）。 */
/**
 * 当前屏的**第一个元素 id**（探针/诊断用：跨页探针不该硬编码某一页的 id）。
 * 无该屏/无元素 ⇒ null。
 */
export function firstScreenElementId(screen: string): string | null {
  const bucket = screenIds.get(screen)
  if (!bucket || bucket.size === 0) return null
  for (const k of bucket.keys()) return k
  return null
}

export function elementRegistryStats(): {
  vue: number
  screens: Record<string, number>
} {
  const screens: Record<string, number> = {}
  for (const [k, v] of screenIds) screens[k] = v.size
  return { vue: vueIds.size, screens }
}

/** 测试用：全清（生产路径不应调用——按屏/按链各自清）。 */
export function resetElementRegistry(): void {
  vueIds.clear()
  screenIds.clear()
}

// packages/slot-runtime/src/list-registry.ts
// ★Vapor IR V4 —— **列表项注册表**：让 `LIST_UPDATE` 真正落地（方案 §2.3）
//
// 【为什么必须有这一层（V3 遗留的功能缺口）】V3 实测：`LIST_UPDATE` 被 Rust 侧**上报 unsupported**，
//   因为「布局核心只知道节点树，不知道哪些节点属于哪个列表的哪一项」——
//   这个映射（itemKey → 该行的节点 id）**只存在于 JS 侧**（列表渲染时才知道）。
//   ⇒ 正解：**在 JS 侧解析**。解析成功 ⇒ 发一条普通样式/文本指令（Rust 已支持，无需它懂列表）；
//     解析失败（宿主自持映射，如复用池场景）⇒ 仍发 LIST_UPDATE 由宿主解析。
//   ★这样两边的职责都清晰了，而且**热路径上没有任何列表语义泄漏到核心**。
//
// 【与回收池的关系（诚实标注）】长列表真正难的是「复用 + 滚动窗口」——那由
//   `recycle.rs`（已实现、宿主未接）负责；本注册表解决的是「**定位**」：
//   改第 4021 项的一个字段时，怎样在 O(1) 时间里找到那个节点。两者互补。
export class ListRegistry {
  /** listId → itemKey → (itemSlotId → nodeId) */
  private readonly items = new Map<number, Map<string, Map<number, number>>>()
  /** 统计（诊断：解释"这次 item 更新为什么没走快路径"） */
  private hits = 0
  private misses = 0

  /**
   * 登记一个列表项
   *
   * @param listId    编译期分配的列表 id
   * @param itemKey   该行的稳定 key（**绝不用下标**——下标在 splice 后会命中错项，方案坑位 #5）
   * @param slotNodes item 内槽位 id → 该槽位对应的**节点 id**
   */
  registerItem(listId: number, itemKey: string, slotNodes: Map<number, number> | Record<number, number>): void {
    let byKey = this.items.get(listId)
    if (!byKey) {
      byKey = new Map()
      this.items.set(listId, byKey)
    }
    const m = slotNodes instanceof Map ? slotNodes : new Map(Object.entries(slotNodes).map(([k, v]) => [Number(k), v]))
    byKey.set(itemKey, m)
  }

  /** 批量登记（列表首帧渲染后一次性登记全部项——避免逐项调用） */
  registerItems(listId: number, entries: Array<{ itemKey: string; slotNodes: Map<number, number> | Record<number, number> }>): void {
    for (const e of entries) this.registerItem(listId, e.itemKey, e.slotNodes)
  }

  /** 解析：该列表项内某槽位对应的节点 id（未登记 ⇒ undefined，调用方回退 LIST_UPDATE） */
  resolveNode(listId: number, itemKey: string, slotId: number): number | undefined {
    const hit = this.items.get(listId)?.get(itemKey)?.get(slotId)
    if (hit === undefined) this.misses++
    else this.hits++
    return hit
  }

  /** 移除项（splice 删除时调用，防止 key 被复用时命中已删项） */
  removeItem(listId: number, itemKey: string): boolean {
    return this.items.get(listId)?.delete(itemKey) ?? false
  }

  /** 整体清空某个列表（LIST_SET 整体换数据源时） */
  clearList(listId: number): void {
    this.items.delete(listId)
  }

  /** 清空全部（卸载页面时） */
  clear(): void {
    this.items.clear()
  }

  get size(): number {
    let n = 0
    for (const byKey of this.items.values()) n += byKey.size
    return n
  }

  get stats(): { hits: number; misses: number; items: number } {
    return { hits: this.hits, misses: this.misses, items: this.size }
  }
}

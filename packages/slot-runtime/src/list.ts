// packages/slot-runtime/src/list.ts
// Vapor for Proteus IR —— ★列表更新（方案 §2.3：LIST_UPDATE 让 item 级更新成为 O(1)）
//
// 【为什么单列一个模块（方案原文的立项理由）】
//   `v-for` 列表是 VNode 重建的重灾区：4000 行的列表里改第 4021 项的一个字段，
//   现状要**重建整棵 4000 行 VNode 树**（V0 真机实测：单节点更新 Vue 侧 78ms）。
//   `LIST_UPDATE` 把这种更新降为**一条指令**：`(listId, itemKey, slotId, value)`。
//
// 【★这是本方案相对 Vue 官方 Vapor 的额外优势】官方 Vapor 面向 DOM，没有「item 级指令」这层抽象；
//   Proteus 的 IR 是平台无关的，可以把「列表项内某个槽位」直接寻址。
//
// 【三种列表操作的职责边界（不要混用）】
//   · LIST_UPDATE  单项内字段变化（最常见；O(1)）        ← 本文件 emitItemUpdate
//   · LIST_SPLICE  增删项（结构变化；O(变化的项数)）      ← 本文件 emitSplice
//   · LIST_SET     整体换数据源（列表本身被替换/重新排序）← 槽位 emit（kind='list-item' 之外）
import { OpCode } from './opcode'
import type { SlotRuntime } from './slot'

/** 列表项（id 稳定、内容可变） */
export interface ListItem {
  key: string
  [field: string]: unknown
}

export interface ListHandle {
  listId: number
  items: ListItem[]
}

/** 创建列表句柄（`listId` 由编译期分配） */
export function createList(listId: number, items: ListItem[] = []): ListHandle {
  return { listId, items }
}

/**
 * ★item 级更新：改某一项内的**一个槽位**（方案 §2.3 的核心用例）
 *
 * @param rt      槽位运行时
 * @param list    列表句柄
 * @param key     目标项 key（编译期绑定的稳定 key——**绝不用下标**，见方案坑位清单 #5）
 * @param slotId  该项内的槽位 id（编译期分配）
 * @param value   新值
 *
 * 【为什么 key 必须稳定】用下标作 key 会在 splice 后**命中错误项**（方案坑位清单 #5 明列）。
 *   本函数不做兜底校验（热路径），由 lint / 编译器保证 key 来源稳定。
 */
export function emitItemUpdate(rt: SlotRuntime, list: ListHandle, key: string, slotId: number, value: number): void {
  rt.buffer.push({
    op: OpCode.LIST_UPDATE,
    listId: list.listId,
    itemKeyRef: rt.strings.intern(key),
    slotId,
    value,
  })
}

/**
 * 增删项（结构变化）
 *
 * @param addedKeys 新增项的 key（按插入顺序）；删除时传空数组
 *
 * 【为什么删除不传 key 而传区间】删除的语义是「从 start 起删 delCount 项」——
 *   与 JS `Array.prototype.splice` 对齐（编译器能静态判定区间时用区间，最省字节）。
 */
export function emitSplice(rt: SlotRuntime, list: ListHandle, start: number, delCount: number, addedKeys: string[] = []): void {
  rt.buffer.push({
    op: OpCode.LIST_SPLICE,
    listId: list.listId,
    start,
    delCount,
    itemKeyRefs: addedKeys.map((k) => rt.strings.intern(k)),
  })
}

/**
 * 整体替换数据源
 *
 * @param dataRef 编译期分配的数据源引用号（**不是**数组本身——指令体只带整数）
 */
export function emitListSet(rt: SlotRuntime, list: ListHandle, dataRef: number): void {
  rt.buffer.push({ op: OpCode.LIST_SET, listId: list.listId, dataRef })
}

/**
 * ★批量：一个 tick 内对同一列表的 N 项做 item 级更新
 *
 * 【为什么值得单列】这正是业务里最常见的形态（列表中多项各有一个字段变化）。
 *   批处理的收益有两层：① 指令累积进同一帧的 OpBuffer（一次提交）；
 *   ② 调用方不必自己持缓冲（避免「每项提交一次」把跨边界成本乘以 N）。
 */
export function emitItemUpdates(
  rt: SlotRuntime,
  list: ListHandle,
  updates: Array<{ key: string; slotId: number; value: number }>,
): void {
  for (const u of updates) {
    rt.buffer.push({
      op: OpCode.LIST_UPDATE,
      listId: list.listId,
      itemKeyRef: rt.strings.intern(u.key),
      slotId: u.slotId,
      value: u.value,
    })
  }
}

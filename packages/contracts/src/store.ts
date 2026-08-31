// packages/contracts/src/store.ts
// ★types-plan §07 / 架构规约 L0：状态域跨层共享 DTO（StoreSnapshot）
// 定位：跨层状态快照契约（DevTools 导入状态 / pinia-sync 协同 / 审计）——与
//       runtime devtools 的 __PROTEUS_STORES__ 运行时快照互补（本类型为结构化契约）

/** 跨层 store 状态快照 DTO */
export interface StoreSnapshot {
  /** store id（'user' | 'player' …） */
  id: string
  /** 序列化后的状态对象 */
  state: unknown
  /** 快照时间戳（ms） */
  timestamp: number
}

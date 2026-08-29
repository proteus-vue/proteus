// packages/shared/src/storage/types.ts
// 统一存储适配器契约（docs/proteus-pinia-plan M1）
// ★关键决策：即使 localStorage / wx.setStorageSync 是同步 API，接口统一为 async——
//   App 端（MMKV/SQLite）与 SSR（内存/Redis）多为异步，统一 async 让 store 代码零平台分支
// ⚠ MP 产物安全（决策 #32/#36）：全文件无 ?? / 对象展开 / 数组解构

export interface StorageAdapter {
  /** 读取，统一返回 Promise（同步后端内部 await 微任务即可） */
  getItem(key: string): Promise<string | null>
  /** 写入 */
  setItem(key: string, value: string): Promise<void>
  /** 删除 */
  removeItem(key: string): Promise<void>
  /** 清空命名空间（可选，用于登出等场景） */
  clear?(prefix?: string): Promise<void>
}

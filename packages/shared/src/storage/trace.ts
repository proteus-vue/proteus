// packages/shared/src/storage/trace.ts
// 存储可观测性（docs/proteus-pinia-plan M1 §5，对齐 --trace-transform）
// 启用：proteus.config.ts 的 storage.trace（M3 工厂注入）或测试里 enableStorageTrace()
// ⚠ MP 产物安全：全文件无 ?? / 对象展开
let tracing = false

export function enableStorageTrace(): void {
  tracing = true
}

export function isStorageTraceEnabled(): boolean {
  return tracing
}

/** 包裹存储操作：tracing 开启时打印 操作/键/耗时 */
export async function traced<T>(op: string, key: string, fn: () => Promise<T>): Promise<T> {
  if (!tracing) return fn()
  const start = Date.now()
  const result = await fn()
  const cost = (Date.now() - start).toFixed(2)
  console.log(`[storage] ${op} ${key} (${cost}ms)`)
  return result
}

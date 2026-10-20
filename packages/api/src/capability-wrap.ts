// packages/api/src/capability-wrap.ts
// `wrap(Promise) → CapResult<T>`：能力层唯一的结果归一入口。
//
// 【为什么单列（#1130）】本函数原在 `capability-types.ts`——而后者是 3848 行的**类型契约**文件
//   （`check:file-size` 基线只减不增）。本轮修错误码提取要在函数上加 ~10 行说明与实现，
//   把类型文件推过棘轮 ⇒ 按"该文件几个职责"拆出：**契约（类型）** 与 **结果原语（运行时行为）**
//   是两个职责，后者本就不该躺在纯类型文件里。
//   ★`capability-types.ts` 保留 `export { wrap } from './capability-wrap'` ⇒ 既有 import 全部零改动。

import { CapError, capErr, capOk } from './capability-types'
import type { CapResult } from './capability-types'

/**
 * 把可能 reject 的桥调用包成 `CapResult<T>`。
 *
 * ★★★#1130 修：错误码此前**只认 `instanceof CapError`**，普通 `Error` 上挂的 `code` 一律被压成
 *   `cap.failed`。而实际抛点常是普通 Error（如 `capability-runtime.ts::connectWs` 的
 *   `Object.assign(new Error(...), { code: 'websocket.unsupported' })`）⇒ 业务失去"是能力缺失还是执行失败"
 *   的区分（前者不该重试、后者可以）。
 *   ★这与 #1122 在 `runFetch` 里修的是**同一形态**：码提取必须"自带 code > failed"。
 */
export const wrap = <T>(p: Promise<T>): Promise<CapResult<T>> =>
  p.then(
    (data) => capOk(data),
    (e) => {
      const own = (e as { code?: unknown })?.code
      const code = e instanceof CapError ? e.code : typeof own === 'string' ? own : 'cap.failed'
      return capErr<T>(code, e instanceof Error ? e.message : String(e), e)
    },
  )

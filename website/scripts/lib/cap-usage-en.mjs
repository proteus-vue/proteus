// website/scripts/lib/cap-usage-en.mjs
// ★★★决策 #1087（2026-10-19）：英文能力页「用法」示例的**正确性**——同步句柄 vs 异步 Hook。
//
// 【为什么需要（实测的三层缺陷）】
//   用户「继续推进」后做示例审计，发现**英文**能力页（29 个同步句柄能力）的示例是：
//   ```ts
//   const res = await useElement()   // ← useElement 是**同步**返回 CapResult
//   if (res.ok) { console.log(res.data) }
//   ```
//   三层问题：
//   ① **`await` 一个同步句柄**：运行时虽然能跑（`await` 非 thenable 会原样返回），但**教会了错误形状**——
//      读者会以为这些 Hook 是异步的，于是到处 `await`，并搞不清"能不能同步取句柄";
//   ② **参数名当值用**：`useVideo(id)` / `useWorker(scriptPath)` / `useCanvas(id)`——
//      `id`/`scriptPath` 是**参数名**不是值，照抄**直接 ReferenceError**;
//   ③ **`console.log(res.data)` 对句柄无意义**：打印出来是一堆方法，读者仍不知道该怎么用。
//   ⇒ 中文页早已是正确形状（`const q = useElement('box') // 同步句柄——无 await、无 res.ok`），
//     英文页走的是通用 `direct()` 兜底——**两条路径分叉**。本模块把英文侧修到与中文同源。
//
// 【为什么单列文件】`gen-content-en.mjs` 是 2215 行的存量棘轮文件（只减不增）⇒ 逻辑落新文件，
//   主文件只把 `direct` 换成一个引用（净减行）。

/**
 * 英文「同步句柄」示例（替代原来那句 `const res = await useXxx()`）。
 *
 * @param api PRIMITIVE_CATALOG 的 `api` 字段（形如 `useElement()`——**不含实参**）
 * @param handle 局部变量名（由 hook 名推导）
 * @returns 示例代码行（含正确注释：句柄同步取、方法才返回 Promise）
 */
export function directUsageEn(api, handle, argPlaceholder) {
  const hook = api.replace('()', '')
  const call = argPlaceholder ? `${hook}(${argPlaceholder})` : `${hook}()`
  // ★句柄的**真实用法**：同步拿句柄 → 判 ok → 调它的方法（方法才返回 Promise）
  return [
    `const ${handle} = ${call}   // synchronous handle — no await, no res.ok on the handle itself`,
    '',
    `if (!${handle}.ok) {`,
    `  // ${handle}.error.code tells you why (e.g. *.unsupported → this end cannot do it)`,
    '} else {',
    `  // call its methods — THOSE return Promise<CapResult<T>>:`,
    `  //   const r = await ${handle}.data.<method>()`,
    '}',
  ]
}

/**
 * 需要实参的**同步句柄**的占位值（EN 页用）。
 *
 * ★这些能力的 PRIMITIVE_CATALOG `api` 不带实参，而通用兜底会把**参数名**当值填进去
 *   （`useVideo(id)` ⇒ `id` 未定义 ⇒ 照抄即报错）。这里给的是**可运行的字面量**。
 */
export const EN_ARG_PLACEHOLDERS = {
  useCanvas: "'my-canvas'",
  useCameraContext: "'my-camera'",
  useLivePusher: "'my-pusher'",
  useVideo: "'my-video'",
  useWorker: "'workers/heavy.js'",
}

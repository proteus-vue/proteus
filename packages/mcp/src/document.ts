// packages/mcp/src/document.ts —— documentLike 自动注入（让 vue-dom 引擎在纯 Node 下可用）
//
// 【为什么有它】`run_conformance` 会跑六端；其中 `vue-dom` 引擎需要 `document`。
//   纯 Node stdio/HTTP 下无全局 document ⇒ 该端**如实报错**（core 的既有行为），
//   于是"六端 conformance"实际只有五端——**生产上这是缺陷**（客户端以为跑了六端）。
//   本模块**懒加载** happy-dom（不拖慢启动、只读工具零成本）产出 documentLike 注入 core。
//
// 【诚实边界】happy-dom 声明为**可选依赖**：未安装时本函数返回 undefined，
//   vue-dom 端仍如实报错（不静默、不假装通过）——即"装上则六端全过，未装则如实降级"。
let cachedDocument: unknown
let tried = false

/** 解析可用的 document 注入：显式优先 → 全局 document → 懒加载 happy-dom → undefined */
export async function resolveDocumentLike(explicit?: unknown): Promise<unknown> {
  if (explicit) return explicit
  const g = globalThis as { document?: { createElement?: unknown } }
  if (g.document && typeof g.document.createElement === 'function') return g.document
  if (tried) return cachedDocument
  tried = true
  try {
    const mod = (await import('happy-dom')) as { Window?: new () => { document: unknown } }
    if (mod.Window) cachedDocument = new mod.Window().document
  } catch {
    cachedDocument = undefined // 未装可选依赖 ⇒ 如实降级（vue-dom 端报错，不静默）
  }
  return cachedDocument
}

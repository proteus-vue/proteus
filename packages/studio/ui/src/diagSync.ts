/**
 * diagSync.ts —— 把编辑器里的**内存文本**同步给语言服务（决策 #1419）
 *
 * 【解决的痛点】`vue-tsc --watch` 只看磁盘 ⇒ "敲错但没保存"永远不报（用户两次实测不满）。
 *   这里走 Volar 语言服务：`didOpen`/`didChange` 推**内存文本**，服务端毫秒级回诊断，
 *   **完全不需要保存** —— 与主流 IDE 一致。
 *
 * 【与 watch 的分工】
 *   · 本模块（LSP）：当前打开的文件，实时、内存级 → 编辑器波浪线以它为准；
 *   · watch（磁盘）：全仓，保存后 <1s → 「问题」面板的全貌。
 *   同一个文件两边都有结果时，**LSP 优先**（它对应的是你正在敲的那份文本）。
 *
 * 【节流】编辑后 220ms 推一次（`didChange` 全量文本）。再快没有意义：
 *   服务端每推一次都要重算语义；220ms 已足够"停下来就看到"。
 */
import { ref } from 'vue'
import { diagLspStart, diagLspSync, hasBridge, type Diag } from './bridge'

/** path → 该文件在当前内存内容下的诊断 */
export const liveDiag = ref<Record<string, Diag[]>>({})

type ListenFn = (name: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>
let started = false
let timer: number | undefined
let pending: { path: string; text: string } | null = null

/** 语言服务就绪后有没有补发过当前文档（未就绪时 push 会被服务端丢弃） */
const pushed = new Set<string>()

export async function ensureLsp(): Promise<void> {
  if (started || !hasBridge()) return
  started = true
  try {
    await diagLspStart()
  } catch (e) {
    started = false
    console.warn('[diagSync] 语言服务启动失败：', String((e as Error)?.message ?? e))
    return
  }
  const ev = (globalThis as { __TAURI__?: { event?: { listen?: ListenFn } } }).__TAURI__?.event
  if (!ev?.listen) return
  await ev.listen('diag:update-file', (e) => {
    const p = e.payload as { path?: string; items?: Diag[] }
    if (!p?.path) return
    liveDiag.value = { ...liveDiag.value, [p.path]: Array.isArray(p.items) ? p.items : [] }
  })
  await ev.listen('diag:ready', () => {
    /* 就绪前推的 didChange 会被服务端丢弃 ⇒ 补一次全量 open，保证它拿到当前文本 */
    if (pending) push('open', pending.path, pending.text)
  })
  await ev.listen('diag:log', (e) => {
    console.warn('[volar]', String(e.payload ?? ''))
  })
}

function push(kind: 'open' | 'change' | 'close', path: string, text?: string) {
  void diagLspSync(kind, path, text).catch((e) => {
    console.warn('[diagSync] 同步失败：', String((e as Error)?.message ?? e))
  })
  if (kind === 'close') delete liveDiag.value[path]
}

/** 打开文件（或切到某文件）时调用 */
export function syncOpen(path: string, text: string) {
  pending = { path, text }
  if (!pushed.has(path)) pushed.add(path)
  push('open', path, text)
}

/**
 * 编辑后调用（内部防抖 220ms）。
 * ★不要在这里判断"是否已 ready"：服务端在 initialize 完成前收到的 didChange 会被丢弃，
 *   所以未就绪时只更新 pending，等 `diag:ready` 再补发（见 ensureLsp）。
 */
export function scheduleSync(path: string, text: string) {
  pending = { path, text }
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = undefined
    if (!pending) return
    /* ★**总是推**，不等 ready：`didChange` 送达未就绪的服务端会被丢弃（无害），
       但"未 ready 就不推"会让 ready 事件一旦丢失就**永远不同步**（桩测就复现了）。
       ready 到来时会用 pending 补发一次全量 open，保证服务端拿到当前文本。 */
    push('change', pending.path, pending.text)
  }, 220)
}

export function syncClose(path: string) {
  if (pending?.path === path) pending = null
  pushed.delete(path)
  push('close', path)
}

/** 某文件的内存级诊断；没有（未打开/未就绪）返回 null 以便调用方回退到磁盘诊断 */
export function liveOf(path: string): Diag[] | null {
  const hit = liveDiag.value[path]
  return hit ? hit : null
}

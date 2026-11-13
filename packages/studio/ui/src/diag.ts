/**
 * diag.ts —— 诊断状态的**唯一真源**（决策 #1412 引入 · #1418 改常驻 watch）
 *
 * 【数据从哪来】
 *   ① **类型错误（tsc）**：后端起一个**常驻的 `vue-tsc --watch`**，每次磁盘变化增量重编译
 *      （实测 <1s），整批通过 `diag:update` 事件推过来 —— 这是"保存后立刻红"的关键；
 *      之前每次 spawn 一个 vue-tsc 要 3–12s，所以用户感觉"输错很久都不报"。
 *   ② **Lint（eslint）**：没有 watch 模式，仍是**按需一次**（15s）：进视图 / 保存 / 手动点检查。
 *
 * 【为什么两个源节奏不同】tsc 有增量缓存，watch 重编译 <1s；eslint 每次全量 15s。
 *   把 eslint 塞进每次保存路径会拖慢 ⌘S，所以只在"打开/保存/手动"时跑，其余时刻复用旧结果。
 *
 * 【★版本对齐（#1417）】watch 读的是**磁盘**内容。编辑器里有未保存改动时，诊断对应旧内容，
 *   按行号画上去就会"错位爆红"。所以 `diagStale = editedAt > savedAt`：
 *   **有未保存改动 ⇒ 一律不画**（保存后 <1s 会自动回来）。
 */
import { computed, ref } from 'vue'
import { diagEslint, diagWatchStart, hasBridge, type Diag } from './bridge'
import { liveOf } from './diagSync'

/* ★决策 #1498：排序口径的单一真源在 diagRank.ts，组件一律从本模块取。
   诊断「状态」与诊断「顺序」都从同一个入口进，避免面板与文件树各排一次。 */
export { diagGroups, diagScope, diagScopeFrom } from './diagRank'
export type { DiagGroup } from './diagRank'

/** eslint 结果的复用窗口：进视图/切文件时若 10s 内跑过就不重复跑 */
const LINT_STALE_MS = 10_000

export const diagList = ref<Diag[]>([])
/** 最近一次诊断刷新时间（tsc 事件或 eslint 完成都会更新） */
export const diagAt = ref(0)
/** ★诊断刷新代数（决策 #1498）：给徽标跳转游标签名。
 *  不用 `diagAt` 是因为连续两次推送可能落在同一毫秒，`Date.now()` 会重复；
 *  单调计数才能让「诊断刷新后游标归零」这条判据稳定成立。 */
export const diagSeq = ref(0)
/** 最近一次 eslint 完成时间（控制复用窗口） */
const lintAt = ref(0)
export const diagCost = ref(0)
export const diagRunning = ref(false)
export const diagErr = ref('')

/** 编辑器最近一次文档变化（给 diagStale 用） */
export const editedAt = ref(0)
/** 最近一次"内存与磁盘一致"的时刻：打开文件 / 保存成功 */
export const savedAt = ref(0)

/** 磁盘内容与内存不一致 ⇒ 诊断不可信 ⇒ 不画 */
export const diagStale = computed(() => editedAt.value > savedAt.value)

export function noteEdit() {
  editedAt.value = Date.now()
}

/** 打开文件 / 保存成功后调用：此刻内存与磁盘一致 */
export function markSaved() {
  savedAt.value = Date.now()
}

/** 合并两个源并排序：文件 → 行 → 列；同位置 error 在 warning 前 */
function mergeSort(tsc: Diag[], lint: Diag[]): Diag[] {
  const all = [...tsc, ...lint]
  all.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.col - b.col ||
      (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1),
  )
  return all
}

const tscPart = () => diagList.value.filter((d) => d.source !== 'eslint')
const lintPart = () => diagList.value.filter((d) => d.source === 'eslint')

/* ── ① 常驻 watch：订阅 tsc 的全量推送 ──────────────────────────────────── */
type ListenFn = (name: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>
let watchStarted = false

export async function ensureWatch(): Promise<void> {
  if (watchStarted || !hasBridge()) return
  watchStarted = true
  try {
    await diagWatchStart()
  } catch (e) {
    watchStarted = false
    diagErr.value = String((e as Error)?.message ?? e).slice(0, 200)
    return
  }
  const apply = (raw: unknown) => {
    const tsc = Array.isArray(raw) ? (raw as Diag[]) : []
    /* 推送是全量：替换 tsc 部分，eslint 部分保留 */
    diagList.value = mergeSort(tsc, lintPart())
    diagSeq.value += 1
    diagAt.value = Date.now()
    diagErr.value = ''
  }

  const ev = (globalThis as { __TAURI__?: { event?: { listen?: ListenFn } } }).__TAURI__?.event
  if (ev?.listen) {
    await ev.listen('diag:update', (e) => apply(e.payload))
    return
  }
  /* ★决策 #1492：**浏览器 / 门禁的兜底通路**（与菜单、`close-blocked` 同一套双路惯例）。
     没有它，诊断这条链在门禁里**根本无法驱动** —— 之前就是这样：功能在，但一条判据都写不了，
     等于"只有真机能验"，于是长期没人验。 */
  addEventListener('studio:diag-update', (e) => apply((e as CustomEvent).detail))
}

/* ── ② eslint：按需一次（15s）──────────────────────────────────────────── */
let inflight: Promise<void> | null = null

/**
 * 跑一次 eslint（只读、不自动修）。
 * @param force true = 忽略 10s 复用窗口（手动点「检查」）
 */
export function runEslint(force = false): Promise<void> {
  if (!hasBridge()) {
    diagErr.value = '需要在 Studio 里运行（浏览器直开没有后端）'
    return Promise.resolve()
  }
  if (inflight) return inflight
  if (!force && Date.now() - lintAt.value < LINT_STALE_MS) return Promise.resolve()

  diagRunning.value = true
  diagErr.value = ''
  const t0 = performance.now()
  inflight = (async () => {
    try {
      const r = await diagEslint()
      const lint = Array.isArray(r) ? r : []
      diagList.value = mergeSort(tscPart(), lint)
      diagSeq.value += 1
      diagCost.value = Math.round(performance.now() - t0)
      lintAt.value = Date.now()
      diagAt.value = Date.now()
    } catch (e) {
      diagErr.value = `Lint：${String((e as Error)?.message ?? e).slice(0, 160)}`
    } finally {
      diagRunning.value = false
      inflight = null
    }
  })()
  return inflight
}

/** 某个文件的诊断（编辑器画波浪线用）。
 *
 *  ★**按来源合并，不是整体替换**（决策 #1422）：
 *    · 类型诊断：优先**内存级**（tsserver，对应你正在敲的文本）；没有才用磁盘 watch 的；
 *    · Lint 诊断（eslint）：始终取 `diagList` 里的 `source === 'eslint'` 条目。
 *  之前写成"有内存结果就直接 return live"，把 eslint 告警**整个吞掉** ⇒
 *  面板里一堆黄色警告、编辑器里一条都不画（用户实测反馈）。
 */
const norm = (p: string) => p.replace(/^\.\//, '')
export function diagsOf(path: string): Diag[] {
  if (!path) return []
  const want = norm(path)
  const lint = diagList.value.filter((d) => d.source === 'eslint' && norm(d.path) === want)
  const live = liveOf(path)
  if (live) return [...live, ...lint]
  const tsc = diagList.value.filter((d) => d.source !== 'eslint' && norm(d.path) === want)
  return [...tsc, ...lint]
}

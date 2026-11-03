/**
 * diag.ts —— 类型诊断的**唯一真源**（决策 #1412）
 *
 * 【为什么要独立成模块】诊断结果有三个消费者：
 *   ① 右栏「问题」面板（聚合列表）；
 *   ② 编辑器里的波浪线（按当前文件过滤）；
 *   ③ 悬浮提示（同一份数据）。
 *   如果各自存一份，必然出现"面板说有 3 个、编辑器只画了 2 条"这类漂移 —— 与 `git.ts` 同一条经验。
 *
 * 【什么时候自动跑】
 *   · 首次进入代码视图（且结果超过 STALE_MS）；
 *   · 保存之后（`refreshAfterSave`）；
 *   手动「检查类型」= 强制跑（忽略 STALE）。
 *   ★不做"全局自动轮询"：一次 vue-tsc 12–17s，轮询会持续吃 CPU。
 *
 * 【为什么不用 @codemirror/lint 存状态】lint 只是**渲染层**（波浪线/悬浮/侧栏），
 *   数据仍应在这里；等 @codemirror/lint 装上，只需 `linter(() => 从本模块取当前文件的诊断)`。
 */
import { computed, ref } from 'vue'
import { diagEslint, diagTsc, hasBridge, type Diag } from './bridge'

/** 结果新鲜度：超过这个时间，进入代码视图时重跑一次 */
/** 进入代码视图/打开文件时允许复用的最大年龄：太长会出现"看着是新的、其实是旧的"（用户实测反馈）。
 *  增量诊断实测只要 3s 左右，所以这个值可以小。 */
const STALE_MS = 10_000

export const diagList = ref<Diag[]>([])
/** 上次成功检查的时间戳（0 = 从未跑过） */
export const diagAt = ref(0)
/** 上次耗时（ms） */
export const diagCost = ref(0)
export const diagRunning = ref(false)
export const diagErr = ref('')
/** 编辑器里最近一次**文档变化**的时间（决策 #1417）。
 *  ★为什么需要它：诊断是"起进程跑一遍 tsc"，结果回来时用户可能已经改了好几次文档。
 *    把旧结果按**行号**画到新文档上，就是"改回正确代码反而红"的根源（用户实测）。
 *    规则：`editedAt > diagAt` ⇒ 结果比最后一个编辑还旧 ⇒ **不画**（宁可不报，也不报错位置）。 */
export const editedAt = ref(0)
export const diagStale = computed(() => editedAt.value > diagAt.value)

/** 编辑器 docChanged 时调用 */
export function noteEdit() {
  editedAt.value = Date.now()
}

/* 编辑后自动触发：防抖 700ms + 最小间隔 8s。
   ★8s 的理由：一次 vue-tsc 要 3–12s、eslint 15s，逐字符触发会把 CPU 打满；
     而"停手 0.7s 后跑一次"已经能满足"边写边看"的体感（真·实时要语言服务，见 #1417 说明）。 */
let editTimer: number | undefined
let lastAutoAt = 0
export function scheduleAfterEdit(delay = 700, minGap = 8000): void {
  if (editTimer) window.clearTimeout(editTimer)
  editTimer = window.setTimeout(() => {
    editTimer = undefined
    if (diagRunning.value) return
    if (Date.now() - lastAutoAt < minGap) return
    lastAutoAt = Date.now()
    void runDiag(true, { quick: true })
  }, delay)
}

let inflight: Promise<void> | null = null

/**
 * 跑一次诊断。
 * @param force true = 无论新鲜度都跑（点「检查类型」）
 */
export function runDiag(force = false, opts: { quick?: boolean } = {}): Promise<void> {
  if (!hasBridge()) {
    diagErr.value = '需要在 Studio 里运行（浏览器直开没有后端）'
    return Promise.resolve()
  }
  /* 同一时刻只跑一份：并发点击/自动触发合并成一次，避免两个 vue-tsc 抢 CPU */
  if (inflight) return inflight
  if (!force && Date.now() - diagAt.value < STALE_MS) return Promise.resolve()

  diagRunning.value = true
  diagErr.value = ''
  const t0 = performance.now()
  inflight = (async () => {
    try {
      /* ★两个源**并行**跑：串行要 15+12s，并行约等于较慢那个（~max）。
         任一个失败都不整体失败 —— 类型诊断挂了仍应看到 eslint 结果（反之同理），
         所以用 allSettled 并把失败信息拼进 diagErr。 */
      /* ★quick：编辑触发的检查只跑 tsc（3–12s），复用上一次的 eslint 结果。
         eslint 要 15s，若每次停手都跑，打字体验会明显变卡（用户实测反馈 #1417）。 */
      const prevLint = diagList.value.filter((d) => d.source === 'eslint')
      const [tsc, lint] = opts.quick
        ? [(await Promise.allSettled([diagTsc()]))[0], { status: 'fulfilled', value: prevLint } as PromiseSettledResult<Diag[]>]
        : await Promise.allSettled([diagTsc(), diagEslint()])
      const pick = (r: PromiseSettledResult<Diag[]>) =>
        r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []
      const merged = [...pick(tsc), ...pick(lint)]
      /* 统一排序：文件 → 行 → 列；同位置 error 排 warning 前（先看严重的） */
      merged.sort(
        (a, b) =>
          a.path.localeCompare(b.path) ||
          a.line - b.line ||
          a.col - b.col ||
          (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1),
      )
      diagList.value = merged
      const fails = [tsc, lint]
        .map((r, i) => (r.status === 'rejected' ? `${i === 0 ? '类型' : 'Lint'}：${String((r.reason as Error)?.message ?? r.reason).slice(0, 80)}` : ''))
        .filter(Boolean)
      if (fails.length) diagErr.value = fails.join('；')
      diagCost.value = Math.round(performance.now() - t0)
      diagAt.value = Date.now()
    } catch (e) {
      diagErr.value = String((e as Error)?.message ?? e).slice(0, 200)
    } finally {
      diagRunning.value = false
      inflight = null
    }
  })()
  return inflight
}

/** 归一化路径：去掉前导 `./`，避免"看起来同一个文件、字符串却不相等"导致波浪线不画 */
const norm = (p: string) => p.replace(/^\.\//, '')

/** 某个文件的诊断（编辑器画波浪线用） */
export function diagsOf(path: string): Diag[] {
  if (!path) return []
  const want = norm(path)
  return diagList.value.filter((d) => norm(d.path) === want)
}

/** 需要"现在就是新的"时用（切到代码视图 / 打开文件）：超过 maxAge 才真跑 */
export function ensureDiagFresh(maxAgeMs = STALE_MS): void {
  if (Date.now() - diagAt.value > maxAgeMs) void runDiag(true)
}

/** 保存之后调用：结果已过期，后台静默重跑（不阻塞保存反馈） */
export function refreshAfterSave() {
  diagAt.value = 0
  void runDiag()
}

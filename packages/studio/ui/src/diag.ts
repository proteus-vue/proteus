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
import { ref } from 'vue'
import { diagTsc, hasBridge, type Diag } from './bridge'

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

let inflight: Promise<void> | null = null

/**
 * 跑一次诊断。
 * @param force true = 无论新鲜度都跑（点「检查类型」）
 */
export function runDiag(force = false): Promise<void> {
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
      /* ★后端在降级/旧版本里可能回 null：不校验会在模板里 `null.length` 崩掉整个面板 */
      const r = await diagTsc()
      diagList.value = Array.isArray(r) ? r : []
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

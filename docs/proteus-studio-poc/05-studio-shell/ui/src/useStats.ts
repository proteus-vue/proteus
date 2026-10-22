// docs/proteus-studio-poc/05-studio-shell/ui/src/useStats.ts
// 读数轮询 + 格式化（决策 #1183）
//
// 【为什么轮询而不是推送】面板 2Hz 足够（人眼看不出 500ms 的差别），
//   而推送要在原生侧加一套事件通道——现阶段不值得。等编辑器/树状面板上来再谈。

import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getStats, hasBridge, type Stats } from './bridge'

// 面板从 useStats 一处拿类型，避免各自从桥层 import（组件不该知道 IPC 细节）
export type { Stats }

export function useStats(intervalMs = 500) {
  const stats = ref<Stats | null>(null)
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setInterval> | undefined

  const tick = async () => {
    try {
      stats.value = await getStats()
      error.value = null
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  onMounted(() => {
    void tick()
    timer = setInterval(tick, intervalMs)
  })
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
  })

  return { stats, error, hasBridge: hasBridge() }
}

// ── 格式化：统一口径，避免每个组件自己写一套（那正是手写 HTML 版踩过的坑）──
/** 负值一律 `—`：原生侧用 -1 表示"样本不足"，直接 toFixed 会显示 0.0，而 0ms 会被读成"很快" */
export const num = (v: number | undefined | null, digits = 1, unit = ''): string =>
  typeof v !== 'number' || !Number.isFinite(v) || v < 0 ? '—' : v.toFixed(digits) + unit

export const ms = (v: number | undefined | null): string => num(v, 1, ' ms')
export const pct = (v: number | undefined | null, digits = 1): string => num(v, digits, '%')

// packages/studio/ui/src/composables/useQuality.ts
// ★★★#1264 / #1344：**画质档位**（低码率 / 标准）—— 从 `App.vue` 抽出。
//
// 【★用户纠正（这段注释就是设计理由，别删）】
//   原来做的是"切分辨率"（标准 1920 / 原生清晰），而他要的是**同分辨率下的清晰度档**
//   ——降画质换流畅。这两个轴不是一回事：
//     · 改分辨率：改几何（1.36× 下采样），字变清楚但编码/解码成本 ×1.84
//     · 改码率：几何不变，只改量化与链路占用 ⇒ 影响的是"压缩痕迹多少"与"抗抖动能力"
//
// 【实测（真机 USB）】4/8/13/20 Mbps 四档跑下来 **迟到帧恒为 0**，空转全在设备端
//   ⇒ USB 链路下低码率**换不到帧率**；它换的是抗抖动与省带宽（Wi-Fi adb 才有意义）。
//
// 【为什么还是做】① 无线 adb / 带宽紧张时有用 ② 高码率确实能减少密集细节的压缩痕迹
//   ③ 切换成本已经被 #1263 的"干净重启会话"付掉了，多一个维度是几十行。
//
// 【为什么切换要重启会话】`--bit-rate` 只在会话开始时生效（和 `--size` 一样）。
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { capturePreset } from '../bridge'
import { pushToast } from '../toast'

export interface QualityTier {
  id: string
  label: string
  hint: string
}

export const QUALITY: QualityTier[] = [
  { id: 'low', label: '省流', hint: '4 Mbps —— 带宽紧张/链路抖动时才值得（USB 下换不到帧率）' },
  { id: 'standard', label: '标准', hint: '13 Mbps —— 默认' },
]

export interface QualityControl {
  /** 当前档位下标 */
  qIndex: Ref<number>
  /** 切换进行中（防重复点击） */
  capBusy: Ref<boolean>
  /** 当前档位 */
  qNow: ComputedRef<QualityTier>
  /** 状态栏标签（`画质·标准`） */
  capLabel: ComputedRef<string>
  /** 悬停提示（含"点击切到哪一档"） */
  capTitle: ComputedRef<string>
  /** 切到下一档（重启采集会话） */
  cycleQuality: () => Promise<void>
}

export function useQuality(): QualityControl {
  const qIndex = ref(1)
  const capBusy = ref(false)
  const qNow = computed(() => QUALITY[qIndex.value])
  const capLabel = computed(() => `画质·${qNow.value.label}`)
  const capTitle = computed(
    () => `画质：${qNow.value.label}（${qNow.value.hint}）· 分辨率不变。点击切到「${QUALITY[(qIndex.value + 1) % QUALITY.length].label}」`,
  )

  async function cycleQuality(): Promise<void> {
    if (capBusy.value) return
    const next = QUALITY[(qIndex.value + 1) % QUALITY.length]
    capBusy.value = true
    try {
      const info = await capturePreset(next.id)
      qIndex.value = (qIndex.value + 1) % QUALITY.length
      pushToast(`画质：${next.label} · ${info.width}×${info.height} · ${info.mbps} Mbps`, 'info')
    } catch (err) {
      pushToast(String((err as Error)?.message ?? err), 'err')
    } finally {
      capBusy.value = false
    }
  }

  return { qIndex, capBusy, qNow, capLabel, capTitle, cycleQuality }
}

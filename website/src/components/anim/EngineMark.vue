<script setup lang="ts">
// website/src/components/anim/EngineMark.vue —— ★★Hero 印记：**引擎画出来的**标志
//
// 【这一块是什么（产品页即炫技场的第一处证据）】
//   徽记由引擎的 **strokeProgress（通道 31）** 逐段"画出来"，随后用 **glowIntensity（通道 34）**
//   上光，扫描弧与核心无限循环让它"活着"。⇒ 页面打开的第一眼，看到的就是引擎在自己身上跑。
//
// 【★视觉语言（2026-10-01 重做——用户反馈"徽记感觉太线条化了"）】
//   几何与层次全部收敛到 `SigilSvg.vue`（光晕盘 / 光带环 / 渐变弧 / 轨道节点 / 分层核心），
//   本组件只负责**把引擎指令绑到那些部件上**：弧→描边进度、整枚→发光、扫描弧→旋转、核心→呼吸。
//   ⇒ Hero / 开幕 / 右下角 HUD 三处共用同一套视觉，改一处三处同步。
//
// 【宿主口径（诚实）】曲线求值走与 Rust 内核 golden 对拍的 TS 镜像（`animValue`）；
//   真机上同一批声明由内核求值——本组件是"同一份声明、另一个宿主"。
import { onMounted, onUnmounted, ref } from 'vue'
import type { EngineAnim } from '@proteus-vue/animation'
import SigilSvg from './SigilSvg.vue'
import { compile, createRunner, motionAllowed, settle, type Runner } from '../../motion/engine-motion'

const sigil = ref<InstanceType<typeof SigilSvg>>()
const rootEl = ref<HTMLElement>()
let runner: Runner | null = null

onMounted(() => {
  const sv = sigil.value
  const host = rootEl.value
  if (!sv || !host) return
  const arcs = (sv.arcEls ?? []).filter((p): p is SVGPathElement => !!p && typeof p.getTotalLength === 'function')
  if (arcs.length < 3) return

  // ★声明（**驱动本组件的全部输入**）：三段弧逐段画出（错峰）→ 基座 → 整枚上光（无限呼吸）
  //   → 扫描弧旋转（无限）→ 核心呼吸缩放（与发光错相，制造"心跳"）
  const batch: EngineAnim[] = []
  const lens = new Map<number, number>()
  arcs.forEach((p, i) => {
    const nodeId = i + 1
    batch.push(...compile([{ kind: 'strokeProgress', from: 0, to: 1, durationMs: 1150 - i * 90, delayMs: i * 330, curve: 'easeInOut' }], nodeId))
    lens.set(nodeId, p.getTotalLength())
  })
  if (sv.baseEl) {
    batch.push(...compile([{ kind: 'strokeProgress', from: 0, to: 1, durationMs: 620, delayMs: 1020, curve: 'easeOut' }], 4))
    lens.set(4, sv.baseEl.getTotalLength())
  }
  // 发光绑在 **svg 根**：一层 filter 罩住全部部件（光晕盘/光带/弧/核心一起亮；比逐部件省）
  if (sv.svgEl) batch.push(...compile([{ kind: 'glowIntensity', from: 0.12, to: 1, durationMs: 2100, delayMs: 1500, repeat: 'infinite', direction: 'alternate', curve: 'easeInOut' }], 5))
  if (sv.sweepEl) batch.push(...compile([{ kind: 'rotate', from: 0, to: 360, durationMs: 26000, delayMs: 1500, repeat: 'infinite', curve: 'linear' }], 6))
  if (sv.coreEl) batch.push(...compile([{ kind: 'scale', from: 1, to: 1.12, durationMs: 2100, delayMs: 1500, repeat: 'infinite', direction: 'alternate', curve: 'easeInOut' }], 7))

  const slots = new Map<number, SVGElement | HTMLElement>()
  arcs.forEach((p, i) => slots.set(i + 1, p))
  if (sv.baseEl) slots.set(4, sv.baseEl)
  if (sv.svgEl) slots.set(5, sv.svgEl)
  if (sv.sweepEl) slots.set(6, sv.sweepEl)
  if (sv.coreEl) slots.set(7, sv.coreEl)

  if (!motionAllowed()) {
    settle(batch, slots, { strokeLens: lens })
    return
  }
  runner = createRunner(batch, slots, { strokeLens: lens, durationMs: 3600 })
  runner.play()
})
onUnmounted(() => runner?.stop())
</script>

<template>
  <div ref="rootEl" class="mark" aria-hidden="true">
    <SigilSvg ref="sigil" :size="220" />
  </div>
</template>

<style scoped>
.mark { display: block; width: 220px; max-width: 46%; }
.mark :deep(svg) { width: 100%; height: auto; }
</style>

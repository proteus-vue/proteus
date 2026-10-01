<script setup lang="ts">
// website/src/components/anim/MorpheusHud.vue —— ★★**活的徽记**（产品页的"灵魂元素"）
//
// 【它为什么存在（产品主张的字面实现）】
//   Morpheus 的主张是「**一份声明 → 任意宿主**」。本组件就是这句话的现场演示：
//   页面上**任何一处动效**在跑（入场/指针驱动/时间轴/曲线自画/开幕），本徽记的环形、
//   核心与曲线谱就**跟着同一个数据流**动——数据来自 `engine-motion` 的演出总线
//   （每帧上报"多少条指令在推进"），而不是另写一段装饰动画。
//   ⇒ 观众看到的不是"网站装饰"，而是**引擎自己的心跳**。
//
// 【三件读数（全部真实，不做假）】
//   ① 环：外两圈按能量调转速（静止时几乎不转，演出时明显加速）——能量 = 活跃指令占比；
//   ② 核：亮度/光晕随能量呼吸（无限循环的动效会让它一直"活着"）；
//   ③ 谱：最近编译批的**曲线形状**（用与 Rust 内核 golden 对拍的 `curveEval` 现画）
//      ——换一条曲线，谱就换一条（与工作台联动）。
//
// 【安全边界】纯装饰 + 只读读数：`aria-hidden`（不干扰读屏/工具栏），pointer-events 仅自身。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onActivity, SITE_STATS, type ActivityReport } from '../../motion/engine-motion'
import { curveEval } from '@proteus-vue/slot-runtime'

const report = ref<ActivityReport>({ active: 0, total: 0, energy: 0, lastBatch: null })
let off: (() => void) | null = null
onMounted(() => {
  off = onActivity((r) => {
    report.value = { ...r }
  })
})
onUnmounted(() => off?.())

const energy = computed(() => report.value.energy)
const smooth = ref(0)
/** 能量平滑（徽记的动率跟随；避免逐帧跳变——这里做的是"表盘阻尼"，不是动画本身） */
let last = 0
let raf = 0
function tick(now: number): void {
  const dt = Math.min(64, now - (last || now)) / 1000
  last = now
  const target = energy.value
  const next = smooth.value + (target - smooth.value) * Math.min(1, dt * 5)
  if (Math.abs(next - smooth.value) > 0.0005) smooth.value = next
  raf = requestAnimationFrame(tick)
}
onMounted(() => {
  raf = requestAnimationFrame(tick)
})
onUnmounted(() => {
  if (raf) cancelAnimationFrame(raf)
})

/** 外两圈转速（度/秒）：静止 3°/s 的"待机"，演出时按能量提到 ~90°/s */
const spinDeg = computed(() => 3 + smooth.value * 87)
/** 核心亮度/半径随能量（静止 0.35 的余晖，演出时到 1） */
const coreA = computed(() => 0.35 + smooth.value * 0.65)
const coreR = computed(() => 5.4 + smooth.value * 2.4)
const glowPx = computed(() => 8 + smooth.value * 26)

/** 谱：最近批的曲线（静态形状；换曲线即换谱——与工作台/曲线区联动） */
const curvePath = computed(() => {
  const c = report.value.lastBatch?.curve ?? 1
  const N = 40
  const pts: string[] = []
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const v = curveEval(c, u)
    pts.push(`${(4 + u * 60).toFixed(2)},${(44 - v * 34).toFixed(2)}`)
  }
  return `M${pts.join(' L')}`
})
const curveName = computed(() => {
  const c = report.value.lastBatch?.curve ?? 1
  return (['linear', 'easeOut', 'easeIn', 'easeInOut', 'springApprox'] as const)[c] ?? `#${c}`
})

/** 展开/收起（默认收起 = 一枚徽记；点开 = 演出监视器） */
const open = ref(false)
</script>

<template>
  <!-- ★固定角标：徽记本体（能量驱动的环/核/谱——数据来自演出总线） -->
  <div
    class="hud"
    :class="{ 'hud--open': open }"
    :style="{ '--durA': `${(360 / spinDeg).toFixed(2)}s`, '--durB': `${(360 / Math.max(1, spinDeg * 0.62)).toFixed(2)}s` }"
    aria-hidden="true"
  >
    <button class="hud-btn" type="button" @click="open = !open" :aria-expanded="open">
      <svg viewBox="0 0 96 96" class="hud-svg" fill="none">
        <!-- 两圈轨道（能量调转速；CSS 动画驱动角速度——值来自总线的 --spin） -->
        <g class="hud-ring hud-ring--a"><circle cx="48" cy="48" r="40" /></g>
        <g class="hud-ring hud-ring--b"><circle cx="48" cy="48" r="33" /></g>
        <!-- 核心（亮度/半径/光晕随能量） -->
        <circle
          cx="48"
          cy="48"
          :r="coreR"
          class="hud-core"
          :style="{ opacity: coreA, filter: `drop-shadow(0 0 ${glowPx.toFixed(1)}px rgba(124,92,255,0.9))` }"
        />
      </svg>
      <span class="hud-tag">{{ open ? '演出监视器' : 'Morpheus' }}</span>
    </button>

    <!-- 展开：真实读数 + 曲线谱（与引擎的编译产物同源） -->
    <div v-if="open" class="hud-panel">
      <div class="hud-row">
        <span class="hud-k">本页指令</span>
        <span class="hud-v hud-v--num">{{ SITE_STATS.declarative }}</span>
      </div>
      <div class="hud-row">
        <span class="hud-k">正在推进</span>
        <span class="hud-v hud-v--num">{{ report.active }} / {{ report.total }}</span>
      </div>
      <div class="hud-row">
        <span class="hud-k">最近批</span>
        <span class="hud-v">{{ report.lastBatch ? `${report.lastBatch.count} 条 · kind ${report.lastBatch.kind}` : '—' }}</span>
      </div>
      <div class="hud-row">
        <span class="hud-k">曲线</span>
        <span class="hud-v">{{ curveName }}</span>
      </div>
      <svg viewBox="0 0 68 48" class="hud-curve" fill="none">
        <line x1="4" y1="44" x2="64" y2="44" />
        <line x1="4" y1="44" x2="4" y2="8" />
        <path :d="curvePath" />
      </svg>
      <p class="hud-note">徽记与页面共演同一个编译产物——数据来自引擎每帧上报，不是装饰动画。</p>
    </div>
  </div>
</template>

<style scoped>
.hud {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  font-family: var(--mono);
}
.hud-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px 8px 8px;
  background: rgba(14, 14, 20, 0.86);
  border: 1px solid rgba(124, 92, 255, 0.3);
  border-radius: var(--radius-pill);
  cursor: pointer;
  backdrop-filter: blur(10px);
}
.hud-svg { width: 34px; height: 34px; flex: none; }
.hud-ring circle {
  fill: none;
  stroke: rgba(124, 92, 255, 0.55);
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-dasharray: 42 18;
  transform-origin: 48px 48px;
  animation: hud-spin var(--dur, 6s) linear infinite;
}
.hud-ring--a circle { --dur: var(--durA, 6s); stroke-dasharray: 52 12; }
.hud-ring--b circle { --dur: var(--durB, 9s); stroke-dasharray: 30 22; animation-direction: reverse; opacity: 0.72; }
@keyframes hud-spin { to { transform: rotate(360deg); } }
.hud-core { fill: var(--brand-ink); transition: none; }
.hud-tag { font-size: 11px; letter-spacing: 0.08em; color: var(--muted); }
.hud-panel {
  width: 216px;
  padding: 14px 15px;
  background: rgba(13, 13, 19, 0.94);
  border: 1px solid rgba(124, 92, 255, 0.28);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(12px);
}
.hud-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 3px 0; }
.hud-k { font-size: 10.5px; color: var(--dim); letter-spacing: 0.06em; }
.hud-v { font-size: 11.5px; color: var(--muted); }
.hud-v--num { font-size: 13px; color: var(--brand-ink); font-weight: 700; }
.hud-curve { width: 100%; height: auto; margin: 8px 0 4px; }
.hud-curve line { stroke: rgba(255, 255, 255, 0.14); stroke-width: 0.8; }
.hud-curve path { stroke: var(--brand); stroke-width: 1.6; }
.hud-note { font-size: 10px; line-height: 1.6; color: var(--dim); margin: 4px 0 0; }
</style>

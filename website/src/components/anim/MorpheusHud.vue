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
// 【★视觉语言（2026-10-01 重做——用户反馈"太线条化"）】几何/层次与 Hero 印记共用
//   `SigilSvg.vue` 的五层（光晕盘 / 光带环 / 渐变弧 / 轨道节点 / 分层核心）；HUD 是小尺寸
//   那份：`strokeScale` 按比例加粗（38px 下不加粗就细成发丝）+ 环带自转 + 核心随能量。
//
// 【三件读数（全部真实，不做假）】
//   ① 环带：自转周期按能量（待机 ~7s/圈 → 演出时 ~1.9s/圈）——能量 = 活跃指令占比；
//   ② 核心：亮度/光晕随能量呼吸（无限循环的动效会让它一直"活着"）；
//   ③ 谱：最近编译批的**曲线形状**（用与 Rust 内核 golden 对拍的 `curveEval` 现画）
//      ——换一条曲线，谱就换一条（与工作台联动）。
//
// 【安全边界】纯装饰 + 只读读数：`aria-hidden`（不干扰读屏/工具栏），pointer-events 仅自身。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onActivity, SITE_STATS, type ActivityReport } from '../../motion/engine-motion'
import { curveEval } from '@proteus-vue/slot-runtime'
import SigilSvg from './SigilSvg.vue'

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

/** 环带自转周期（秒）：待机 7s/圈 → 演出时 1.9s/圈（值来自能量，注入 SigilSvg） */
const durA = computed(() => `${(7 - smooth.value * 5.1).toFixed(2)}s`)
const durB = computed(() => `${(11 - smooth.value * 7.4).toFixed(2)}s`)

/** 核心（外晕 + 亮核）随能量：待机 0.4 的余晖 → 演出 1 */
const sigil = ref<InstanceType<typeof SigilSvg>>()
const coreEl = ref<SVGGElement | null>(null)
let lastA = -1
let rafCore = 0
function paintCore(): void {
  const el = coreEl.value
  if (!el) return
  const a = 0.4 + smooth.value * 0.6
  el.style.opacity = String(a)
  el.style.filter = `drop-shadow(0 0 ${(5 + smooth.value * 22).toFixed(1)}px rgba(124,92,255,${(0.35 + smooth.value * 0.55).toFixed(2)}))`
}
function coreTick(): void {
  if (Math.abs(smooth.value - lastA) > 0.01) {
    lastA = smooth.value
    paintCore()
  }
  rafCore = requestAnimationFrame(coreTick)
}

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

onMounted(() => {
  rafCore = requestAnimationFrame(coreTick)
  // 等子组件挂载后再抓核心元素（组件 ref 的解析时机）
  requestAnimationFrame(() => {
    coreEl.value = sigil.value?.coreEl ?? null
    paintCore()
  })
})
onUnmounted(() => {
  if (rafCore) cancelAnimationFrame(rafCore)
})
</script>

<template>
  <!-- ★固定角标：徽记本体（能量驱动的环/核/谱——数据来自演出总线） -->
  <div class="hud" :class="{ 'hud--open': open }" aria-hidden="true">
    <button class="hud-btn" type="button" @click="open = !open" :aria-expanded="open">
      <SigilSvg ref="sigil" :size="38" :stroke-scale="2.1" :spin="true" :dur-a="durA" :dur-b="durB" />
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
@keyframes hud-spin { to { transform: rotate(360deg); } }
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

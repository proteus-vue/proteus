<script setup lang="ts">
// website/src/components/anim/OpeningCeremony.vue —— ★★**开幕仪式**：引擎把自己的产品页"打开"
//
// 【它为什么存在（灵魂元素的第二件）】
//   动画引擎的官网，开场不该是"渐显的标题"——应当是**引擎当场证明自己**：
//   徽记**自己落笔成形**（strokeProgress）→ 核心点亮（glowIntensity）→ 标题**从雾里渗开**
//   （maskProgress 软边揭示）→ 两道弧光收拢 → 帷幕上抽（clip 扫除）让出页面。
//   全程 8 个节点、一批引擎编译产物驱动——观众看到的第一件事就是引擎在工作。
//
// 【何时播 / 何时不播（都不靠记忆，靠机器判据）】
//   · `prefers-reduced-motion` ⇒ 不播（父组件不发车）；
//   · 每次**页面加载**只播一次（模块级标志——刷新可重看，适合分享链接）；
//   · 任意交互（点击/滚轮/按键/触摸）⇒ 立即跳过（跳过键常驻可见）。
import { onMounted, onUnmounted, ref } from 'vue'
import type { AnimDecl } from '@proteus-vue/animation'
import { compile, createRunner, settle, motionAllowed, type Runner } from '../../motion/engine-motion'
import { markOpeningPlayed } from '../../motion/opening'

const emit = defineEmits<{ done: [] }>()
// ★策略在 `src/motion/opening.ts`（`<script setup>` 不允许 export——首版因此构建失败）

/** 大徽记几何（viewBox 240×240，圆心 120,120） */
const ARCS = [
  { r: 104, a0: -150, a1: 44, w: 3.2 },
  { r: 78, a0: 26, a1: 212, w: 2.6 },
  { r: 52, a0: -104, a1: 96, w: 2.0 },
] as const
const P = (a: number, r: number): string => {
  const rad = (a * Math.PI) / 180
  return `${(120 + r * Math.cos(rad)).toFixed(2)} ${(120 + r * Math.sin(rad)).toFixed(2)}`
}
const arcPath = (a: (typeof ARCS)[number]): string => {
  const large = Math.abs(a.a1 - a.a0) > 180 ? 1 : 0
  return `M${P(a.a0, a.r)} A${a.r} ${a.r} 0 ${large} 1 ${P(a.a1, a.r)}`
}

const rootEl = ref<HTMLElement>()
const arcEls = ref<SVGPathElement[]>([])
const baseEl = ref<SVGPathElement>()
const coreEl = ref<SVGGElement>()
const titleEl = ref<HTMLElement>()
const subEl = ref<HTMLElement>()
const veilEl = ref<HTMLElement>()
let runner: Runner | null = null
let doneTimer: ReturnType<typeof setTimeout> | null = null
let finished = false

/** 结束（幂等）：卸帷幕 → 通知父组件 */
function finish(): void {
  if (finished) return
  finished = true
  if (runner) runner.stop()
  if (doneTimer) clearTimeout(doneTimer)
  emit('done')
}

onMounted(() => {
  markOpeningPlayed()
  const arcs = arcEls.value.filter((p): p is SVGPathElement => !!p && typeof p.getTotalLength === 'function')
  const nodes = new Map<number, SVGElement>()
  arcs.forEach((p, i) => nodes.set(i + 1, p))
  if (baseEl.value) nodes.set(7, baseEl.value)
  if (coreEl.value) nodes.set(4, coreEl.value)
  const slots = new Map<number, HTMLElement | SVGElement>(nodes)

  // 标题/副题/帷幕（HTML 侧）——软遮罩与裁剪扫除都在 CSS 里消费引擎写的值
  if (titleEl.value) {
    slots.set(5, titleEl.value)
    titleEl.value.style.setProperty('--mkind', 'linear')
  }
  if (subEl.value) slots.set(6, subEl.value)
  if (veilEl.value) {
    slots.set(8, veilEl.value)
  }

  const anims = [
    ...arcs.flatMap((_, i) => compile([{ kind: 'strokeProgress', from: 0, to: 1, durationMs: 1000, delayMs: i * 260, curve: 'easeInOut' }], i + 1)),
    ...(baseEl.value
      ? compile([{ kind: 'strokeProgress', from: 0, to: 1, durationMs: 700, delayMs: 420, curve: 'easeOut' }], 7)
      : []),
    ...(coreEl.value
      ? [
          ...compile([{ kind: 'glowIntensity', from: 0.15, to: 1, durationMs: 900, delayMs: 1000, curve: 'easeOut' }], 4),
          ...compile([{ kind: 'opacity', from: 0, to: 1, durationMs: 700, delayMs: 1050, curve: 'easeOut' }], 4),
        ]
      : []),
    ...(titleEl.value ? compile([{ kind: 'maskProgress', from: 0, to: 1, durationMs: 900, delayMs: 1500, curve: 'easeInOut' }], 5) : []),
    ...(subEl.value ? compile([{ kind: 'maskProgress', from: 0, to: 1, durationMs: 800, delayMs: 1980, curve: 'easeOut' }], 6) : []),
    // 帷幕上抽（clip inset bottom 0→1：从底边扫除 ⇒ 页面自下而上让出）+ 轻微上移
    ...(veilEl.value
      ? [
          ...compile([{ kind: 'clip', from: [0, 0, 0, 0], to: [0, 0, 1, 0], durationMs: 760, delayMs: 2980, curve: 'easeInOut' } as AnimDecl], 8),
          ...compile([{ kind: 'translateY', from: 0, to: -26, durationMs: 760, delayMs: 2980, curve: 'easeInOut' }], 8),
        ]
      : []),
  ]

  const lens = new Map<number, number>()
  arcs.forEach((p, i) => lens.set(i + 1, p.getTotalLength()))
  if (baseEl.value) lens.set(7, baseEl.value.getTotalLength())

  if (!motionAllowed()) {
    settle(anims, slots, { strokeLens: lens, clipKinds: new Map([[8, 'inset' as const]]) })
    finish()
    return
  }
  runner = createRunner(anims, slots, { strokeLens: lens, clipKinds: new Map([[8, 'inset']]), durationMs: 3760 })
  runner.play()
  doneTimer = setTimeout(finish, 3780)

  // 任意交互 ⇒ 立即跳过（点击/滚轮/按键/触摸；跳过键亦在其列）
  const skip = (): void => finish()
  rootEl.value?.addEventListener('pointerdown', skip)
  window.addEventListener('keydown', skip) // d2-exempt: 跳过键需要全局按键（无框架原语；仅此一处监听）
  window.addEventListener('wheel', skip, { passive: true }) // d2-exempt: 滚轮跳过（同上）
  onUnmounted(() => {
    rootEl.value?.removeEventListener('pointerdown', skip)
    window.removeEventListener('keydown', skip) // d2-exempt: 与上方登记同因（清理）
    window.removeEventListener('wheel', skip) // d2-exempt: 与上方登记同因（清理）
  })
})
onUnmounted(() => {
  runner?.stop()
  if (doneTimer) clearTimeout(doneTimer)
})
</script>

<template>
  <!-- ★Teleport 到 body（**实测抓出的层级缺陷**）：本页的 `<main>` 是 flex 子项且带 `z-index:1`
       ⇒ 它自成 stacking context ⇒ 无论内部 z-index 多大，都盖不住同级的 sticky 导航
       （实测：帷幕下方露出导航栏）。Teleport 到 body 后与导航同级，z-index 才真正生效。 -->
  <Teleport to="body">
  <div ref="rootEl" class="op" role="presentation">
    <!-- 帷幕（节点 8：clip 扫除 + 上移——用引擎的裁剪通道，不是 CSS 动画） -->
    <div ref="veilEl" class="op-veil">
      <div class="op-stage">
        <svg viewBox="0 0 240 240" class="op-sigil" fill="none">
          <path v-for="(a, i) in ARCS" :key="i" ref="arcEls" :d="arcPath(a)" class="op-arc" :stroke-width="a.w" stroke-linecap="round" />
          <path ref="baseEl" d="M84 196 L156 196" class="op-base" stroke-width="2" stroke-linecap="round" />
          <g ref="coreEl" class="op-core-g">
            <circle cx="120" cy="120" r="8" class="op-core" />
          </g>
        </svg>
        <div class="op-title-wrap">
          <h1 ref="titleEl" class="op-title">Morpheus</h1>
          <p ref="subEl" class="op-sub">声明式动画引擎 · 一份声明 → 任意宿主</p>
        </div>
      </div>
      <button class="op-skip" type="button" @click="finish">跳过 ›</button>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.op {
  position: fixed;
  inset: 0;
  z-index: 90;
}
.op-veil {
  position: absolute;
  inset: 0;
  background: radial-gradient(80% 60% at 50% 42%, #14131f 0%, #0a0a10 62%, #06060a 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}
.op-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 26px;
}
.op-sigil { width: 220px; height: 220px; }
.op-arc {
  stroke: var(--brand);
  stroke-dasharray: 1200;
  stroke-dashoffset: 1200;
}
.op-base { stroke: var(--accent); stroke-dasharray: 120; stroke-dashoffset: 120; }
.op-core { fill: #fff; }
.op-core-g { opacity: 0; }
/* 标题：**软遮罩**由 maskProgress 驱动（引擎写 --mmix，这里只消费——
   与两端宿主"零揭示数学"同一条纪律） */
.op-title {
  margin: 0;
  font-size: 44px;
  letter-spacing: -0.02em;
  font-weight: 800;
  color: var(--ink);
  --pct: calc(var(--mmix, 0) * 100%);
  mask-image: linear-gradient(180deg, #000 calc(var(--pct) - 22%), transparent var(--pct));
  -webkit-mask-image: linear-gradient(180deg, #000 calc(var(--pct) - 22%), transparent var(--pct));
}
.op-sub {
  margin: 10px 0 0;
  font-family: var(--mono);
  font-size: 13px;
  letter-spacing: 0.14em;
  color: var(--dim);
  --pct: calc(var(--mmix, 0) * 100%);
  mask-image: linear-gradient(180deg, #000 calc(var(--pct) - 26%), transparent var(--pct));
  -webkit-mask-image: linear-gradient(180deg, #000 calc(var(--pct) - 26%), transparent var(--pct));
}
.op-title-wrap { text-align: center; }
.op-skip {
  position: absolute;
  right: 24px;
  bottom: 24px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
  cursor: pointer;
}
.op-skip:hover { border-color: var(--brand); color: var(--ink); }
</style>

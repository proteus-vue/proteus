<script setup lang="ts">
// website/src/components/anim/EngineMark.vue —— ★★Hero 印记：**引擎画出来的**标志
//
// 【这一块是什么（产品页即炫技场的第一处证据）】
//   三圈轨道弧 + 一条基线——由引擎的 **strokeProgress（通道 31）** 逐段"画出来"，
//   随后用 **glowIntensity（通道 34）** 上光，最后两条无限循环（rotate / opacity 呼吸）让它**活着**。
//   ⇒ 页面打开的第一眼，看到的就是引擎在自己身上跑。
//
// 【每一条声明都可在文档里找到】`strokeProgress` / `glowIntensity` / `repeat: 'infinite'`
//   全是声明面封闭集里的原语（见 /docs/animation/02-surface）；本组件的 `<template>` 下方
//   附原始声明（`MARK_DECLS`），页面把它当读数展示——声明与效果同源可对。
//
// 【宿主口径（诚实）】曲线求值走与 Rust 内核 golden 对拍的 TS 镜像（`animValue`）；
//   真机上同一批声明由内核求值——本组件是"同一份声明、另一个宿主"。
import { onMounted, onUnmounted, ref } from 'vue'
import type { AnimDecl } from '@proteus-vue/animation'
import { compile, createRunner, motionAllowed, settle, type Runner } from '../../motion/engine-motion'

/** 三圈轨道 + 基线的 SVG 尺寸（viewBox 口径；线宽与终点角度成组出现） */
const VB = { w: 220, h: 132 } as const

/** 每段弧的几何（中心 / 半径 / 起止角）——与模板逐一对应 */
const ARCS = [
  { cx: 110, cy: 64, r: 52, a0: -152, a1: 40, w: 2.6, delay: 0 },
  { cx: 110, cy: 64, r: 37, a0: 28, a1: 214, w: 2.0, delay: 260 },
  { cx: 110, cy: 64, r: 22, a0: -110, a1: 96, w: 1.6, delay: 520 },
] as const

const P = (a: number, r: number, cx: number, cy: number): string => {
  const rad = (a * Math.PI) / 180
  return `${(cx + r * Math.cos(rad)).toFixed(2)} ${(cy + r * Math.sin(rad)).toFixed(2)}`
}

const arcPath = (a: (typeof ARCS)[number]): string => {
  const large = Math.abs(a.a1 - a.a0) > 180 ? 1 : 0
  return `M${P(a.a0, a.r, a.cx, a.cy)} A${a.r} ${a.r} 0 ${large} 1 ${P(a.a1, a.r, a.cx, a.cy)}`
}

const BASE = { x0: 26, x1: 194, y: 116 } as const
const basePath = `M${BASE.x0} ${BASE.y} L${BASE.x1} ${BASE.y}`

/** 扫描弧（外圈的一段虚线，由 SWEEP_DECL 无限旋转；转动中心 = 圆心） */
const sweepPath = (() => {
  const r = 62
  return `M${P(-40, r, 110, 64)} A${r} ${r} 0 0 1 ${P(28, r, 110, 64)}`
})()

/**
 * ★声明（**这就是驱动本组件的全部输入**）——每段弧一条描边进度（逐段画出），
 * 随后对**每个元素**上光（发光通道逐元素绑定），最后无限循环呼吸（yoyo = 来回）。
 */
const ARC_DECLS = (i: number): AnimDecl[] => [
  { kind: 'strokeProgress', from: 0, to: 1, durationMs: i < 3 ? 1150 : 820, delayMs: i < 3 ? i * 330 : 980, curve: i < 3 ? 'easeInOut' : 'easeOut' },
]
const GLOW_DECL: AnimDecl = {
  kind: 'glowIntensity',
  from: 0.15,
  to: 1,
  durationMs: 2100,
  delayMs: 1900,
  repeat: 'infinite',
  direction: 'alternate',
  curve: 'easeInOut',
}
/** ★外圈"扫描环"（无限旋转；画完后一直转——印记"活着"的第二条声明） */
const SWEEP_DECL: AnimDecl = {
  kind: 'rotate',
  from: 0,
  to: 360,
  durationMs: 14000,
  delayMs: 1900,
  repeat: 'infinite',
  curve: 'linear',
}

const rootEl = ref<HTMLElement>()
const strokePaths = ref<SVGPathElement[]>([])
const baseEl = ref<SVGPathElement>()
const sweepEl = ref<SVGGElement>()
let runner: Runner | null = null

onMounted(() => {
  const host = rootEl.value
  if (!host) return
  const paths = [strokePaths.value[0], strokePaths.value[1], strokePaths.value[2], baseEl.value].filter(
    (p): p is SVGPathElement => !!p && typeof p.getTotalLength === 'function',
  )
  if (paths.length < 4) return
  // ★每个元素一个 nodeId（1..4）：该元素的描边 + 该元素的发光——同一份编译链（真校验），
  //   只是把 nodeId 换成对应元素（与真机多节点批次同构）。
  const anims = paths.flatMap((_, i) => {
    const nodeId = i + 1
    return [...compile(ARC_DECLS(i), nodeId), ...compile([GLOW_DECL], nodeId)]
  })
  const slots = new Map<number, SVGElement>()
  paths.forEach((p, i) => slots.set(i + 1, p))
  const lens = new Map<number, number>()
  paths.forEach((p, i) => lens.set(i + 1, p.getTotalLength()))
  // ★扫描环（节点 5）：无限旋转（绕圆心——transform-origin 用 SVG 用户单位）
  const sweep = sweepEl.value
  if (sweep) {
    slots.set(5, sweep)
    anims.push(...compile([SWEEP_DECL], 5))
    sweep.style.transformOrigin = '110px 64px'
  }
  if (!motionAllowed()) {
    settle(anims, slots, { strokeLens: lens })
    return
  }
  runner = createRunner(anims, slots, { strokeLens: lens, durationMs: 3400 })
  runner.play()
})
onUnmounted(() => runner?.stop())
</script>

<template>
  <!-- ★原生 div + svg（不用 p-view）：模板 ref 要拿**元素**——组件 ref 会拿到组件实例
       （本组件第一版即因此静默失效：dashoffset 全 0，浏览器验收抓出） -->
  <div ref="rootEl" class="mark" aria-hidden="true">
    <svg :viewBox="`0 0 ${VB.w} ${VB.h}`" class="mark-svg" fill="none">
      <path
        v-for="(a, i) in ARCS"
        :key="i"
        ref="strokePaths"
        :d="arcPath(a)"
        class="mark-stroke"
        :stroke-width="a.w"
        stroke-linecap="round"
      />
      <path ref="baseEl" :d="basePath" class="mark-stroke mark-stroke--base" stroke-width="1.6" stroke-linecap="round" />
      <g ref="sweepEl" class="mark-sweep">
        <path :d="sweepPath" class="mark-sweep-arc" stroke-width="1.2" stroke-linecap="round" />
      </g>
      <circle cx="110" cy="64" r="3.4" class="mark-core" />
    </svg>
  </div>
</template>

<style scoped>
.mark {
  display: block;
  width: 220px;
  max-width: 46%;
}
.mark-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}
.mark-stroke {
  stroke: var(--brand);
  /* ★初始"未画"（dash 由引擎写；这里给兜底，防 JS 未就绪时露整条线） */
  stroke-dasharray: 1000;
  stroke-dashoffset: 1000;
}
.mark-stroke--base {
  stroke: var(--accent);
  opacity: 0.9;
}
.mark-core {
  fill: var(--brand-ink);
}
.mark-sweep { display: block; }
.mark-sweep-arc {
  stroke: rgba(124, 92, 255, 0.42);
  stroke-dasharray: 3 7;
}
</style>

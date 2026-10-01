<script setup lang="ts">
// website/src/components/anim/SigilSvg.vue —— ★★**徽记的视觉语言**（三处共用：Hero / 开幕 / 右下角 HUD）
//
// 【为什么要抽成一个组件（用户反馈："徽记感觉太线条化了"）】
//   首版的徽记是"三圈细描线 + 一个点"——**只有轮廓没有体量**：像工程示意图，不像一个"徽记"。
//   视觉语言重做了五层（从后到前），每一层都有明确职责：
//     ① **光晕盘**——最大的体量来源（径向渐变、低透明度），让徽记"发光"而不是"画线"；
//     ② **光带环**——与三段弧同半径的**粗浅环**（宽 stroke + 低透明度 + 渐变描边）——
//        给环"带子"的实体感（细线变成"有宽度的环"），三段弧画在它上面；
//     ③ **三段弧**（可动画：strokeProgress 逐段画出）——渐变描边（品牌紫 → 暖橙），圆头；
//     ④ **轨道节点**——弧端的小圆点（实心高亮）：像仪表的刻度/行星，打破"纯线条"；
//     ⑤ **分层核心**——外晕 + 环 + 亮核三层（不是单点）。
//
// 【三处共用同一份几何】Hero 印记 / 开幕大徽记 / 右下角 HUD 徽记——**同一套视觉语言**，
//   只有尺寸与 `strokeScale`（小尺寸要按比例加粗，否则 34px 下变成一根发丝）不同。
//
// 【跨实例的 id 唯一性】SVG 的 `<defs>` id 是**全文档作用域**——多个实例用同一个 id 会
//   全部引用到第一份定义（改一个颜色三处全变）。⇒ 用 Vue 3.5 的 `useId()` 生成实例唯一 id。
import { useId, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 显示尺寸（px；正方形） */
    size?: number
    /** 描边加粗倍数（小尺寸用——34px 下若不加粗，线宽会碎成发丝） */
    strokeScale?: number
    /** 是否画旋转扫描弧（默认 true；HUD 用） */
    sweep?: boolean
    /** 环带是否自转（CSS 驱动；HUD 用——转速由能量算，见 MorpheusHud） */
    spin?: boolean
    /** 自转周期（秒；由调用方按能量注入） */
    durA?: string
    durB?: string
  }>(),
  { size: 220, strokeScale: 1, sweep: true, spin: false, durA: '7s', durB: '11s' },
)

const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
const idStroke = `sigil-stroke-${uid}`
const idHalo = `sigil-halo-${uid}`
const idCore = `sigil-core-${uid}`
const idBand = `sigil-band-${uid}`

/** 三段弧（半径 / 起止角 / 线宽 / 与光带共用的半径）——三处共用同一组几何常数 */
const ARCS = [
  { r: 104, a0: -150, a1: 44, w: 3.2 },
  { r: 78, a0: 26, a1: 212, w: 2.6 },
  { r: 52, a0: -104, a1: 96, w: 2.0 },
] as const
const BASE = { y: 196, x0: 84, x1: 156, w: 2.0 } as const

const P = (a: number, r: number): string => {
  const rad = (a * Math.PI) / 180
  return `${(120 + r * Math.cos(rad)).toFixed(2)} ${(120 + r * Math.sin(rad)).toFixed(2)}`
}
const arcPath = (a: (typeof ARCS)[number]): string => {
  const large = Math.abs(a.a1 - a.a0) > 180 ? 1 : 0
  return `M${P(a.a0, a.r)} A${a.r} ${a.r} 0 ${large} 1 ${P(a.a1, a.r)}`
}
/** 轨道节点：三段弧的**终点**（每段画完后"停"在这里——节点就是叙事的一部分） */
const NODES = ARCS.map((a) => P(a.a1, a.r).split(' ').map(Number) as [number, number])
/** 扫描弧（旋转；虚线） */
const SWEEP = `M${P(-46, 66)} A66 66 0 1 1 ${P(134, 66)}`

const sw = (w: number): number => w * props.strokeScale

const svgEl = ref<SVGSVGElement>()
const arcEls = ref<SVGPathElement[]>([])
const baseEl = ref<SVGPathElement>()
const dialEl = ref<SVGGElement>()
const sweepEl = ref<SVGGElement>()
const coreEl = ref<SVGGElement>()

/** 暴露 DOM 部件（各调用方把引擎指令绑到这些元素上） */
defineExpose({ svgEl, arcEls, baseEl, dialEl, sweepEl, coreEl, ARCS: ARCS.length })
</script>

<template>
  <svg
    ref="svgEl"
    :width="size"
    :height="size"
    viewBox="0 0 240 240"
    class="sigil"
    :style="{ '--durA': durA, '--durB': durB }"
    fill="none"
  >
    <defs>
      <!-- 描边渐变：品牌紫 → 亮紫 → 暖橙（与站点 --brand/--accent 同族） -->
      <linearGradient :id="idStroke" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0" stop-color="#cbb9ff" />
        <stop offset="0.52" stop-color="#7c5cff" />
        <stop offset="1" stop-color="#ff9a6c" />
      </linearGradient>
      <!-- 光晕盘：中心亮紫 → 透明（体量的第一来源） -->
      <radialGradient :id="idHalo">
        <stop offset="0" stop-color="#7c5cff" stop-opacity="0.5" />
        <stop offset="0.55" stop-color="#5b3ee0" stop-opacity="0.18" />
        <stop offset="1" stop-color="#5b3ee0" stop-opacity="0" />
      </radialGradient>
      <!-- 光带环：两端淡、中段亮的横向渐变（环的"带子"感） -->
      <linearGradient :id="idBand" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8f76ff" stop-opacity="0.12" />
        <stop offset="0.5" stop-color="#b9a8ff" stop-opacity="0.3" />
        <stop offset="1" stop-color="#ff9a6c" stop-opacity="0.14" />
      </linearGradient>
      <!-- 分层核心：外晕 → 环 → 亮核 -->
      <radialGradient :id="idCore">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.98" />
        <stop offset="0.34" stop-color="#cfc0ff" stop-opacity="0.85" />
        <stop offset="1" stop-color="#7c5cff" stop-opacity="0" />
      </radialGradient>
    </defs>

    <!-- ① 光晕盘（体量；不受动画影响） -->
    <circle cx="120" cy="120" r="112" :fill="`url(#${idHalo})`" class="sigil-halo" />

    <!-- ②③④ 盘面：光带环 + 三段弧 + 轨道节点（整体可自转——HUD） -->
    <g ref="dialEl" class="sigil-dial" :class="{ 'sigil-dial--spin': spin }">
      <!-- 光带环（粗浅环，与弧同半径——"环是有宽度的"） -->
      <circle v-for="a in ARCS" :key="`band-${a.r}`" cx="120" cy="120" :r="a.r" :stroke="`url(#${idBand})`" :stroke-width="sw(a.w * 3.4)" class="sigil-band" />
      <!-- 三段弧（可动画：strokeProgress 逐段画出——gradient 描边 + 圆头） -->
      <path
        v-for="(a, i) in ARCS"
        :key="`arc-${a.r}`"
        ref="arcEls"
        :d="arcPath(a)"
        :stroke="`url(#${idStroke})`"
        :stroke-width="sw(a.w)"
        stroke-linecap="round"
        class="sigil-arc"
      />
      <!-- 基座线（两笔短划，像"落地刻度"） -->
      <path ref="baseEl" :d="`M${BASE.x0} ${BASE.y} L${BASE.x1} ${BASE.y}`" :stroke="`url(#${idStroke})`" :stroke-width="sw(BASE.w)" stroke-linecap="round" class="sigil-base" />
      <!-- 轨道节点（弧端亮点） -->
      <circle v-for="(n, i) in NODES" :key="`n-${i}`" :cx="n[0]" :cy="n[1]" :r="sw(3.1)" class="sigil-node" />
    </g>

    <!-- 扫描弧（旋转虚线——"活着"的第三处动） -->
    <g v-if="sweep" ref="sweepEl" class="sigil-sweep">
      <path :d="SWEEP" stroke="#cbb9ff" :stroke-width="sw(1.5)" stroke-linecap="round" class="sigil-sweep-arc" />
    </g>

    <!-- ⑤ 分层核心（外晕 + 环 + 亮核） -->
    <g ref="coreEl" class="sigil-core">
      <circle cx="120" cy="120" r="34" :fill="`url(#${idCore})`" />
      <circle cx="120" cy="120" r="15" stroke="#d9ccff" :stroke-width="sw(1.1)" opacity="0.6" />
      <circle cx="120" cy="120" r="8.4" fill="#fff" opacity="0.97" class="sigil-core-dot" />
    </g>
  </svg>
</template>

<style scoped>
.sigil { display: block; overflow: visible; }
.sigil-band { fill: none; stroke-linecap: round; }
.sigil-arc {
  fill: none;
  /* 未画态兜底（引擎接管后写 dasharray/dashoffset；此处防 JS 未就绪时露整条） */
  stroke-dasharray: 1200;
  stroke-dashoffset: 1200;
}
.sigil-base { fill: none; stroke-dasharray: 120; stroke-dashoffset: 120; }
.sigil-node { fill: #e9e2ff; }
.sigil-sweep { transform-origin: 120px 120px; animation: sigil-turn 16s linear infinite; }
.sigil-sweep-arc { fill: none; stroke-dasharray: 3 9; opacity: 0.5; }
@keyframes sigil-turn { to { transform: rotate(360deg); } }
.sigil-dial { transform-origin: 120px 120px; }
.sigil-dial--spin { animation: sigil-turn var(--durA, 7s) linear infinite; }
.sigil-dial--spin > .sigil-band:nth-child(2) { animation: sigil-turn var(--durB, 11s) linear infinite reverse; transform-origin: 120px 120px; }
.sigil-dial--spin > .sigil-band:nth-child(3) { animation: sigil-turn var(--durA, 7s) linear infinite; animation-direction: reverse; transform-origin: 120px 120px; }
</style>

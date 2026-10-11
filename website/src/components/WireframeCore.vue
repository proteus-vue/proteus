<template>
  <!-- ★★★2026-10-11「刷新瞬间 canvas 闪白」**根治（第二轮）**：
       第一轮用 `visibility:hidden` + 深色 `background` 隐藏，但**部分内核**（QQ 浏览器 X5 / 部分旧 Chromium）
       会**无视 CSS** 把「未绘制的 WebGL canvas」直接合成成**白块** ⇒ 只要 canvas 在 HTML 里（哪怕 hidden），
       从「元素入 DOM」到「GL 内容提交合成器」之间仍会闪白。
       ⇒ **治本 = canvas 在绘出首帧之前根本不进 DOM**：本组件只渲染一个**尺寸占位盒**（下面的 <div>），
          canvas 由脚本 createElement、待 GL 首帧就绪（`onReady`）后才 appendChild 进来 —— DOM 生命周期内
          **不存在「未绘制 canvas」这一状态**，白块从根上不再可能。占位盒 = 原 canvas 的定位盒（沿用外层类）。
       ★canvas 保持**透明**（不设 background）——恢复 2026-09-11 原始设计：线框发光叠在页面/容器渐变之上，
         而不是一块实底色（第一轮的深色 background 会盖住 chan-stage / cta-panel 的紫色渐变，属回归）。 -->
  <div ref="host" class="wf-host" :class="{ 'is-off': off }" aria-hidden="true" />
</template>

<script setup lang="ts">
// website/src/components/WireframeCore.vue —— 零依赖 WebGL 线框核心（Vue 壳）
//   ★2026-09-11：官网「炫技」元素回归——旧版是粒子场 + 3D 萌宠（AI 感重）；改为**工程精确风**的
//   线框几何体（icosahedron）：单色品牌紫、慢速旋转、深度衰减、边缘流光——零第三方依赖（无 three.js）。
//   价值主张：官网即框架编译产物，这块手写 WebGL 是「同一套工程标准」的自证（参见 visual/wireframe.ts）。
//   降级链：WebGL 不可用 → 引擎返回 null → 占位盒隐藏（布局不受影响）；prefers-reduced-motion → 静态单帧。
//
//   ★★★2026-10-11 白闪治理（见上方模板注释）：**canvas 首帧就绪后才插入 DOM**。就绪信号 = `onReady`
//   （`createWireframeCore` 在「首个真实 rAF 帧」或「still 静态帧」时回调；且引擎创建时已同步 draw +
//   gl.finish 一帧 ⇒ 即便走 setTimeout 兜底插入，也已是有内容的一帧，不是空白）。
import { onMounted, onUnmounted, ref } from 'vue'
import { createWireframeCore, type WireframeHandle } from '../visual/wireframe'

const props = defineProps({
  /** 线框颜色（hex，如 '#7c5cff'） */
  color: { type: String, default: '#7c5cff' },
  /** 不透明度 */
  alpha: { type: Number, default: 0.62 },
  /** 旋转速度（弧度/秒） */
  speed: { type: Number, default: 0.22 },
  /** 投影缩放（几何体占比） */
  scale: { type: Number, default: 0.82 },
})

const host = ref<HTMLDivElement | null>(null)
const off = ref(false)
let handle: WireframeHandle | null = null
let canvas: HTMLCanvasElement | null = null

/** hex → 0..1 三元组（容错：非 hex 回退品牌紫） */
function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0.486, 0.361, 1]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

onMounted(() => {
  const el = host.value
  if (!el) return

  // 创建 canvas（**暂不入 DOM**）——按占位盒的真实像素尺寸量好，传给引擎绘首帧（入 DOM 前 clientWidth=0，
  // 引擎用 opts.width/height 兜底，见 visual/wireframe.ts 的 resize()）。
  const rect = el.getBoundingClientRect()
  // 无框架原语：须创建**游离（未挂载）** canvas 元素（治白闪的关键——首帧前不进 DOM）。
  const cv = document.createElement('canvas') // d2-exempt: 无框架原语——须创建游离（未挂载）元素，框架无此举原语
  cv.setAttribute('aria-hidden', 'true')
  cv.style.display = 'block'
  cv.style.width = '100%'
  cv.style.height = '100%'
  cv.style.pointerEvents = 'none'
  canvas = cv

  // 幂等：仅当占位盒仍在文档中、且 canvas 尚未插入时插入。
  const reveal = (): void => {
    if (!host.value || !canvas || canvas.parentNode) return
    host.value.appendChild(canvas)
  }

  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  handle = createWireframeCore(cv, {
    color: hexToRgb01(props.color),
    alpha: props.alpha,
    speed: props.speed,
    scale: props.scale,
    still: reduce,
    width: rect.width,
    height: rect.height,
    onReady: reveal,
  })
  if (!handle) {
    // WebGL 不可用 → 隐藏占位盒（布局不受影响；装饰层缺失可接受）
    off.value = true
    return
  }
  // 兜底：后台标签页 rAF 被节流 ⇒ 迟迟不触发 onReady 时也要把 canvas 放进来（避免装饰永久缺失）。
  // 此时引擎创建时已**同步绘制过一帧**（createWireframeCore 内 draw() + gl.finish()），故插入的不是空白。
  setTimeout(reveal, 700)
})

onUnmounted(() => {
  handle?.destroy()
  handle = null
  canvas?.remove()
  canvas = null
})
</script>

<style scoped>
/* canvas 由脚本在 GL 首帧就绪后插入本占位盒；WebGL 不可用 ⇒ 整盒隐藏（布局不受影响）。 */
.wf-host.is-off { display: none; }
</style>

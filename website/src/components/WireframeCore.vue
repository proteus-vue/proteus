<template>
  <!-- ★★★内联样式（2026-10-11）：WebGL canvas 在**首次绘制提交合成之前**，HTML 解析到的那一瞬、
       某些内核（QQ浏览器 X5 / 部分 Chromium）会把它合成成**白色块**（刷新闪白）。
       两层防护（都走内联 style——不依赖外部 CSS 加载时序）：
         ① `visibility:hidden`：canvas **初始即隐藏**（不参与绘制/不提升合成层）；`onReady`（首个真实
            rAF 帧 = 内容已交合成器）后再置 visible（见 script）。★用 visibility 而非 opacity：
            opacity 仍会让元素参与合成（部分内核先铺白底再上透明度）+ transition 有半透明中间态。
         ② `background: var(--bg,#0b0b0f)`：兜底——即使某内核把"未绘制 canvas"显示出来，透出的也是
            **深色**（与页面底色同），而非白；WebGL 内容绘制后覆盖其上（透明处透出深色 = 无缝）。 -->
  <canvas
    ref="cv"
    class="wf-canvas"
    :class="{ 'is-off': off }"
    style="visibility: hidden; background: var(--bg, #0b0b0f)"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
// website/src/components/WireframeCore.vue —— 零依赖 WebGL 线框核心（Vue 壳）
//   ★2026-09-11：官网「炫技」元素回归——旧版是粒子场 + 3D 萌宠（AI 感重）；改为**工程精确风**的
//   线框几何体（icosahedron）：单色品牌紫、慢速旋转、深度衰减、边缘流光——零第三方依赖（无 three.js）。
//   价值主张：官网即框架编译产物，这块手写 WebGL 是「同一套工程标准」的自证（参见 visual/wireframe.ts）。
//   降级链：WebGL 不可用 → 引擎返回 null → canvas 隐藏；prefers-reduced-motion → 静态单帧。
//
//   ★★★2026-10-11「刷新一瞬间 canvas 闪白」**根治**：WebGL canvas 在"首次绘制内容提交合成器"之前，
//   浏览器（尤其国产内核）会把它合成成**白色块**。★**为什么用 visibility 而非 opacity**：
//     · `opacity:0` 仍会让元素**参与合成**（部分内核先给它铺一层白底再应用透明度）+ 带 transition 时有
//       半透明**中间态**（就是用户看到的"闪一下"）；`visibility:hidden` **完全不绘制**该元素，最强。
//     · 且用**内联 style**（HTML 属性）而非 CSS 类——类要等样式表加载才生效，内联在 HTML 解析时即隐藏，
//       覆盖"样式表到达前"的窗口（FOUC 同源）。
//   ★就绪信号 = `createWireframeCore` 的 `onReady`（**首个真实 rAF 帧**回调——已进入浏览器帧时序、内容已交
//     合成器，比"同步 draw 后立刻显示"更可信）。★兜底 `setTimeout`：后台标签页 rAF 被节流时仍能显示。
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

const cv = ref<HTMLCanvasElement | null>(null)
const off = ref(false)
let handle: WireframeHandle | null = null

/** hex → 0..1 三元组（容错：非 hex 回退品牌紫） */
function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0.486, 0.361, 1]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

onMounted(() => {
  const el = cv.value
  if (!el) return
  // 就绪 ⇒ 由隐藏转可见（直接改内联 style，不经响应式延迟）。幂等。
  const reveal = (): void => {
    if (el.style.visibility !== 'visible') el.style.visibility = 'visible'
  }
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  handle = createWireframeCore(el, {
    color: hexToRgb01(props.color),
    alpha: props.alpha,
    speed: props.speed,
    scale: props.scale,
    still: reduce,
    onReady: reveal,
  })
  if (!handle) {
    // WebGL 不可用 → 隐藏 canvas（布局不受影响；装饰层缺失可接受）
    off.value = true
    el.style.visibility = 'visible' // off 走 display:none，无需再藏
    return
  }
  // ★兜底：后台标签页 rAF 被节流 ⇒ 若迟迟不触发 onReady，超时后也显示（避免装饰永久缺失）。
  setTimeout(reveal, 700)
})

onUnmounted(() => {
  handle?.destroy()
  handle = null
})
</script>

<style scoped>
.wf-canvas {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.wf-canvas.is-off { display: none; }
</style>

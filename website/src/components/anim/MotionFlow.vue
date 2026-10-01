<script setup lang="ts">
// website/src/components/anim/MotionFlow.vue —— ★★**编排容器**：一组子元素由引擎编排器驱动
//
// 【是什么】把"一组同类元素 + 每片做什么"交给引擎的编排编译器（`compileChoreography`）：
//   相位排名（index / diagonal / serpentine / radialOut）、错峰、逐片校验、线格式全在引擎包里。
//   页面**不写一行循环**——这正是炫技场上 800 片瓦片的同一条链路，只是规模变小。
//
// 【两种驱动源（与真机同一套心智）】
//   · `time`（缺省）：入场/强调——进视口播放一次；
//   · `pointer`：指针在容器内的横向位置 → 进度（对标真机的手势 seek）。
//
// 【动画通道】由 `make` 决定：位移 / 缩放 / 旋转 / 3D / 透明度 / 倾斜……凡声明面支持的都行。
import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { AnimDecl, StaggerOrder } from '@proteus-vue/animation'
import { compileChoreography } from '@proteus-vue/animation'
import { asElement, createRunner, motionAllowed, settle, durationOf, type Runner } from '../../motion/engine-motion'

const props = withDefaults(
  defineProps<{
    /** 相位序（引擎的 StaggerOrder） */
    order?: StaggerOrder
    /** 相邻名次错峰（ms） */
    staggerMs?: number
    /** 网格列数（diagonal / serpentine 的几何依据；缺省按子元素数量开方） */
    cols?: number
    /** 容器形态：grid（p-grid 自适应网格）/ stack（p-stack 纵向堆叠） */
    layout?: 'grid' | 'stack'
    /** 透传给 p-grid：每列最小宽度（布局兜底——元素数量少时自动单/双列） */
    minColWidth?: number
    /** 透传给 p-grid：间距 */
    gap?: number
    /** 驱动源：time（入场一次）/ pointer（指针位置 → 进度） */
    drive?: 'time' | 'pointer'
    /** 循环（环境动效） */
    loop?: boolean
    /** 视口内才启动 */
    whenVisible?: boolean
    /** 每片做什么（返回声明；**不要写 delay**——引擎按相位叠加） */
    make: (ctx: { i: number; n: number; row: number; col: number; nth: number }) => readonly AnimDecl[]
  }>(),
  { order: 'index', staggerMs: 70, cols: 0, layout: 'grid', minColWidth: 300, gap: 22, drive: 'time', loop: false, whenVisible: true },
)

const rootEl = ref<HTMLElement>()
let runner: Runner | null = null
let io: IntersectionObserver | null = null
let pointerRaf = 0
let targetP = 0.5
let curP = 0.5

function build(): { anims: ReturnType<typeof compileChoreography>; els: HTMLElement[] } {
  const root = asElement(rootEl.value) as HTMLElement | null
  if (!root) return { anims: [], els: [] }
  // ★参与动画的是**布局容器**（p-grid/p-stack 渲染出的 div）的直接子级——跳过中间层
  const box = (root.firstElementChild as HTMLElement | null) ?? root
  const els = Array.from(box.children).filter((c): c is HTMLElement => c instanceof HTMLElement)
  if (!els.length) return { anims: [], els: [] }
  const c = props.cols || Math.max(1, Math.ceil(Math.sqrt(els.length)))
  const anims = compileChoreography({
    ids: els.map((_, i) => i + 1),
    canvas: { cols: c, view: { width: root.clientWidth || 900, height: root.clientHeight || 400 } },
    order: props.order,
    staggerMs: props.staggerMs,
    make: (ctx) => [...props.make(ctx)],
  })
  return { anims, els }
}

function runOnce(): void {
  const { anims, els } = build()
  if (!anims.length) return
  const slots = new Map<number, HTMLElement>()
  els.forEach((el, i) => slots.set(i + 1, el))
  runner?.stop()
  if (!motionAllowed()) {
    settle(anims, slots)
    return
  }
  runner = createRunner(anims, slots, { durationMs: durationOf(anims, 1000), loop: props.loop })
  runner.play()
}

function runPointer(): void {
  const { anims, els } = build()
  if (!anims.length) return
  const slots = new Map<number, HTMLElement>()
  els.forEach((el, i) => slots.set(i + 1, el))
  runner?.stop()
  if (!motionAllowed()) {
    settle(anims, slots)
    return
  }
  // 指针驱动：进度 → 整批 seek（与真机 seek_scroll/seek 同一入口语义）
  runner = createRunner(anims, slots, { durationMs: 1000 })
  const host = asElement(rootEl.value) as HTMLElement | null
  if (!host) return
  const write = (): void => {
    runner?.seek(targetP)
    if (Math.abs(curP - targetP) > 1e-4) {
      curP += (targetP - curP) * 0.14
      pointerRaf = requestAnimationFrame(write)
    } else {
      pointerRaf = 0
    }
  }
  const track = (): void => {
    if (!pointerRaf) pointerRaf = requestAnimationFrame(write)
  }
  host.addEventListener('pointermove', (ev: PointerEvent) => {
    const r = host.getBoundingClientRect()
    targetP = r.width > 0 ? Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) : 0.5
    track()
  })
  host.addEventListener('pointerleave', () => {
    targetP = 0.5
    track()
  })
  runner.seek(curP)
  track()
}

onMounted(() => {
  const root = asElement(rootEl.value)
  if (!root) return
  if (props.drive === 'pointer') {
    runPointer()
    return
  }
  if (!props.whenVisible || typeof IntersectionObserver !== 'function') {
    runOnce()
    return
  }
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) runOnce()
        else runner?.stop()
      }
    },
    { threshold: 0.1, rootMargin: '0px 0px -6% 0px' },
  )
  io.observe(root)
})
watch(
  () => props.order + ':' + props.staggerMs,
  () => {
    if (props.drive === 'time') runOnce()
  },
)
onUnmounted(() => {
  io?.disconnect()
  if (pointerRaf) cancelAnimationFrame(pointerRaf)
  runner?.stop()
})
</script>

<template>
  <!-- ★根节点必须是**元素**（模板 ref 要拿到 DOM——组件 ref 拿到的是实例，见 asElement 注释）
       ⇒ 布局器放里面：p-grid / p-stack 作为**子**容器，本组件的子元素 = slot 内容的直接子级。
       ★但编排需要"子元素"= 参与动画的元素 ⇒ 布局容器即 root，用 `children` 遍历它的直接子级。 -->
  <div ref="rootEl" class="mflow" :data-layout="layout">
    <p-grid v-if="layout === 'grid'" :min-col-width="minColWidth" :gap="gap">
      <slot />
    </p-grid>
    <p-stack v-else direction="column" :gap="gap">
      <slot />
    </p-stack>
  </div>
</template>

<style scoped>
.mflow {
  display: block;
}
</style>

<script setup lang="ts">
// website/src/components/anim/PresetPreview.vue —— ★★预设缩略实时预览（真预设驱动）
//
// 【零伪造】每张卡里的运动不是手写 CSS 关键帧，而是：
//   ① 从**预设 SSOT**（`@proteus-vue/animation` 的 `presets.*`）取声明；
//   ② 走**真编译**（`compileAnimations` / `compileRoute`——与产品代码同一入口）；
//   ③ 用 `animValue`（与 Rust 内核 golden 对拍的 TS 镜像）逐帧求值。
//   ⇒ 卡片里动的就是该预设真的会产生的运动（时长/曲线/位移全部来自引擎）。
//
// 【★拿不到批次的预设如实降级】滚动联动（`scroll.*`）与共享元素（`element.sharedElement`）
//   需要外部驱动源（滚动位置 / 源几何）⇒ 缩略图**不播放**，显示 `needs-scroll` / `needs-geometry`
//   角标（本仓铁律：不能演的就不演，不假装）。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ANIM_KIND_ID, compileAnimations, presets } from '@proteus-vue/animation'
import type { CompiledBatch, EngineAnim } from '@proteus-vue/animation'
import { animValue } from '@proteus-vue/slot-runtime'

type PreviewKind = 'route.slideUp' | 'route.bottomSheet' | 'route.zoom' | 'route.slideDown' | 'element.press' | 'element.shake' | 'element.fadeIn' | 'list.shift' | 'needs-scroll' | 'needs-geometry'

const props = defineProps<{ kind: PreviewKind; running?: boolean }>()

const motionOk = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)

/** 从真预设编译出批次（route 类走 compileRoute，元素类走 compileAnimations） */
function buildBatch(kind: PreviewKind): { batch: CompiledBatch | null; durationMs: number } {
  const T = { nodeId: 1 }
  switch (kind) {
    case 'route.slideUp': {
      const r = compileRouteSafe(presets.route.slideUp({ distance: 190 }), { enter: 1, exit: 2 })
      return { batch: r?.enter ?? null, durationMs: r?.durationMs ?? 300 }
    }
    case 'route.bottomSheet': {
      const r = compileRouteSafe(presets.route.bottomSheet({ distance: 150 }), { enter: 1, exit: 2 })
      return { batch: r?.enter ?? null, durationMs: r?.durationMs ?? 300 }
    }
    case 'route.zoom': {
      const r = compileRouteSafe(presets.route.zoom(), { enter: 1, exit: 2 })
      return { batch: r?.enter ?? null, durationMs: r?.durationMs ?? 300 }
    }
    case 'route.slideDown': {
      const r = compileRouteSafe(presets.route.slideDown({ distance: 190 }), { enter: 1, exit: 2 })
      return { batch: r?.exit ?? null, durationMs: r?.durationMs ?? 300 }
    }
    case 'element.press': {
      const s = presets.element.press()
      return { batch: compileAnimations(s.decls, T), durationMs: s.durationMs }
    }
    case 'element.shake': {
      const s = presets.element.shake({ amplitude: 14 })
      return { batch: compileAnimations(s.decls, T), durationMs: s.durationMs }
    }
    case 'element.fadeIn': {
      const s = presets.element.fadeIn({ risePx: 16 })
      return { batch: compileAnimations(s.decls, T), durationMs: s.durationMs }
    }
    case 'list.shift': {
      // 列表让位：把 list.shift 的时长/曲线包成一条真实位移（就是 FLIP 补间的形态）
      const s = presets.list.shift({ durationMs: 340 })
      const decls = [{ kind: 'translateY' as const, from: 26, to: 0, curve: s.curve, durationMs: s.durationMs }]
      return { batch: compileAnimations(decls, T), durationMs: s.durationMs }
    }
    default:
      return { batch: null, durationMs: 0 } // 需要外部驱动源 ⇒ 不播放（如实降级）
  }
}

function compileRouteSafe(spec: ReturnType<typeof presets.route.slideUp>, targets: { enter: number; exit?: number }) {
  try {
    return compileRouteLocal(spec, targets)
  } catch {
    return null
  }
}

// ★与 `compileRoute` 同一实现（直接 import 会与 presets 一起形成循环引用风险？——不，正常导入即可）
import { compileRoute as compileRouteLocal } from '@proteus-vue/animation'

const built = computed(() => buildBatch(props.kind))

interface S {
  transform: string
  opacity: number
}
function styleAt(tMs: number): S {
  const b = built.value.batch
  if (!b) return { transform: 'none', opacity: 1 }
  let tx = 0
  let ty = 0
  let sc = 1
  let rot = 0
  let op = 1
  for (const a of b.anims as readonly EngineAnim[]) {
    const dur = (a.durMs ?? 0) > 0 ? (a.durMs as number) : 1
    const u = Math.min(1, Math.max(0, (tMs - (a.delayMs ?? 0)) / dur))
    const v = animValue(a.curve, a.from, a.to, u)
    if (a.kind === ANIM_KIND_ID.translateX) tx = v
    else if (a.kind === ANIM_KIND_ID.translateY) ty = v
    else if (a.kind === ANIM_KIND_ID.scale) sc = v
    else if (a.kind === ANIM_KIND_ID.rotate) rot = v
    else if (a.kind === ANIM_KIND_ID.opacity) op = v
  }
  return { transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${sc.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`, opacity: op }
}

const t = ref(0)
const playing = ref(false)
let raf = 0
let timer: ReturnType<typeof setTimeout> | 0 = 0

function stop(): void {
  if (raf) cancelAnimationFrame(raf)
  if (timer) clearTimeout(timer)
  raf = 0
  timer = 0
  playing.value = false
}
function play(): void {
  stop()
  const b = built.value.batch
  if (!b || b.anims.length === 0) return
  if (!motionOk) {
    t.value = built.value.durationMs // reduced-motion：直接终态
    return
  }
  playing.value = true
  const dur = built.value.durationMs
  const start = performance.now()
  const step = (now: number): void => {
    const el = now - start
    t.value = Math.min(el, dur)
    if (el < dur) raf = requestAnimationFrame(step)
    else {
      playing.value = false
      raf = 0
      timer = setTimeout(() => {
        if (props.running !== false) play()
      }, 1200)
    }
  }
  raf = requestAnimationFrame(step)
}

/** 播放期首帧停在动画中段（静止态也好看：缩略图显示"正在运动"的形态） */
const midStyle = computed(() => styleAt(built.value.durationMs * 0.45))
const liveStyle = computed(() => (playing.value ? styleAt(t.value) : midStyle.value))

onMounted(() => {
  if (props.running !== false) play()
})
onUnmounted(stop)
defineExpose({ play, stop })
</script>

<template>
  <p-view class="pp" :style="{ perspective: '600px' }">
    <p-view class="pp-frame" :style="liveStyle">
      <!-- 缩略内容（三态：路由=两页叠层；元素=单卡；列表=三行） -->
      <template v-if="kind.startsWith('route.')">
        <p-view class="pp-back" />
        <p-view class="pp-front">
          <span v-if="kind === 'route.slideDown'" class="pp-handle" />
          <span class="pp-title" /><span class="pp-line" /><span class="pp-line pp-line--s" />
        </p-view>
      </template>
      <template v-else-if="kind === 'list.shift'">
        <p-view class="pp-list">
          <span class="pp-row" /><span class="pp-row pp-row--new" /><span class="pp-row" />
        </p-view>
      </template>
      <template v-else>
        <p-view class="pp-card"><span class="pp-title" /><span class="pp-line" /><span class="pp-cta" /></p-view>
      </template>
    </p-view>
    <p-text v-if="kind === 'needs-scroll'" class="pp-badge">needs scroll</p-text>
    <p-text v-else-if="kind === 'needs-geometry'" class="pp-badge">needs source rect</p-text>
  </p-view>
</template>

<style scoped>
.pp {
  position: relative;
  height: 104px;
  border-radius: 10px;
  overflow: hidden;
  background: radial-gradient(120% 140% at 30% 0%, rgba(124, 92, 255, 0.14), transparent 60%), #101016;
  border: 1px solid var(--line-soft);
  display: block;
}
/* ★运动留白：动画是位移/缩放（最远 ~190px、缩放 0.92），帧必须留在框内
   ⇒ 内边距按"最大位移"给足（缩略图不播真实位移，位移按比例缩小过——见 buildBatch 的 distance 参数）。 */
.pp-frame {
  position: absolute;
  inset: 14px 20px;
  will-change: transform, opacity;
  transform-origin: center center;
}
.pp-back,
.pp-front,
.pp-card,
.pp-list {
  position: absolute;
  inset: 0;
  border-radius: 8px;
}
.pp-back {
  background: linear-gradient(150deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.pp-front,
.pp-card {
  background: linear-gradient(160deg, rgba(124, 92, 255, 0.28), rgba(124, 92, 255, 0.08));
  border: 1px solid rgba(124, 92, 255, 0.4);
  padding: 9px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pp-handle {
  width: 28px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.4);
  margin: 0 auto 3px;
}
.pp-title {
  display: block;
  height: 7px;
  width: 58%;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.55);
}
.pp-line {
  display: block;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.18);
}
.pp-line--s { width: 62%; }
.pp-cta {
  display: block;
  margin-top: auto;
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(120deg, var(--brand), #6a4bf0);
  opacity: 0.85;
}
.pp-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  justify-content: center;
}
.pp-row {
  display: block;
  height: 18px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.pp-row--new {
  background: rgba(124, 92, 255, 0.28);
  border-color: rgba(124, 92, 255, 0.45);
}
.pp-badge {
  position: absolute;
  right: 8px;
  bottom: 6px;
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--dim);
  background: rgba(11, 11, 15, 0.7);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 1px 7px;
}
</style>

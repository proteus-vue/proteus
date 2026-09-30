<script setup lang="ts">
// website/src/components/anim/MobileStage.vue —— ★★Morpheus 手机舞台（真引擎指令驱动）
//
// 【与产品页的关系（这一块是招牌视觉）】产品页的"转场播放器"就是它：
//   两页真实卡片叠放，由**引擎给出的指令**驱动——不是 CSS 手写动画、不是示意图。
//
// 【★零伪造（本仓铁律在展示层的延伸）】
//   · 场景内容：**迷你原型**（首页＝标题+大图+两行列表；详情页＝大图+正文行+注释）——真实信息层级，
//     不是占位灰块；
//   · 运动：**真指令求值**——调用方把 `CompiledBatch`（`compileRoute` 产物）传进来，
//     本组件用 `animValue`（与 Rust 内核 golden 对拍过的 TS 镜像）逐帧求值；
//   · 遮罩/状态条/导航栏等**不参与动画**的 chrome 由 CSS 负责（它们本来就不该动）。
//
// 【为什么把求值放在组件里而不是产品页】产品页还要展示"跨属性共享时间轴"与"序列编排"两个演示，
//   三者共用同一套"指令 → 逐帧值 → style"的换算 ⇒ 收敛到组件内部（一处实现，避免三份副本）。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ANIM_KIND_ID } from '@proteus-vue/animation'
import type { EngineAnim } from '@proteus-vue/animation'
import { animValue } from '@proteus-vue/slot-runtime'

const props = withDefaults(
  defineProps<{
    /** 进场页要播的指令（`compileRoute(...).enter.anims` 或任意 `compileAnimations` 产物） */
    incoming: readonly EngineAnim[]
    /** 出场页要播的指令 */
    outgoing?: readonly EngineAnim[]
    /** 名义总时长（ms；缺省取两组指令的最大 durMs） */
    durationMs?: number
    /** 前进：新页在上层；返回：旧页在上层（滑出后露出新页） */
    direction?: 'forward' | 'back'
    /** 静止预览形态（不播放时的目标态；`true` 时直接落到终值） */
    idle?: boolean
    /** 自动重播（演示区默认开；hero 里可关掉减少打扰） */
    autoplay?: boolean
    /** 尺寸档（hero 大 / 演示中 / 缩略小） */
    size?: 'lg' | 'md' | 'sm'
    /** 顶部标签（可选——多层演示用） */
    caption?: string
  }>(),
  { outgoing: () => [], direction: 'forward', idle: false, autoplay: true, size: 'md', caption: '' },
)

const motionOk = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)

/** 名义时长：显式给定 or 两组指令的最大 durMs（与引擎的 `durationMs` 语义一致） */
const totalMs = computed(() => {
  if (props.durationMs && props.durationMs > 0) return props.durationMs
  const all = [...props.incoming, ...props.outgoing]
  return all.length ? Math.max(...all.map((a) => (a.durMs ?? 0) + (a.delayMs ?? 0))) : 0
})

interface PaneStyle {
  transform: string
  opacity: number
}
/** ★指令 → 逐帧值（唯一换算点：五个属性按 kind 编号分发，编号来自跨语言契约常量） */
function paneStyle(anims: readonly EngineAnim[], tMs: number): PaneStyle {
  let tx = 0
  let ty = 0
  let sc = 1
  let rot = 0
  let op = 1
  for (const a of anims) {
    const dur = (a.durMs ?? 0) > 0 ? (a.durMs as number) : 1
    const u = Math.min(1, Math.max(0, (tMs - (a.delayMs ?? 0)) / dur))
    const v = animValue(a.curve, a.from, a.to, u)
    if (a.kind === ANIM_KIND_ID.translateX) tx = v
    else if (a.kind === ANIM_KIND_ID.translateY) ty = v
    else if (a.kind === ANIM_KIND_ID.scale) sc = v
    else if (a.kind === ANIM_KIND_ID.rotate) rot = v
    else if (a.kind === ANIM_KIND_ID.opacity) op = v
  }
  return {
    transform: `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${sc.toFixed(4)}) rotate(${rot.toFixed(2)}deg)`,
    opacity: op,
  }
}

const tMs = ref(0)
const playing = ref(false)
let raf = 0
const reduced = !motionOk

function stop(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  playing.value = false
}
function play(): void {
  stop()
  const has = props.incoming.length + props.outgoing.length > 0
  if (!has) return
  if (reduced || props.idle) {
    tMs.value = totalMs.value // reduced-motion / 静止预览：直接终态（不做补间）
    return
  }
  playing.value = true
  const start = performance.now()
  const step = (now: number): void => {
    const t = now - start
    tMs.value = Math.min(t, totalMs.value)
    if (t < totalMs.value) raf = requestAnimationFrame(step)
    else {
      playing.value = false
      raf = 0
      // 自动重播（停留 1.4s 后从头——演示区的"循环展示"观感）
      if (props.autoplay) {
        setTimeout(() => {
          if (props.autoplay && !reduced) play()
        }, 1400)
      }
    }
  }
  raf = requestAnimationFrame(step)
}
watch(() => [props.incoming, props.outgoing, props.direction], () => play())
onMounted(play)
onUnmounted(stop)
defineExpose({ play, stop, playing })
</script>

<template>
  <p-view class="stage-wrap" :class="`stage--${size}`">
    <p-view v-if="caption" class="stage-caption">{{ caption }}</p-view>
    <p-view class="phone">
      <p-view class="phone-notch" />
      <p-view class="phone-screen">
        <!-- B 页（被推走的旧页：列表） -->
        <p-view class="pane pane--b" :style="{ ...paneStyle(outgoing, tMs), zIndex: direction === 'forward' ? 1 : 2 }">
          <p-view class="bar"><span class="bar-title">Morpheus</span><span class="bar-dot" /></p-view>
          <p-view class="hero-art" />
          <p-view class="list-row"><span class="row-line row-line--w1" /><span class="row-line row-line--w2" /></p-view>
          <p-view class="list-row"><span class="row-line row-line--w3" /><span class="row-line row-line--w2" /></p-view>
          <p-view class="list-row list-row--last"><span class="row-line row-line--w2" /></p-view>
        </p-view>
        <!-- A 页（进场的详情页） -->
        <p-view class="pane pane--a" :style="{ ...paneStyle(incoming, tMs), zIndex: direction === 'forward' ? 2 : 1 }">
          <p-view class="bar bar--brand"><span class="bar-back">‹</span><span class="bar-title">Detail</span><span class="bar-dot bar-dot--brand" /></p-view>
          <p-view class="detail-art"><span class="art-chip">Morpheus</span></p-view>
          <p-view class="text-line text-line--title" />
          <p-view class="text-line" /><p-view class="text-line text-line--short" />
          <p-view class="cta-row"><span class="cta-pill" /></p-view>
        </p-view>
      </p-view>
      <p-view class="phone-home" />
    </p-view>
  </p-view>
</template>

<style scoped>
.stage-wrap {
  position: relative;
  display: block;
}
.stage-caption {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--dim);
  margin-bottom: 8px;
  display: block;
}
/* ── 机身 ── */
.phone {
  position: relative;
  margin: 0 auto;
  background: linear-gradient(160deg, #1c1c24, #101016);
  border: 1px solid var(--line);
  border-radius: 34px;
  padding: 8px;
  box-shadow: 0 24px 60px -24px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.02) inset;
}
/* ★宽度用**固定 px**（不参与父容器的伸缩计算）：网格项在窄容器里会先把自己压扁，
   `min(280px, 100%)` 会跟着塌陷（实测：演示区机身被压成一条竖线）。
   `flex: none` + 固定宽度 ⇒ 机身尺寸恒定，容器窄时由外层滚动/换行处理。 */
.stage--lg .phone { width: 288px; flex: none; }
.stage--md .phone { width: 252px; flex: none; }
.stage--sm .phone { width: 200px; flex: none; border-radius: 26px; padding: 6px; }
.stage-wrap { display: flex; flex-direction: column; align-items: center; }
.phone-notch {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  width: 74px;
  height: 18px;
  background: #05050a;
  border-radius: 0 0 12px 12px;
  z-index: 30;
}
.stage--sm .phone-notch { width: 56px; height: 13px; top: 10px; }
.phone-screen {
  position: relative;
  height: 420px;
  border-radius: 27px;
  overflow: hidden;
  background: #0c0c12;
}
.stage--md .phone-screen { height: 380px; }
.stage--sm .phone-screen { height: 300px; border-radius: 20px; }
.phone-home {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  width: 84px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.32);
  z-index: 30;
}
.stage--sm .phone-home { width: 60px; height: 3px; bottom: 5px; }
/* ── 两页 ── */
.pane {
  position: absolute;
  inset: 0;
  will-change: transform, opacity;
  transform-origin: center center;
  backface-visibility: hidden;
}
.pane--b { background: linear-gradient(180deg, #14141b 0%, #0e0e14 100%); }
.pane--a { background: linear-gradient(180deg, #191634 0%, #0d0c18 100%); }
/* 顶栏 */
.bar {
  height: 42px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  margin-top: 20px;
  position: relative;
}
.stage--sm .bar { height: 34px; margin-top: 16px; padding: 0 10px; }
.bar--brand { border-bottom: 1px solid rgba(124, 92, 255, 0.28); }
.bar-title { font-size: 12.5px; font-weight: 650; color: var(--ink); letter-spacing: 0.01em; }
.stage--sm .bar-title { font-size: 10.5px; }
.bar-back { font-size: 17px; color: var(--brand-ink); line-height: 1; }
.bar-dot {
  margin-left: auto;
  width: 22px;
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
}
.bar-dot--brand { background: var(--brand-soft); border: 1px solid var(--brand); }
/* 首页：主视觉 + 列表 */
.hero-art {
  height: 132px;
  margin: 12px 12px 14px;
  border-radius: 12px;
  background:
    radial-gradient(120% 120% at 20% 10%, rgba(124, 92, 255, 0.55), transparent 55%),
    radial-gradient(90% 90% at 85% 90%, rgba(255, 138, 92, 0.32), transparent 60%),
    linear-gradient(160deg, #23233a, #15151f);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.stage--sm .hero-art { height: 96px; margin: 9px 9px 10px; }
.list-row {
  margin: 0 12px 10px;
  height: 40px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.04);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  padding: 0 12px;
}
.stage--sm .list-row { height: 30px; margin: 0 9px 7px; padding: 0 9px; }
.list-row--last { opacity: 0.7; }
.row-line { display: block; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.13); }
.stage--sm .row-line { height: 4px; }
.row-line--w1 { width: 62%; background: rgba(255, 255, 255, 0.2); }
.row-line--w2 { width: 40%; }
.row-line--w3 { width: 72%; background: rgba(255, 255, 255, 0.18); }
/* 详情页：图像 + 文本行 + CTA */
.detail-art {
  height: 150px;
  margin: 12px 12px 14px;
  border-radius: 12px;
  background: linear-gradient(150deg, rgba(124, 92, 255, 0.62), rgba(124, 92, 255, 0.16) 62%, rgba(255, 138, 92, 0.2));
  border: 1px solid rgba(124, 92, 255, 0.35);
  display: flex;
  align-items: flex-end;
  padding: 12px;
}
.stage--sm .detail-art { height: 108px; margin: 9px 9px 10px; }
.art-chip {
  font-family: var(--mono);
  font-size: 10.5px;
  color: #efeaff;
  background: rgba(11, 11, 15, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  padding: 3px 9px;
  letter-spacing: 0.06em;
}
.text-line {
  height: 9px;
  margin: 0 12px 9px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
}
.text-line--title { height: 13px; width: 72%; background: rgba(255, 255, 255, 0.5); margin-bottom: 12px; }
.text-line--short { width: 52%; }
.cta-row { margin: 16px 12px 0; }
.cta-pill {
  display: block;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(120deg, var(--brand), #6a4bf0);
  box-shadow: 0 8px 22px -8px rgba(124, 92, 255, 0.85);
}
.stage--sm .cta-pill { height: 26px; }
</style>

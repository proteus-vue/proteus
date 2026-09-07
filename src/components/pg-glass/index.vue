<template>
  <div
    class="pg-glass"
    :class="['pg-glass--' + preset, 'pg-glass--' + intensity, { 'pg-glass--border': border, 'pg-glass--reduced': reducedTransparency }]"
    :style="glassStyle"
  >
    <!-- ★#389 定位上下文归内层：根元素不写 position（消费方自由 sticky/absolute），noise/highlight 相对 __in 定位 -->
    <div class="pg-glass__in">
      <span v-if="noise > 0 && !reducedTransparency" class="pg-glass__noise" aria-hidden="true" />
      <span v-if="border && !reducedTransparency" class="pg-glass__highlight" aria-hidden="true" />
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
// src/components/pg-glass/index.vue —— ★G-07 液态玻璃统一入口（B1 · Web/Skyline L1+L2 映射，规格：glass-plan/02+07+09）
// 单入口铁律：业务只写 <pg-glass>，禁止平台分支/裸 backdrop-filter 散落页面（GLS001-006 + CSS017）
// L1 必达：blur + tint + radius + border 全端一致；降级不崩溃：prefers-reduced-transparency / 无 backdrop-filter → 实色
// Web L2：噪点层（pg-glass__noise）+ 顶部高光边（pg-glass__highlight）——对齐 07-mapping-web-skyline.md
import { computed, onMounted, ref } from 'vue'

const props = defineProps({
  /** 预设（09-presets：navigationBar/tabBar/modal/card/floating/sidebar/custom） */
  preset: { type: String, default: 'custom' },
  /** 强度：thin / regular / thick */
  intensity: { type: String, default: 'regular' },
  /** 着色（覆盖预设 tint） */
  tint: { type: String, default: '' },
  /** 圆角 px（覆盖预设） */
  radius: { type: Number, default: 0 },
  /** 是否高光边（L2） */
  border: { type: Boolean, default: true },
  /** 噪点强度 0-1（L2；0 = 关闭） */
  noise: { type: Number, default: 0 },
})

const PRESET_BLUR: Record<string, number> = {
  navigationBar: 20,
  tabBar: 20,
  modal: 24,
  card: 16,
  floating: 28,
  sidebar: 20,
  custom: 20,
}
const INTENSITY_SCALE: Record<string, number> = { thin: 0.6, regular: 1, thick: 1.4 }
const PRESET_TINT: Record<string, string> = {
  navigationBar: 'rgba(255, 255, 255, 0.15)',
  tabBar: 'rgba(255, 255, 255, 0.15)',
  modal: 'rgba(255, 255, 255, 0.15)',
  card: 'rgba(255, 255, 255, 0.08)',
  floating: 'rgba(255, 255, 255, 0.18)',
  sidebar: 'rgba(255, 255, 255, 0.12)',
  custom: 'rgba(255, 255, 255, 0.12)',
}

// ★无障碍优先：prefers-reduced-transparency 自动关玻璃（降级实色——铁律 4）
// ★MP 安全：逻辑层无 matchMedia → 恒 false（不降级即玻璃）；探测走 globalThis 而非裸 window（components:audit no-platform-api）
const reducedTransparency = ref(false)
// ★MP 编译安全：函数体内不用 as 断言与箭头参数标注（编译器限制）——回调提为函数声明（p-sidebar 同款）
function onMediaChange(e: MediaQueryListEvent): void {
  reducedTransparency.value = e.matches
}
onMounted(() => {
  const g = globalThis
  const mm = g.matchMedia ? g.matchMedia('(prefers-reduced-transparency: reduce)') : undefined
  if (mm) {
    reducedTransparency.value = mm.matches
    mm.addEventListener?.('change', onMediaChange)
  }
})

const blurPx = computed(() => {
  const base = PRESET_BLUR[props.preset] ?? PRESET_BLUR.custom ?? 20
  return Math.round(base * (INTENSITY_SCALE[props.intensity] ?? 1))
})
const tint = computed(() => props.tint || PRESET_TINT[props.preset] || PRESET_TINT.custom || "")
const radiusPx = computed(() => (props.radius > 0 ? props.radius + 'px' : undefined))

const glassStyle = computed(() => ({
  backdropFilter: reducedTransparency.value ? undefined : `blur(${blurPx.value}px)`,
  WebkitBackdropFilter: reducedTransparency.value ? undefined : `blur(${blurPx.value}px)`,
  background: reducedTransparency.value ? '#121216' : tint.value,
  borderRadius: radiusPx.value,
  '--pg-noise-opacity': String(props.noise),
}))
</script>

<style scoped>
/* ★#389 根元素不设 position/display——定位与布局归消费方；定位上下文归 __in（noise/highlight 锚点） */
.pg-glass__in { position: relative; }
@supports not (backdrop-filter: blur(1px)) {
  .pg-glass { background: #121216; }
}
.pg-glass__noise {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: var(--pg-noise-opacity, 0);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
}
.pg-glass__highlight {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent);
}
.pg-glass--border { box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.12); }
</style>

<script setup lang="ts">
// website/src/components/FeatureIcon.vue —— 首页特色/场景卡图标（内联 SVG 线性图标集）
//   ★2026-09-11 风格收敛：参考「专业组件库官网」的方形图标卡——统一线性图标 + 品牌单色描边。
//   全部为几何 path（stroke=currentColor）——颜色随父级，无硬编码色值（D-2/C1 合规）。
import { computed } from 'vue'

const props = defineProps({
  /** 图标名（见 ICONS；未知 → box 兜底） */
  name: { type: String, default: 'box' },
})

const ICONS: Record<string, string[]> = {
  layers: ['M12 3 2 8l10 5 10-5-10-5Z', 'm2 13 10 5 10-5', 'm2 17.5 10 5 10-5'],
  plug: ['M9 2v6', 'M15 2v6', 'M6 8h12v3a6 6 0 0 1-12 0V8Z', 'M12 17v5'],
  shield: ['M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z', 'm9 12 2 2 4-5'],
  code: ['m9 8-5 4 5 4', 'm15 8 5 4-5 4', 'M13.5 5l-3 14'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  data: ['M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6'],
  app: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  layout: ['M3 4h18v16H3z', 'M9 4v16', 'M9 10h12'],
  phone: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z', 'M11 18h2'],
  box: ['M21 8 12 3 3 8v8l9 5 9-5V8Z', 'm3 8 9 5 9-5', 'M12 13v8'],
  bolt: ['M13 2 4 14h6l-1 8 9-12h-6l1-8Z'],
  target: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z'],
}

const paths = computed(() => ICONS[props.name] ?? ICONS.box)
</script>

<template>
  <svg
    class="fi"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, i) in paths" :key="i" :d="d" />
  </svg>
</template>

<style scoped>
.fi {
  display: block;
  width: 22px;
  height: 22px;
}
</style>

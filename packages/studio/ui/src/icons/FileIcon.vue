<script setup lang="ts">
// icons/FileIcon.vue —— 文件类型徽章（决策 #1235）
//
// 直接画**语言自己的记号**（Vue 的 V、Rust 的齿轮、TS 的蓝方块…），不再套统一容器。
// 原因见 `fileIcons.ts` 顶部：统一容器会抹平差异，正好把辨识度做没。
// 一个实例：Tree 里 .vue / .rs / .ts 并排时，形状+品牌色就能区分，不用读文字。
import { computed } from 'vue'
import { fileTypeIcon } from '../fileIcons'

const props = withDefaults(defineProps<{ path: string; size?: number }>(), { size: 14 })

const info = computed(() => fileTypeIcon(props.path))
const color = computed(() => info.value?.color ?? '#7c8798')
const glyph = computed(
  () =>
    info.value?.svg ??
    '<path d="M5 2.5h9l5 5v14H5z" fill="#7c8798"/><path d="M14 2.5v5h5" fill="#5b6577"/>',
)
const name = computed(() => info.value?.icon ?? 'file')
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :data-type-icon="name"
    :data-tint="color"
    role="img"
    :aria-label="path"
  >
    <g v-html="glyph" />
  </svg>
</template>

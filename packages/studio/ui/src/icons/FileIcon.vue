<script setup lang="ts">
// icons/FileIcon.vue —— 文件类型徽章（决策 #1235）
//
// 统一规格：圆角矩形徽章（类型色底）+ 白色单记号（1.6 描边）。
// 类型色/记号都来自 `fileIcons.ts`（唯一真源），未登记的扩展名退回通用文档徽章。
// ★为什么不用 currentColor：徽章是**类型色**而不是前景色，不能用"图标都跟随文本颜色"那套。
import { computed } from 'vue'
import { fileTypeIcon } from '../fileIcons'

const props = withDefaults(defineProps<{ path: string; size?: number }>(), { size: 14 })

const info = computed(() => fileTypeIcon(props.path))
const color = computed(() => info.value?.color ?? '#7c8798')
const glyph = computed(
  () =>
    info.value?.glyph ??
    '<path d="M7.5 3.5h5.5L16.5 7v13h-9z"/><path d="M13 3.5V7h3.5"/>',
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
    <rect x="2.5" y="2.5" width="19" height="19" rx="4.6" :fill="color" />
    <g
      stroke="#ffffff"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
      v-html="glyph"
    />
  </svg>
</template>

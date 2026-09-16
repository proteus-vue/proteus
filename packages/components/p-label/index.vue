<!-- src/components/p-label/index.vue —— 表单标签 / 控件关联（★能力颗粒度对齐 C2：ui.label · 对齐小程序 <label>）
     对齐小程序 <label>：for 关联控件 id → 点击标签聚焦/切换关联控件；内含控件时自动关联
     双端同源码：label → label（小程序 <label for> 原生支持）；纯语义无平台直调 -->
<template>
  <label class="p-label" :for="htmlFor" :style="labelStyle" @click="onClick">
    <slot />
  </label>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 关联控件的 id（对齐小程序 <label for> / HTML label for） */
  for: { type: String, default: '' },
  /** 是否整行块级 */
  block: { type: Boolean, default: false },
})

const emit = defineEmits(['click'])

const htmlFor = computed(() => (props.for ? props.for : undefined))

const labelStyle = computed<CSSProperties>(() => ({
  display: props.block ? 'block' : 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  cursor: 'pointer',
}))

function onClick(e: MouseEvent): void {
  emit('click', e)
}
</script>

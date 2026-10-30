<script setup lang="ts">
/**
 * Grips.vue —— 左右两条拖拽分隔条（决策 #1411：从 App.vue 抽出，压回 1000 行内）
 *
 * 【为什么挂在 `.app` 上而不是 `.rail` / `.side` 里】往那两个容器插节点会把
 *   `button:nth-child(N)` 的序号整体后移，门禁曾因此点到"设备"而不是"代码"（决策 #1343）。
 */
import { railHidden, railW, sideHidden, sideW, startDrag } from './layout'
</script>

<template>
<div
  class="grip grip-rail"
  :class="{ 'grip-off': railHidden }"
  :style="{ left: railW - 3 + 'px' }"
  title="拖动调整左栏宽度（⌘⇧B 收起/展开）"
  @pointerdown="startDrag('rail', $event)"
/>
<div
  class="grip grip-side"
  :class="{ 'grip-off': sideHidden }"
  :style="{ right: sideW - 3 + 'px' }"
  title="拖动调整右栏宽度（⌘B 收起/展开）"
  @pointerdown="startDrag('side', $event)"
/>
</template>

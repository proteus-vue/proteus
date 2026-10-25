<script setup lang="ts">
// icons/FolderIcon.vue —— 目录图标（两态、**填充**，决策 #1237）
//
// 为什么单独一个组件：StudioIcon 的规范是"1.5 线宽 + fill=none"，
// 而文件类型图标全是**填充**的（语言记号）。如果目录还画线框，一排看过去
// 目录比文件"轻"一档，整列的重量就散了。目录也用填充 + 两档同色，重量才和文件一致。
// 展开/闭合靠**形状**区分（前盖掀开），不靠颜色。
withDefaults(defineProps<{ open?: boolean; size?: number }>(), { open: false, size: 16 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" :data-open="open ? '1' : '0'" role="img" aria-label="folder">
    <template v-if="open">
      <!-- 展开：后板（暗）+ 前盖（亮，向外翻开） -->
      <path
        d="M2.6 7.6h16.7l-2.1 8.7a1.6 1.6 0 0 1-1.56 1.25H4.35a1.6 1.6 0 0 1-1.57-1.96z"
        fill="#8A97A8"
      />
      <path
        d="M2.6 7.6V6.2a1.5 1.5 0 0 1 1.5-1.5h3.66l1.7 2h8.14a1.5 1.5 0 0 1 1.5 1.5v1.4z"
        fill="#5F6B7A"
      />
    </template>
    <template v-else>
      <!-- 闭合：整块 + 顶盖更深一档 -->
      <path
        d="M2.6 6.2a1.5 1.5 0 0 1 1.5-1.5h3.66l1.7 2h9.44a1.5 1.5 0 0 1 1.5 1.5v9.6a1.5 1.5 0 0 1-1.5 1.5H4.1a1.5 1.5 0 0 1-1.5-1.5z"
        fill="#6E7B8C"
      />
      <path d="M2.6 8.6h18.8v1.5H2.6z" fill="#5F6B7A" opacity="0.55" />
    </template>
  </svg>
</template>

<script setup lang="ts">
// icons/StudioMark.vue —— **产品标记**（立方体 + 取景框），决策 #1228
//
// 【它和图标的关系】应用图标是「P 字标」（极简，16px 也认得出）；这个立方体 + 取景框是**产品标记**，
//   只在**尺寸够大**的地方用：应用内空状态、文档、官网首屏。理由很硬：取景框在 32px 会糊成四团脏点
//   （实测见 `icons/options/size-check.png`）。
//
// 【为什么内联 SVG 而不是引 icons/studio-mark.svg】Tauri 的 web-dist 是独立构建产物，
//   跨目录引 docs/ 下的资源会把打包路径绑死；而这三色渐变本来就要跟着组件走（和官网 BrandMark 同源）。
//   ★渐变 id 加前缀 `sm-`：同一页里若同时出现官网 BrandMark（bm*）与图标（st*），id 不会撞。
withDefaults(defineProps<{ size?: number }>(), { size: 56 })
</script>

<template>
  <!-- 裁边 viewBox：只框住"取景框 + 立方体"本体（196,160 → 632×700），避免四周大片空白 -->
  <svg
    :width="size"
    :height="size * 1.108"
    viewBox="196 160 632 700"
    fill="none"
    role="img"
    aria-label="Proteus Studio"
  >
    <defs>
      <linearGradient id="sm-top" x1="0.5" y1="0" x2="0.5" y2="1">
        <stop offset="0" stop-color="#d3c6ff" />
        <stop offset="1" stop-color="#8b5cf6" />
      </linearGradient>
      <linearGradient id="sm-left" x1="0.25" y1="0" x2="0.5" y2="1">
        <stop offset="0" stop-color="#4ade80" />
        <stop offset="1" stop-color="#16a34a" />
      </linearGradient>
      <linearGradient id="sm-right" x1="0.75" y1="0" x2="0.5" y2="1">
        <stop offset="0" stop-color="#60a5fa" />
        <stop offset="1" stop-color="#2563eb" />
      </linearGradient>
      <clipPath id="sm-cube">
        <polygon points="512,212 771.8,362 771.8,662 512,812 252.2,662 252.2,362" />
      </clipPath>
    </defs>

    <!-- 取景框：四角 L。语义是"被框住 = 被检视/取证" —— Studio 与引擎的分工就在这一层 -->
    <g stroke="currentColor" stroke-opacity="0.72" stroke-width="21" stroke-linecap="round" stroke-linejoin="round">
      <path d="M226 282 V216 a26 26 0 0 1 26 -26 H318" />
      <path d="M706 190 H772 a26 26 0 0 1 26 26 V282" />
      <path d="M226 742 V808 a26 26 0 0 0 26 26 H318" />
      <path d="M706 834 H772 a26 26 0 0 0 26 -26 V742" />
    </g>

    <!-- 立方体：与 docs/brand/avatar.svg 同一套等距角度、三面三色、白内缝、不描外轮廓 -->
    <polygon points="512,212 771.8,362 512,512 252.2,362" fill="url(#sm-top)" />
    <polygon points="252.2,362 512,512 512,812 252.2,662" fill="url(#sm-left)" />
    <polygon points="512,512 771.8,362 771.8,662 512,812" fill="url(#sm-right)" />
    <g clip-path="url(#sm-cube)" stroke="#ffffff" stroke-width="15" stroke-linecap="round" stroke-opacity="0.94">
      <line x1="252.2" y1="362" x2="512" y2="512" />
      <line x1="771.8" y1="362" x2="512" y2="512" />
      <line x1="512" y1="512" x2="512" y2="812" />
    </g>
  </svg>
</template>

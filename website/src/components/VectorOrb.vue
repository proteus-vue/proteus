<template>
  <view class="vo">
    <!-- ★标准 SVG 矢量艺术（官网 Web 端**原生渲染**）——展示框架 SVG 管线能力：
         径向渐变光晕 / 高斯模糊辉光 / 描边进度（stroke-dashoffset）/ 轨道粒子（animateMotion）/
         裁剪能量波（clipPath）/ 脉冲（r）——全部为「标准 SVG 源码编译产物」的运行时呈现。 -->
    <svg viewBox="0 0 240 240" class="vo-svg" aria-hidden="true">
      <defs>
        <radialGradient id="voCore">
          <stop offset="0%" stop-color="#c7bcff" stop-opacity="1" />
          <stop offset="34%" stop-color="#7c5cff" stop-opacity="0.85" />
          <stop offset="66%" stop-color="#5b46d6" stop-opacity="0.4" />
          <stop offset="100%" stop-color="#7c5cff" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="voRing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#a996ff" />
          <stop offset="55%" stop-color="#7c5cff" />
          <stop offset="100%" stop-color="#00e0c6" />
        </linearGradient>
        <filter id="voGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="voClip">
          <circle cx="120" cy="120" r="74" />
        </clipPath>
      </defs>

      <!-- 外层旋转虚线环（CSS rotate） -->
      <g class="vo-spin">
        <circle cx="120" cy="120" r="104" fill="none" stroke="#38bdf8" stroke-width="1" stroke-dasharray="3 12" opacity="0.5" />
      </g>
      <g class="vo-spin-rev">
        <circle cx="120" cy="120" r="92" fill="none" stroke="#a996ff" stroke-width="1" stroke-dasharray="2 16" opacity="0.45" />
      </g>

      <!-- 核心光晕（径向渐变 + 辉光） -->
      <circle cx="120" cy="120" r="74" fill="url(#voCore)" />

      <!-- 裁剪能量波（clipPath + 旋转） -->
      <g clip-path="url(#voClip)">
        <g class="vo-sweep">
          <rect x="120" y="40" width="120" height="160" fill="#7c5cff" opacity="0.22" />
        </g>
      </g>

      <!-- 描边进度环（stroke-dashoffset 动画） -->
      <circle cx="120" cy="120" r="90" fill="none" stroke="url(#voRing)" stroke-width="4" stroke-linecap="round"
        stroke-dasharray="565" stroke-dashoffset="565" transform="rotate(-90 120 120)">
        <animate attributeName="stroke-dashoffset" values="565;120;565" dur="5s" repeatCount="indefinite" />
      </circle>

      <!-- 脉冲核心（r 动画 + 辉光） -->
      <circle cx="120" cy="120" r="20" fill="#ffffff" filter="url(#voGlow)">
        <animate attributeName="r" values="20;27;20" dur="1.8s" repeatCount="indefinite" />
      </circle>

      <!-- 轨道粒子（animateMotion 路径运动） -->
      <circle r="4.5" fill="#fde047" filter="url(#voGlow)">
        <animateMotion dur="4s" repeatCount="indefinite" path="M120 30 A90 90 0 1 1 119.9 30" />
      </circle>
      <circle r="3" fill="#00e0c6" filter="url(#voGlow)">
        <animateMotion dur="6.5s" repeatCount="indefinite" path="M120 52 A68 68 0 1 0 119.9 52" />
      </circle>

      <!-- 中心节点（品牌标识置于核心） -->
      <circle cx="120" cy="120" r="7" fill="#0b0b0f" opacity="0.55" />
    </svg>
  </view>
</template>

<script setup lang="ts">
// website/src/components/VectorOrb.vue —— 纯 SVG 矢量展示（无脚本逻辑；动画为 SMIL + CSS）
</script>

<style scoped>
.vo { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.vo-svg { width: 100%; height: 100%; display: block; }
.vo-spin { transform-origin: 120px 120px; animation: vo-spin 22s linear infinite; }
.vo-spin-rev { transform-origin: 120px 120px; animation: vo-spin 15s linear infinite reverse; }
@keyframes vo-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.vo-sweep { transform-origin: 120px 120px; animation: vo-spin 9s linear infinite; }
/* reduced-motion 由页面级 .no-motion 祖先类控制（本项目禁媒体查询——FLD001/D-2 no-media-query） */
.no-motion .vo-spin,
.no-motion .vo-spin-rev,
.no-motion .vo-sweep { animation: none; }
</style>

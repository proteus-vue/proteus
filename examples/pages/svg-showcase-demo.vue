<!-- examples/pages/svg-showcase-demo.vue —— ★G-62 SVG 能力综合演示（2026-09-09）
     用已对齐的 SVG 能力做一个炫丽效果：发光能量核心 + 进度环 + 轨道粒子 + 脉冲 + 交互。
     能力清单（全部真机验证）：
       · 渐变（radialGradient 光晕 / linearGradient 描边）
       · 滤镜（feGaussianBlur 辉光）
       · 裁剪（clipPath 圆形裁剪）
       · 描边动画（stroke-dashoffset 进度环 —— Canvas 通道）
       · 路径运动（animateMotion 轨道粒子 —— Canvas 通道）
       · 形状变化（r 脉冲 —— Canvas 通道）
       · 整体变换（rotate 旋转 —— CSS 通道）
       · 事件命中（点击核心触发反馈） -->
<template>
  <view class="page">
    <text class="title">SVG 能量核心</text>
    <text class="sub">渐变 · 滤镜辉光 · 进度环 · 轨道粒子 · 脉冲 · 交互</text>

    <!-- ① 主视觉：发光核心（静态光效 + CSS 旋转 + 事件） -->
    <view class="stage">
      <!-- ★点击热区：透明 view 覆盖（Skyline 下 image/组件内触摸不可靠，原生 view 最稳） -->
      <view class="hit-area" @tap="onCoreTap"></view>
      <svg viewBox="0 0 200 200" width="240" height="240" @tick="onTick">
        <defs>
          <!-- 辉光滤镜 -->
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <!-- 径向渐变（核心光晕） -->
          <radialGradient id="coreGlow">
            <stop offset="0%" stop-color="#e0f2fe" stop-opacity="1" />
            <stop offset="30%" stop-color="#22d3ee" stop-opacity="0.85" />
            <stop offset="62%" stop-color="#0ea5e9" stop-opacity="0.45" />
            <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0" />
          </radialGradient>
          <!-- 线性渐变（外环描边） -->
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#22d3ee" />
            <stop offset="50%" stop-color="#a78bfa" />
            <stop offset="100%" stop-color="#f472b6" />
          </linearGradient>
          <!-- 圆形裁剪（能量波） -->
          <clipPath id="waveClip">
            <circle cx="100" cy="100" r="62" />
          </clipPath>
        </defs>

        <!-- 外层旋转虚线环（CSS rotate） -->
        <g class="spin-slow">
          <circle cx="100" cy="100" r="88" fill="none" stroke="#38bdf8" stroke-width="1" stroke-dasharray="4 10" opacity="0.7" />
        </g>
        <!-- 反向旋转细环 -->
        <g class="spin-rev">
          <circle cx="100" cy="100" r="76" fill="none" stroke="#a78bfa" stroke-width="1" stroke-dasharray="2 14" opacity="0.6" />
        </g>

        <!-- 核心光晕（径向渐变——最外圈透明收边，避免黑底） -->
        <circle cx="100" cy="100" r="62" fill="url(#coreGlow)" />

        <!-- 能量波（裁剪 + 脉冲） -->
        <g clip-path="url(#waveClip)">
          <circle cx="100" cy="100" r="30" fill="#22d3ee" opacity="0.35" />
        </g>

        <!-- 进度环（Canvas 通道：stroke-dashoffset 动画）—— 半径大于光晕，不被遮挡 -->
        <circle
          cx="100"
          cy="100"
          r="78"
          fill="none"
          stroke="#22d3ee"
          stroke-width="5"
          stroke-linecap="round"
          stroke-dasharray="490"
          stroke-dashoffset="294"
          transform="rotate(-90 100 100)"
        >
          <animate attributeName="stroke-dashoffset" values="294;0;294" dur="4s" repeatCount="indefinite" />
        </circle>

        <!-- 脉冲核心（Canvas 通道：r 变化） -->
        <circle cx="100" cy="100" r="16" fill="#ffffff" filter="url(#glow)">
          <animate attributeName="r" values="16;24;16" dur="1.6s" repeatCount="indefinite" />
        </circle>

        <!-- 轨道粒子（Canvas 通道：animateMotion 路径运动） -->
        <circle r="4" fill="#fde047" filter="url(#glow)">
          <animateMotion dur="3s" repeatCount="indefinite" path="M100 26 A74 74 0 1 1 99.9 26" />
        </circle>
        <circle r="3" fill="#f472b6" filter="url(#glow)">
          <animateMotion dur="4.5s" repeatCount="indefinite" path="M100 40 A60 60 0 1 0 99.9 40" />
        </circle>
      </svg>
    </view>

    <!-- 交互反馈 -->
    <text class="status">{{ status }}</text>
    <text class="status">帧数 {{ frames }}</text>
    <!-- ★真机诊断（区分「写入失败」/「渲染失败」——排障后移除） -->
    <text class="diag">回传 {{ emits }} · 失败 {{ fails }}</text>
    <text class="diag">{{ img }}</text>
    <text class="diag">{{ srcTail }}</text>
    <text class="diag">{{ err }}</text>

    <!-- ② 能力卡片：每个用一项 SVG 能力 -->
    <view class="cards">
      <view class="card">
        <svg viewBox="0 0 100 100" width="88" height="88">
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#f87171" />
              <stop offset="100%" stop-color="#fbbf24" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="38" fill="url(#g1)" />
          <text x="50" y="57" font-size="16" fill="#fff" text-anchor="middle">渐变</text>
        </svg>
        <text class="card-label">linearGradient</text>
      </view>

      <view class="card">
        <svg viewBox="0 0 100 100" width="88" height="88">
          <defs>
            <filter id="g2">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          <circle cx="50" cy="50" r="24" fill="#34d399" filter="url(#g2)" />
          <circle cx="50" cy="50" r="24" fill="none" stroke="#34d399" stroke-width="2" />
        </svg>
        <text class="card-label">滤镜辉光</text>
      </view>

      <view class="card">
        <svg viewBox="0 0 100 100" width="88" height="88">
          <defs>
            <clipPath id="g3">
              <circle cx="50" cy="50" r="34" />
            </clipPath>
          </defs>
          <g clip-path="url(#g3)">
            <rect x="0" y="0" width="100" height="50" fill="#60a5fa" />
            <rect x="0" y="50" width="100" height="50" fill="#1e40af" />
          </g>
        </svg>
        <text class="card-label">clipPath</text>
      </view>

      <view class="card">
        <svg viewBox="0 0 100 100" width="88" height="88">
          <circle cx="50" cy="50" r="34" fill="none" stroke="#e5e7eb" stroke-width="6" />
          <circle cx="50" cy="50" r="34" fill="none" stroke="#8b5cf6" stroke-width="6" stroke-linecap="round" stroke-dasharray="214" stroke-dashoffset="214" transform="rotate(-90 50 50)">
            <animate attributeName="stroke-dashoffset" values="214;60;214" dur="2.5s" repeatCount="indefinite" />
          </circle>
        </svg>
        <text class="card-label">描边进度</text>
      </view>

      <view class="card">
        <svg viewBox="0 0 100 100" width="88" height="88">
          <circle cx="50" cy="50" r="10" fill="#fb7185">
            <animate attributeName="r" values="10;28;10" dur="1.8s" repeatCount="indefinite" />
          </circle>
        </svg>
        <text class="card-label">脉冲</text>
      </view>

      <view class="card">
        <svg viewBox="0 0 100 100" width="88" height="88">
          <circle r="6" fill="#facc15">
            <animateMotion dur="2.4s" repeatCount="indefinite" path="M14 50 Q50 10 86 50 Q50 90 14 50" />
          </circle>
        </svg>
        <text class="card-label">路径运动</text>
      </view>

      <view class="card">
        <svg viewBox="0 0 100 100" width="88" height="88">
          <g class="spin-fast">
            <rect x="42" y="16" width="16" height="16" rx="3" fill="#2dd4bf" />
            <rect x="42" y="68" width="16" height="16" rx="3" fill="#2dd4bf" />
            <rect x="16" y="42" width="16" height="16" rx="3" fill="#2dd4bf" />
            <rect x="68" y="42" width="16" height="16" rx="3" fill="#2dd4bf" />
          </g>
        </svg>
        <text class="card-label">CSS 旋转</text>
      </view>

      <view class="card">
        <svg viewBox="0 0 100 100" width="88" height="88">
          <path d="M50 14 L86 50 L50 86 L14 50 Z" fill="#f472b6" />
          <path d="M50 30 L70 50 L50 70 L30 50 Z" fill="#fff" opacity="0.85" />
        </svg>
        <text class="card-label">path</text>
      </view>
    </view>

    <text class="hint">点击核心有反馈 · 8 项能力同时运行</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const status = ref('点击核心试试')
const frames = ref(0)
const taps = ref(0)
/** ★真机诊断字段（tick 事件回传——排障后移除） */
const emits = ref(0)
const fails = ref(0)
const img = ref('img -')
const srcTail = ref('src -')
const err = ref('err -')

function onTick(e: unknown): void {
  const ev = e as { detail?: { frames?: number; emits?: number; fails?: number; img?: string; src?: string; err?: string } }
  const d = ev && ev.detail
  if (!d) return
  frames.value = d.frames || 0
  emits.value = d.emits || 0
  fails.value = d.fails || 0
  if (d.img) img.value = d.img
  if (d.src) srcTail.value = '…' + d.src
  if (d.err) err.value = d.err
}

function onCoreTap(): void {
  const n = taps.value + 1
  taps.value = n
  const mood = n % 3 === 0 ? '过载' : '稳定'
  status.value = '核心能量 +' + n + ' ｜ 当前状态：' + mood
}
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 12px 40px;
  gap: 6px;
  background: #0b1020;
  min-height: 100vh;
  box-sizing: border-box;
}
.title {
  font-size: 20px;
  font-weight: 700;
  color: #e0f2fe;
  letter-spacing: 2px;
}
.sub {
  font-size: 11px;
  color: #7dd3fc;
  opacity: 0.8;
  text-align: center;
}
.stage {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.hit-area {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 200px;
  height: 200px;
  margin-left: -100px;
  margin-top: -100px;
  border-radius: 50%;
  z-index: 10;
}
.status {
  font-size: 13px;
  color: #a5f3fc;
  margin-top: 4px;
  font-weight: 600;
}
.diag {
  font-size: 12px;
  color: #fca5a5;
  word-break: break-all;
  text-align: center;
  line-height: 1.3;
}
.cards {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 20px;
  width: 100%;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 88px;
}
.card-label {
  font-size: 10px;
  color: #93c5fd;
}
.hint {
  font-size: 11px;
  color: #64748b;
  margin-top: 16px;
  text-align: center;
}

/* 旋转动画（作用于 SVG 内 <g> —— CSS 通道） */
.spin-slow {
  animation: spin 18s linear infinite;
  transform-origin: 100px 100px;
}
.spin-rev {
  animation: spin-rev 12s linear infinite;
  transform-origin: 100px 100px;
}
.spin-fast {
  animation: spin 6s linear infinite;
  transform-origin: 50px 50px;
}
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
@keyframes spin-rev {
  from {
    transform: rotate(360deg);
  }
  to {
    transform: rotate(0deg);
  }
}
</style>

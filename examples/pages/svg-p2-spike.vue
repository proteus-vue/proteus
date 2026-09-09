<!-- examples/pages/svg-p2-spike.vue —— ★G-62 P2 地基验证（2026-09-09）
     目的：Skyline <image> 渲染 SVG 时支持多少高级特性（决定 P2 范围）。
     逐项对照：linearGradient / radialGradient / clipPath / mask / transform 矩阵 / stroke-dasharray /
     opacity / filter / text / 嵌套 g / use+symbol。
     每个特性单独一个 SVG（互不干扰，便于逐项判定）。 -->
<template>
  <view class="spike" @tap="onRootTap" @touchstart="onRootTouch" @touchend="onRootTouch">
    <text class="spike-title">SVG 高级特性渲染对照</text>
    <text class="spike-sub">每格一个特性——看哪个渲染、哪个空白</text>
    <text class="spike-sub">{{ tapLog }}</text>

    <text class="spike-sub">↓ 编译器 lowering：&lt;use href&gt; 零改代码（编译期展开）</text>
    <view class="spike-cell">
      <svg viewBox="0 0 100 100" width="72" height="72">
        <defs>
          <symbol id="dot">
            <circle cx="0" cy="0" r="15" fill="#e74c3c" />
          </symbol>
        </defs>
        <use href="#dot" x="30" y="30" />
        <use href="#dot" x="70" y="70" />
      </svg>
      <text class="spike-label">use 编译器展开</text>
    </view>

    <text class="spike-sub">↓ 对照：含 text vs 不含 text（同一 SVG，看 rect 是否显示）</text>
    <view class="spike-row">
      <view class="spike-cell">
        <image class="spike-img" :src="dbgWithText" mode="aspectFit" />
        <text class="spike-label">含 text</text>
      </view>
      <view class="spike-cell">
        <image class="spike-img" :src="dbgNoText" mode="aspectFit" />
        <text class="spike-label">不含 text</text>
      </view>
    </view>

    <text class="spike-sub">↓ 50 图标压力测试（{{ perfItems.length }} 个）</text>
    <view class="perf-grid">
      <image v-for="(it, i) in perfItems" :key="i" class="perf-img" :src="it.src" mode="aspectFit" />
    </view>

    <view class="spike-grid">
      <view class="spike-cell" v-for="(it, i) in items" :key="i">
        <image class="spike-img" :src="it.src" mode="aspectFit" @tap="onImgTap" data-idx="{{i}}" />
        <text class="spike-label">{{ it.name }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

const NS = 'http://www.w3.org/2000/svg'
const items = ref<any[]>([])
const tapLog = ref('未点击')
const dbgWithText = ref('')
const perfItems = ref<any[]>([])
const perfMs = ref('')

onMounted(() => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2 L22 22 L2 22 Z" fill="#e74c3c"/></svg>'
  const uri = 'data:image/svg+xml,' + encodeURIComponent(svg)
  const items: Array<{ src: string }> = []
  for (let i = 0; i < 50; i++) items.push({ src: uri })
  const t0 = Date.now()
  perfItems.value = items
  setTimeout(() => { perfMs.value = 'setData→渲染 ' + (Date.now() - t0) + 'ms' }, 100)
})
const dbgNoText = ref('')

function onRootTouch(e: unknown): void {
  const ev = e as { type?: string; detail?: unknown; touches?: unknown; changedTouches?: unknown } | undefined
  tapLog.value = 'TOUCH ' + String(ev?.type) + ' detail=' + JSON.stringify(ev?.detail) + ' touches=' + JSON.stringify(ev?.touches) + ' changed=' + JSON.stringify(ev?.changedTouches)
  console.log('[tap-root]', tapLog.value)
}
function onRootTap(e: unknown): void {
  const ev = e as { detail?: unknown; touches?: unknown; changedTouches?: unknown; currentTarget?: unknown; target?: unknown } | undefined
  tapLog.value = 'ROOT detail=' + JSON.stringify(ev?.detail) + ' touch=' + JSON.stringify(ev?.touches) + ' changed=' + JSON.stringify(ev?.changedTouches)
  console.log('[tap-root]', tapLog.value)
}
function onImgTap(e: unknown): void {
  const ev = e as {
    detail?: { x?: number; y?: number }
    currentTarget?: { dataset?: { idx?: number }; offsetLeft?: number; offsetTop?: number }
    touches?: Array<{ x?: number; y?: number; clientX?: number; clientY?: number; pageX?: number; pageY?: number }>
    changedTouches?: Array<{ x?: number; y?: number }>
  } | undefined
  tapLog.value =
    'detail=' + JSON.stringify(ev?.detail) +
    ' | touch=' + JSON.stringify(ev?.touches?.[0]) +
    ' | changed=' + JSON.stringify(ev?.changedTouches?.[0]) +
    ' | ct=' + JSON.stringify(ev?.currentTarget)
  console.log('[tap-probe]', tapLog.value)
}

onMounted(() => {
  items.value = [
  {
    name: 'linearGradient',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">` +
        `<stop offset="0" stop-color="#e74c3c"/><stop offset="1" stop-color="#3498db"/></linearGradient></defs>` +
        `<rect x="5" y="20" width="90" height="60" fill="url(#g)"/></svg>`,
    ),
  },
  {
    name: 'radialGradient',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><defs><radialGradient id="r">` +
        `<stop offset="0" stop-color="#f1c40f"/><stop offset="1" stop-color="#8e44ad"/></radialGradient></defs>` +
        `<circle cx="50" cy="50" r="45" fill="url(#r)"/></svg>`,
    ),
  },
  {
    name: 'clipPath',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><defs><clipPath id="c"><circle cx="50" cy="50" r="35"/></clipPath></defs>` +
        `<rect x="0" y="0" width="100" height="100" fill="#2ecc71" clip-path="url(#c)"/></svg>`,
    ),
  },
  {
    name: 'mask',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><defs><mask id="m"><rect x="0" y="0" width="100" height="100" fill="#fff"/>` +
        `<circle cx="50" cy="50" r="30" fill="#000"/></mask></defs>` +
        `<rect x="0" y="0" width="100" height="100" fill="#9b59b6" mask="url(#m)"/></svg>`,
    ),
  },
  {
    name: 'transform 矩阵',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><g transform="translate(50 50) rotate(45) scale(0.8)">` +
        `<rect x="-30" y="-15" width="60" height="30" fill="#e67e22"/></g></svg>`,
    ),
  },
  {
    name: 'stroke-dasharray',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#16a085" ` +
        `stroke-width="8" stroke-dasharray="20 10"/></svg>`,
    ),
  },
  {
    name: 'opacity + 嵌套 g',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><g opacity="0.5"><rect x="10" y="10" width="50" height="50" fill="#c0392b"/>` +
        `<circle cx="65" cy="65" r="25" fill="#2980b9"/></g></svg>`,
    ),
  },
  {
    name: 'use 原始(手写 URI)',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><defs><symbol id="s"><circle cx="0" cy="0" r="15" fill="#34495e"/></symbol></defs>` +
        `<use href="#s" x="30" y="30"/><use href="#s" x="70" y="70"/></svg>`,
    ),
  },
  {
    name: '静态对照(无动画)',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><circle cx="20" cy="50" r="12" fill="#e74c3c"/></svg>`,
    ),
  },
  {
    name: 'SMIL animate',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><circle cx="20" cy="50" r="12" fill="#e74c3c">` +
        `<animate attributeName="cx" values="20;80;20" dur="2s" repeatCount="indefinite"/></circle></svg>`,
    ),
  },
  {
    name: 'SMIL animateTransform',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><rect x="35" y="35" width="30" height="30" fill="#3498db">` +
        `<animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="3s" repeatCount="indefinite"/></rect></svg>`,
    ),
  },
  {
    name: 'CSS @keyframes',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><style>@keyframes s{0%{opacity:1}50%{opacity:0.2}100%{opacity:1}}.a{animation:s 2s infinite}</style>` +
        `<circle cx="50" cy="50" r="30" fill="#2ecc71" class="a"/></svg>`,
    ),
  },
  {
    name: 'stroke-dashoffset 动画',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="none" stroke="#9b59b6" stroke-width="8" ` +
        `stroke-dasharray="220" stroke-dashoffset="220"><animate attributeName="stroke-dashoffset" from="220" to="0" dur="2s" repeatCount="indefinite"/></circle></svg>`,
    ),
  },
  {
    name: 'filter 模糊',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><defs><filter id="f"><feGaussianBlur stdDeviation="3"/></filter></defs>` +
        `<circle cx="50" cy="50" r="30" fill="#e74c3c" filter="url(#f)"/></svg>`,
    ),
  },
  ]
})
</script>
<style scoped>
.perf-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px;
}
.perf-img {
  width: 24px;
  height: 24px;
}
.spike {
  display: flex;
  flex-direction: column;
  padding: 8px;
}
.spike-title {
  font-size: 15px;
  font-weight: 700;
}
.spike-sub {
  font-size: 11px;
  color: #666;
  margin-bottom: 6px;
}
.spike-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}
.spike-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 25%;
  margin-bottom: 8px;
}
.spike-img {
  width: 64px;
  height: 64px;
  border: 1px solid #ddd;
  background: #fafafa;
}
.spike-label {
  font-size: 9px;
  color: #333;
  margin-top: 2px;
}
</style>

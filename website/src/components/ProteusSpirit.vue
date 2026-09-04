<template>
  <p-view class="spirit" :class="{ 'no-motion': !motionOk }">
    <!-- ★形态主题气泡（切换时弹出，3.2s 自动收起） -->
    <Transition name="bubble">
      <p-view v-if="bubbleVisible" class="speech" role="status">
        <p-text class="speech-title">{{ form.name }}</p-text>
        <p-text class="speech-line">{{ form.theme }}</p-text>
      </p-view>
    </Transition>

    <!-- ★Q 版小海神（SVG 矢量——身体渐变随形态色） -->
    <svg class="sprite" viewBox="0 0 120 132" role="button" :aria-label="`切换形态，当前：${form.name}`" @click="onMorph">
      <defs>
        <linearGradient id="spirit-body-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" :stop-color="form.color" />
          <stop offset="1" stop-color="#00e0c6" />
        </linearGradient>
      </defs>

      <!-- 海流尾 -->
      <path class="tail" d="M28,112 C14,108 8,98 12,88" fill="none" :stroke="form.color" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 7" />

      <!-- 左手（常驻摆动） -->
      <ellipse class="hand hand-left" cx="16" cy="84" rx="10" ry="7" :fill="form.color" />
      <!-- 身体（水滴形） -->
      <path class="body" d="M60,12 C90,12 106,42 106,72 C106,102 86,122 60,122 C34,122 14,102 14,72 C14,42 30,12 60,12 Z" :fill="bodyGrad" stroke="rgba(10,10,12,0.35)" stroke-width="2" />
      <!-- 右手（挥手） -->
      <ellipse class="hand hand-right" cx="104" cy="82" rx="10" ry="7" :fill="form.color" />

      <!-- 呆毛 ×3 -->
      <path class="hair" d="M48,14 C44,6 50,2 54,1" fill="none" :stroke="form.color" stroke-width="4" stroke-linecap="round" />
      <path class="hair hair-2" d="M60,12 C60,4 66,0 72,2" fill="none" :stroke="form.color" stroke-width="4" stroke-linecap="round" />
      <path class="hair hair-3" d="M72,14 C76,8 82,6 86,8" fill="none" :stroke="form.color" stroke-width="4" stroke-linecap="round" />

      <!-- 眼睛（白眼底 + 瞳孔跟随鼠标） -->
      <g class="eyes" :class="{ blink: blinking }">
        <ellipse cx="45" cy="62" rx="8.5" ry="9.5" fill="#f6f6fa" />
        <ellipse cx="75" cy="62" rx="8.5" ry="9.5" fill="#f6f6fa" />
        <circle class="pupil" :cx="45 + pupil.x" :cy="62 + pupil.y" r="4.2" fill="#0a0a0c" />
        <circle class="pupil" :cx="75 + pupil.x" :cy="62 + pupil.y" r="4.2" fill="#0a0a0c" />
        <circle :cx="45 + pupil.x - 1.4" :cy="62 + pupil.y - 1.6" r="1.3" fill="#ffffff" />
        <circle :cx="75 + pupil.x - 1.4" :cy="62 + pupil.y - 1.6" r="1.3" fill="#ffffff" />
      </g>

      <!-- 嘴（变身瞬间 O 型惊喜） -->
      <path v-if="!surprised" class="mouth" d="M53,84 Q60,90 67,84" fill="none" stroke="#0a0a0c" stroke-width="2.4" stroke-linecap="round" />
      <ellipse v-else cx="60" cy="85" rx="5" ry="6" fill="#0a0a0c" />

      <!-- 腮红 -->
      <ellipse cx="34" cy="76" rx="6" ry="3.6" fill="rgba(255, 138, 92, 0.35)" />
      <ellipse cx="86" cy="76" rx="6" ry="3.6" fill="rgba(255, 138, 92, 0.35)" />
    </svg>
  </p-view>
</template>

<script setup lang="ts">
// website/src/components/ProteusSpirit.vue —— ★#389h Q 版小海神（拟人化形象 + 形态主题气泡）
//   点击角色 → 循环切换形态（本体/Web/iOS/Android/鸿蒙/Flutter/小程序）+ 气泡弹出当前形态主题思想
//   瞳孔跟随鼠标（G-24 指针语义）+ 偶发眨眼 + 变身时 O 型嘴惊喜
//   降级：reduced-motion → 无浮动/无眨眼动画（气泡仍为信息性显示）
import { computed, onMounted, onUnmounted, ref } from 'vue'

interface SpiritForm {
  name: string
  color: string
  theme: string
}

const FORMS: SpiritForm[] = [
  { name: 'Proteus · 本体', color: '#7c5cff', theme: '一种语义，万种形态——变形是我的天性' },
  { name: 'Web · VueDom', color: '#42b883', theme: '语义直出 DOM——标准 Vue 零转换跑进浏览器' },
  { name: 'iOS · UIKit', color: '#0a84ff', theme: 'UILabel / UIStackView——原生控件原生体验' },
  { name: 'Android · Jetpack', color: '#3ddc84', theme: 'Jetpack 视图树——Material 质感由我渲染' },
  { name: '鸿蒙 · ArkUI', color: '#ff8a5c', theme: 'ArkUI 声明式——一次开发多端部署' },
  { name: 'Flutter · Widget', color: '#54c5f8', theme: '一棵 Widget 树在 Skia 画布上生长' },
  { name: '小程序 · Skyline', color: '#00e0c6', theme: 'Skyline 语法直出——wx:if 就是这么来的' },
]

const idx = ref(0)
const form = computed(() => FORMS[idx.value]!)
// ★body 渐变（形态色 → 青）
const bodyGrad = computed(() => `url(#spirit-body-grad)`)
// ★#389h 动效守卫（reduced-motion → 静态）
const motionOk = ref(true)

// 气泡（弹出 3.2s 自动收起）
const bubbleVisible = ref(false)
let bubbleTimer: ReturnType<typeof setTimeout> | undefined

// 瞳孔跟随鼠标（±2.6 SVG 单位内）
const pupil = ref({ x: 0, y: 0 })
// O 型嘴（变身瞬间惊喜）
const surprised = ref(false)
// 眨眼（CSS class）
const blinking = ref(false)

function onMorph(): void {
  idx.value = (idx.value + 1) % FORMS.length
  bubbleVisible.value = true
  surprised.value = true
  clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => (bubbleVisible.value = false), 3200)
  setTimeout(() => (surprised.value = false), 700)
}

// 瞳孔跟随（rAF 节流）
let eyeTarget = { x: 0, y: 0 }
let eyeRaf = 0
function onMove(e: PointerEvent): void {
  eyeTarget = { x: e.clientX, y: e.clientY }
  if (!eyeRaf) eyeRaf = requestAnimationFrame(applyEye)
}
function applyEye(): void {
  eyeRaf = 0
  const svg = document.querySelector('.site-spirit .sprite') as SVGElement | null
  if (!svg) return
  const r = svg.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height * 0.47
  const dx = eyeTarget.x - cx
  const dy = eyeTarget.y - cy
  const dl = Math.max(1, Math.hypot(dx, dy))
  const f = Math.min(2.6, dl * 0.02)
  pupil.value = { x: (dx / dl) * f, y: (dy / dl) * f }
}

// 偶发眨眼
let blinkT: ReturnType<typeof setTimeout> | undefined
let blinkHold: ReturnType<typeof setTimeout> | undefined
function scheduleBlink(): void {
  blinkT = setTimeout(() => {
    blinking.value = true
    blinkHold = setTimeout(() => {
      blinking.value = false
      scheduleBlink()
    }, 160)
  }, 2800 + Math.random() * 2800)
}

let moveRaf = 0
let lastMove = 0
function onMoveThrottled(e: PointerEvent): void {
  const now = performance.now()
  if (now - lastMove < 50) return
  lastMove = now
  onMove(e)
}

onMounted(() => {
  motionOk.value = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  if (motionOk.value) {
    window.addEventListener('pointermove', onMoveThrottled, { passive: true })
    scheduleBlink()
  }
})

onUnmounted(() => {
  window.removeEventListener('pointermove', onMoveThrottled)
  clearTimeout(blinkT)
  clearTimeout(blinkHold)
  clearTimeout(bubbleTimer)
  if (eyeRaf) cancelAnimationFrame(eyeRaf)
})
</script>

<style scoped>
.spirit {
  display: block;
  width: 100%;
  cursor: pointer;
  user-select: none;
  position: relative;
  text-align: center;
}

/* —— Q 版角色 —— */
.sprite {
  display: block;
  width: 100%;
  filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.35));
}
.body {
  transition: fill 0.5s ease;
  animation: spirit-bob 4.4s ease-in-out infinite alternate;
  transform-origin: 60px 66px;
}
@keyframes spirit-bob {
  from { transform: translateY(-3px); }
  to { transform: translateY(4px); }
}
.no-motion .body { animation: none; }

.hair {
  transition: stroke 0.5s ease;
  animation: hair-sway 3.2s ease-in-out infinite alternate;
  transform-origin: 60px 16px;
}
.hair-2 { animation-duration: 2.7s; }
.hair-3 { animation-duration: 3.6s; }
@keyframes hair-sway {
  from { transform: rotate(-4deg); }
  to { transform: rotate(5deg); }
}
.no-motion .hair { animation: none; }

.eyes { transform-box: fill-box; transform-origin: center; }
.spirit.blinking .eyes { animation: spirit-blink-eyes 0.18s ease; }
@keyframes spirit-blink-eyes {
  50% { transform: scaleY(0.08); }
}
.hand-left {
  animation: hand-sway 2.6s ease-in-out infinite alternate;
  transform-origin: 26px 84px;
}
.no-motion .hand-left { animation: none; }
@keyframes hand-sway {
  from { transform: rotate(-6deg); }
  to { transform: rotate(8deg); }
}

/* —— 形态气泡（主题思想） —— */
.speech {
  position: absolute;
  right: 0;
  bottom: calc(100% + 12px);
  width: 208px;
  background: #f6f6fa;
  color: #17171b;
  border-radius: 14px;
  padding: 10px 12px;
  text-align: left;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  z-index: 5;
}
.speech::after {
  content: '';
  position: absolute;
  right: 26px;
  bottom: -7px;
  width: 14px;
  height: 14px;
  background: #f6f6fa;
  transform: rotate(45deg);
  border-radius: 3px;
}
.speech-title { display: block; color: #0a0a0c; font-weight: 700; font-size: 12.5px; }
.speech-line { display: block; color: #44444e; font-size: 11.5px; line-height: 1.55; margin-top: 3px; }

/* —— 气泡出入场（Vue Transition） —— */
.bubble-enter-active { transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.4); }
.bubble-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.bubble-enter-from,
.bubble-leave-to { opacity: 0; transform: translateY(8px) scale(0.92); }
</style>

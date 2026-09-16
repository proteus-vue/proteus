<!-- src/components/p-page-container/index.vue —— 页面容器 / 弹出层（★能力颗粒度对齐 C2：shell.page-container · 对齐小程序 <page-container>）
     对齐小程序 <page-container>：从底部/顶部/居中弹出的半屏容器，支持 close-on-click-overlay / close-on-slide-down
     双端同源码：teleport → root-portal（Skyline 顶层）；容器结构对齐 p-drawer（遮罩仅视觉层，根容器收点击）
     ★2026-09-14 官方属性对齐（批次 2）+ 真机/浏览器复测修复：
       ① position（bottom/top/center）此前只声明未实现（永远从底部弹）→ 落成单类变体 + 对应位移；
       ② 关闭动画：root 直接 visibility:hidden 会**瞬间隐藏**，退场不可见 → 加 phase（enter/leave），
          leave 播完再隐藏（对齐 p-picker/p-drawer 的常驻 + class 驱动）；
       ③ 遮罩点击关闭：父级须用 `v-model:show` 或 `@update:show`（编译器已归一单段事件名 update-show——
          此前父级 `bind:update:show` 双冒号与子组件 `update-show` 永不匹配 = 真机点遮罩关不掉的真根因）；
       ④ 下滑关闭：触摸（MP/mobile Web）+ 鼠标（desktop Web）双套手势，不直调 document/window。
     ★Skyline 约束（S1）：位移一律走**行内 computed style**（不用 `.a.a--open` 复合类选择器——会被剔除）。 -->
<template>
  <teleport to="body">
    <view
      class="p-page-container-root"
      :class="{ 'p-page-container-root--open': shown }"
      :style="rootStyle"
    >
      <view
        v-if="shown && overlay"
        class="p-page-container-mask"
        :class="{ 'p-page-container-mask--enter': phase === 'enter', 'p-page-container-mask--leave': phase === 'leave' }"
        :style="overlayStyle"
        @click="onMaskTap"
      />
      <view
        class="p-page-container"
        :style="panelStyle"
        @click.stop="noop"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
      >
        <view class="p-page-container__handle" />
        <slot />
      </view>
    </view>
  </teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps({
  /** 显示（v-model:show） */
  show: { type: Boolean, default: false },
  /** 位置：bottom 底部（默认）/ top 顶部 / center 居中（★官方 position） */
  position: { type: String, default: 'bottom' },
  /** 是否显示遮罩 */
  overlay: { type: Boolean, default: true },
  /** 点击遮罩关闭 */
  closeOnClickOverlay: { type: Boolean, default: true },
  /** 圆角（★官方 round） */
  round: { type: Boolean, default: true },
  // ── ★官方 <page-container> 属性（2026-09-14 对齐） ──
  /** 进出场动画时长（ms） */
  duration: { type: Number, default: 300 },
  /** 层级 */
  zIndex: { type: Number, default: 2000 },
  /** 下滑一段距离后关闭（触摸/鼠标手势，双端同源） */
  closeOnSlideDown: { type: Boolean, default: false },
  /** 自定义遮罩层样式 */
  overlayStyle: { type: String, default: '' },
  /** 自定义弹出层样式 */
  customStyle: { type: String, default: '' },
})

const emit = defineEmits(['update:show', 'close'])

/** ★常驻 + class 驱动：leave 动画播完再隐藏（否则 root 瞬间 visibility:hidden，退场动画看不见） */
const shown = ref(false)
const phase = ref('idle') // 'enter' | 'leave' | 'idle'
const leaveTimer = ref(0)

// ★位置/圆角/位移全部走**行内 computed style**：避免动态 :class（编译器无法静态 scoped 后缀 →
//   MP 端类名不匹配，S11）与复合类选择器（Skyline 剔除，S1/S46）。
const rootStyle = computed(() => `z-index: ${props.zIndex}`)

const panelStyle = computed(() => {
  const d = `${props.duration}ms`
  const open = shown.value && phase.value !== 'leave'
  const isTop = props.position === 'top'
  const isCenter = props.position === 'center'
  let transform = ''
  let opacity = '1'
  if (isTop) transform = open ? 'translateY(0)' : 'translateY(-100%)'
  else if (isCenter) {
    transform = open ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(0.92)'
    opacity = open ? '1' : '0'
  } else transform = open ? 'translateY(0)' : 'translateY(100%)'
  // 定位（bottom 贴底 / top 贴顶 / center 垂直居中）
  const posDecl = isTop
    ? 'top: 0; left: 0; right: 0;'
    : isCenter
      ? 'top: 50%; left: 16px; right: 16px;'
      : 'bottom: 0; left: 0; right: 0;'
  const radius = props.round
    ? isTop
      ? '0 0 16px 16px'
      : isCenter
        ? '16px'
        : '16px 16px 0 0'
    : '0'
  return `${posDecl} border-radius: ${radius}; transform: ${transform}; opacity: ${opacity}; transition: transform ${d} ease, opacity ${d} ease; -webkit-transition: transform ${d} ease, opacity ${d} ease; ${props.customStyle || ''}`
})

/** 外部 show 变化 → 驱动内部 shown/phase（watch 由编译器转 observers 进 data） */
function sync(next: boolean): void {
  if (next) {
    if (leaveTimer.value) { clearTimeout(leaveTimer.value); leaveTimer.value = 0 }
    phase.value = 'enter'
    shown.value = true
  } else if (shown.value) {
    phase.value = 'leave'
    if (leaveTimer.value) clearTimeout(leaveTimer.value)
    leaveTimer.value = setTimeout(() => {
      shown.value = false
      phase.value = 'idle'
    }, props.duration) as unknown as number
  }
}
watch(() => props.show, (v) => sync(!!v), { immediate: true })

function noop(): void {
  // 吞掉面板内点击冒泡（对齐 p-drawer）
}
function close(): void {
  emit('update:show', false)
  emit('close')
}
function onMaskTap(): void {
  if (!props.closeOnClickOverlay) return
  close()
}

// ── 下滑/上滑关闭（close-on-slide-down）：触摸 + 鼠标双套手势（不直调 document/window） ──
const startY = ref(0)
const tracking = ref(false)
const DOWN = 40
function begin(y: number): void {
  if (!props.closeOnSlideDown) return
  tracking.value = true
  startY.value = y
}
function finish(y: number): void {
  if (!tracking.value) return
  tracking.value = false
  const dy = y - startY.value
  // bottom 面板下滑关闭；top 面板上滑关闭
  if (props.position === 'top' ? dy < -DOWN : dy > DOWN) close()
}
function onTouchStart(e: any): void { begin(e?.touches?.[0]?.clientY ?? 0) }
function onTouchMove(): void { /* 位移反馈交由 transform/原生滚动 */ }
function onTouchEnd(e: any): void { finish(e?.changedTouches?.[0]?.clientY ?? startY.value) }
function onMouseDown(e: any): void { begin(e?.clientY ?? 0) }
function onMouseMove(): void { /* 同上 */ }
function onMouseUp(e: any): void { finish(e?.clientY ?? startY.value) }
</script>

<style scoped>
.p-page-container-root {
  /* 弹层常规结构（同 p-drawer）：容器 fixed 全屏 = 视口坐标系，子元素 absolute 相对本容器定位。
     Skyline 下 root-portal 已脱离页面层叠，fixed 仅作坐标基准（编译期警告为已知项，同 p-drawer/p-popup）。 */
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 2000;
  visibility: hidden;
  pointer-events: none;
}
.p-page-container-root--open {
  visibility: visible;
  pointer-events: auto;
}
.p-page-container-mask {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  opacity: 1;
}
/* ★遮罩进出场：enter 淡入 / leave 淡出（keyframe——对齐 p-picker，两端可靠） */
.p-page-container-mask--enter {
  animation: p-page-container-fade-in 0.3s ease-out;
}
.p-page-container-mask--leave {
  animation: p-page-container-fade-out 0.3s ease-in;
}
@keyframes p-page-container-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes p-page-container-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
/* 面板基类：仅背景/留白（定位/圆角/位移走行内 style——避开动态类与复合选择器，见上） */
.p-page-container {
  position: absolute;
  background: var(--p-bg-elevated, #fff);
  max-height: 80%;
  padding: 8px 0 0;
}
.p-page-container__handle {
  width: 36px;
  height: 4px;
  margin: 0 auto 8px;
  border-radius: 2px;
  background: var(--p-border, rgba(0, 0, 0, 0.12));
}
</style>

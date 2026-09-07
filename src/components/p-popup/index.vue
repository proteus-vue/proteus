<!-- src/components/p-popup/index.vue —— 弹层（组件库 B5）
     矩阵 01 §8：visible + position（bottom/center/top）+ close-on-mask + 转场动画
     转场：CSS animation（enter 自动播放 / leave 播完 emit close）——Worklet applyAnimatedStyle 标注 v0.6
     可见性驱动：watch(() => props.visible)（B3 原语：Web Vue watch / MP observers）
     双端同源码：view + fixed 定位；Skyline fixed 支持基础库 2.26+ -->
<template>
  <!-- ★2026-09-07 弹层命中契约（p-drawer P7 同款）：根容器 fixed 全屏 = 可靠命中层（关闭事件挂容器），
       遮罩纯视觉（背景被合成进容器层 → 自身不参与 skyline 命中），面板 @tap.stop 吞自身冒泡
       ★位置类静态字面量（p-modal 布局专项④同款）：动态拼接类/动态 style 在 Skyline 均不可靠（面板左上角），
       按 position 三形态各渲染一个静态类面板 → scoped 必命中 -->
  <view v-if="shown" class="p-popup" @tap="onLayerTap">
    <view class="p-popup-mask" :style="{ opacity: maskOpacity }" />
    <!-- bottom -->
    <view
      v-if="position === 'bottom'"
      class="p-popup-panel p-popup-panel--bottom"
      :class="phase ? 'p-popup-panel--' + phase : ''"
      @tap.stop="noop"
    >
      <slot />
    </view>
    <!-- top -->
    <view
      v-else-if="position === 'top'"
      class="p-popup-panel p-popup-panel--top"
      :class="phase ? 'p-popup-panel--' + phase : ''"
      @tap.stop="noop"
    >
      <slot />
    </view>
    <!-- center（默认兜底） -->
    <view
      v-else
      class="p-popup-panel p-popup-panel--center"
      :class="phase ? 'p-popup-panel--' + phase : ''"
      @tap.stop="noop"
    >
      <slot />
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { capabilityWarnOnce } from '../runtime/capability'

const props = defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  visible: { type: Boolean, default: false },
  position: { type: String, default: 'bottom' }, // bottom / center / top
  closeOnMask: { type: Boolean, default: true },
  maskOpacity: { type: Number, default: 0.5 },
  duration: { type: Number, default: 0 }, // 0 = 按位置自动（center 250 / 其他 320）
})

const emit = defineEmits(['close'])

const shown = ref(false)
const phase = ref('')
const timer = ref(0)

// 可见性驱动：enter 动画自动播放；父级直接隐藏时立即移除（不播 leave——leave 只用于组件主动关闭的收尾）
// ★B7 降级显式（C6）：Worklet 未实现 → CSS animation（warn 一次）
watch(() => props.visible, () => {
  if (props.visible) {
    capabilityWarnOnce('p-popup', 'worklet-animation', 'CSS animation（Worklet 未实现，v0.6 后接）')
    shown.value = true
    phase.value = 'enter'
  } else {
    shown.value = false
    phase.value = ''
    clearTimeout(timer.value)
  }
})

function onLayerTap() {
  if (props.closeOnMask) requestClose()
}

/** 面板内点击仅需阻止冒泡（MP catchtap 无值形式不可编译 → 显式方法承载 .stop） */
function noop(): void {}

// 组件主动关闭：播 leave 动画 → 时长后 emit close（父置 visible=false）
function requestClose() {
  if (!shown.value || phase.value === 'leave') return
  phase.value = 'leave'
  const dur = props.duration > 0 ? props.duration : props.position === 'center' ? 250 : 320
  timer.value = setTimeout(() => {
    emit('close')
  }, dur) as unknown as number
}

// ★B7 内存：组件销毁清理定时器（MP 组件 onUnmounted → detached）
onUnmounted(() => {
  clearTimeout(timer.value)
})
</script>

<style scoped>
.p-popup {
  /* 弹层常规结构：根容器 fixed 全屏 = 视口坐标 + 可靠命中层 */
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
}
.p-popup-mask {
  /* 显式四边定位（skyline 不认 inset 简写）；纯视觉（背景合成进容器） */
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #000;
  z-index: 1;
}
.p-popup-panel {
  position: absolute;
  z-index: 2;
  background: #fff;
  border-radius: 12px;
}
.p-popup-panel--bottom {
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 12px 12px 0 0;
}
.p-popup-panel--top {
  left: 0;
  right: 0;
  top: 0;
  border-radius: 0 0 12px 12px;
}
.p-popup-panel--center {
  left: 24px;
  right: 24px;
  top: 50%;
  transform: translateY(-50%);
}
/* 转场（enter 自动 / leave 播完由 setTimeout 收尾 emit close）；keyframes 名全局唯一防冲突 */
.p-popup-panel--enter {
  animation: proteus-popup-in 320ms ease-out;
}
.p-popup-panel--leave {
  animation: proteus-popup-out 320ms ease-in;
}
.p-popup-panel--center.p-popup-panel--enter {
  animation-name: proteus-popup-fade-in;
}
.p-popup-panel--center.p-popup-panel--leave {
  animation-name: proteus-popup-fade-out;
}
@keyframes proteus-popup-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
@keyframes proteus-popup-out {
  from { transform: translateY(0); }
  to { transform: translateY(100%); }
}
@keyframes proteus-popup-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes proteus-popup-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
</style>

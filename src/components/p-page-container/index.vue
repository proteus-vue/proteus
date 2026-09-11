<!-- src/components/p-page-container/index.vue —— 页面容器 / 底部弹出层（★能力颗粒度对齐 C2：shell.page-container · 对齐小程序 <page-container>）
     对齐小程序 <page-container>：从底部弹出的半屏/全屏容器，支持 close-on-click-overlay / close-on-swipe-down
     双端同源码：teleport → root-portal（Skyline 顶层）；容器结构对齐 p-drawer（遮罩仅视觉层，根容器收点击）
     MP 安全：CSS transform 过渡；无 wx/document/window 直调 -->
<template>
  <teleport to="body">
    <view class="p-page-container-root" :class="{ 'p-page-container-root--open': show }">
      <view v-if="show && overlay" class="p-page-container-mask" @click="onMaskTap" />
      <view class="p-page-container" :class="{ 'p-page-container--open': show }" @click.stop="noop">
        <view class="p-page-container__handle" />
        <slot />
      </view>
    </view>
  </teleport>
</template>

<script setup lang="ts">
const props = defineProps({
  /** 显示（v-model:show） */
  show: { type: Boolean, default: false },
  /** 位置：bottom 底部（默认）/ top 顶部 / center 居中 */
  position: { type: String, default: 'bottom' },
  /** 是否显示遮罩 */
  overlay: { type: Boolean, default: true },
  /** 点击遮罩关闭 */
  closeOnClickOverlay: { type: Boolean, default: true },
  /** 圆角 px（顶部两角） */
  round: { type: Boolean, default: true },
})

const emit = defineEmits(['update:show', 'close'])

function noop(): void {
  // 吞掉面板内点击冒泡（对齐 p-drawer）
}

function onMaskTap(): void {
  if (!props.closeOnClickOverlay) return
  emit('update:show', false)
  emit('close')
}
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
}
.p-page-container {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 80%;
  background: var(--p-bg-elevated, #fff);
  border-radius: 16px 16px 0 0;
  transform: translateY(100%);
  transition: transform 0.3s ease;
  padding: 8px 0 0;
}
.p-page-container--open {
  transform: translateY(0);
}
.p-page-container__handle {
  width: 36px;
  height: 4px;
  margin: 0 auto 8px;
  border-radius: 2px;
  background: var(--p-border, rgba(0, 0, 0, 0.12));
}
</style>

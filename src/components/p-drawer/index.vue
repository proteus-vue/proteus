<!-- src/components/p-drawer/index.vue —— 侧滑抽屉（★G-32 B2：shell.drawer S5）
     open 受控（v-model:open ←→ modelValue）+ side 方向 + width + overlay 遮罩点击关闭
     双端同源码：div → view；CSS transform 滑入滑出（MP 安全）

     ★2026-09-07 Skyline 真机修复：点遮罩关不掉抽屉。
     根因（探针实证）：Skyline 下自定义组件内「遮罩元素自身」不参与命中测试——
     wx:if 动态插入/常驻挂载均无效，事件落到根容器；而「根容器」事件可靠。
     方案（对齐 p-modal「布局专项②」容器结构 + 事件挂可靠层）：
       ① 根容器 fixed 全屏 = 视口坐标 + 命中基准，@click 收「非面板区」点击关闭；
       ② 遮罩仅视觉层（不再绑事件）；
       ③ 抽屉面板 @click.stop（MP→catchtap）吞掉自身冒泡，面板内点击不触发关闭；
       ④ 关闭态容器 visibility:hidden 不拦截页面；过渡方向技巧保留滑出动画。 -->
<template>
  <view
    class="p-drawer-root"
    :class="{ 'p-drawer-root--open': modelValue }"
    @click="onMaskAreaTap"
  >
    <view v-if="modelValue && overlay" class="p-drawer-mask" />
    <view
      class="p-drawer"
      :class="[side, { 'p-drawer-open': modelValue }]"
      :style="{ width: width + 'px' }"
      @click.stop="noop"
    >
      <slot />
    </view>
  </view>
</template>

<script setup lang="ts">
const props = defineProps({
  /** 展开状态（v-model:open） */
  modelValue: { type: Boolean, default: false },
  /** 侧向：left / right */
  side: { type: String, default: 'left' },
  /** 抽屉宽度 px */
  width: { type: Number, default: 300 },
  /** 遮罩（点击关闭） */
  overlay: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue'])

/** 面板内点击仅需阻止冒泡（MP catchtap 无值形式不可编译 → 显式 noop 方法承载 .stop） */
function noop(): void {}

/** 非面板区（遮罩/容器空白）点击关闭；无遮罩（overlay=false）时不响应外部点击 */
function onMaskAreaTap(): void {
  if (!props.overlay || !props.modelValue) return
  emit('update:modelValue', false)
}
</script>

<style scoped>
.p-drawer-root {
  /* 弹层常规结构（同 p-modal）：容器 fixed 全屏 = 视口坐标系，子元素 absolute 相对本容器定位 */
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  visibility: hidden;
  /* 关闭方向：延迟到抽屉滑出动画（.25s）结束后再隐藏，保留退出动画 */
  transition: visibility 0s linear 0.25s;
  z-index: 999;
}
.p-drawer-root--open {
  visibility: visible;
  /* 打开方向：立即可见（transition 取变化后样式，天然单向） */
  transition: visibility 0s linear 0s;
}
.p-drawer-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1;
}
.p-drawer {
  position: absolute;
  top: 0;
  bottom: 0;
  background: #ffffff;
  z-index: 2;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.15);
  transition: transform 0.25s ease;
  overflow-y: auto;
}
.p-drawer.left {
  left: 0;
  transform: translateX(-100%);
}
.p-drawer.right {
  right: 0;
  transform: translateX(100%);
}
.p-drawer.p-drawer-open {
  transform: translateX(0);
}
</style>

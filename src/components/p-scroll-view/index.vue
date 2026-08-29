<!-- src/components/p-scroll-view/index.vue —— 滚动容器（组件库 B3）
     矩阵 01 §4：Skyline 必备（页面滚动禁全局滚动）；scroll-x/y、scroll-top/left、refresher、lower-threshold
     性能约束（超大数量复用场景）：薄包装 —— 不引入组件层逻辑，事件透传，无节流/无状态 -->
<template>
  <scroll-view
    class="p-scroll-view"
    :scroll-x="scrollX"
    :scroll-y="scrollY"
    :scroll-top="scrollTop"
    :scroll-left="scrollLeft"
    :refresher-enabled="refresherEnabled"
    :lower-threshold="lowerThreshold"
    @scroll="onScroll"
    @scrolltolower="onScrollToLower"
    @refresherrefresh="onRefresherRefresh"
  >
    <slot />
  </scroll-view>
</template>

<script setup lang="ts">
defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  scrollX: { type: Boolean, default: false },
  scrollY: { type: Boolean, default: true },
  scrollTop: { type: Number, default: 0 },
  scrollLeft: { type: Number, default: 0 },
  refresherEnabled: { type: Boolean, default: false },
  lowerThreshold: { type: Number, default: 50 },
})

const emit = defineEmits(['scroll', 'scrolltolower', 'refresherrefresh'])

function onScroll(e: unknown) {
  emit('scroll', e)
}
function onScrollToLower(e: unknown) {
  emit('scrolltolower', e)
}
function onRefresherRefresh(e: unknown) {
  emit('refresherrefresh', e)
}
</script>

<style scoped>
/* Web 端 scroll-view 是自定义元素，需显式滚动；MP 端 scroll-y 属性原生滚动 */
.p-scroll-view {
  display: block;
  width: 100%;
  overflow: auto;
}
</style>

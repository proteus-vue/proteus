<!-- src/components/p-scrollable/index.vue —— 可滚动区域（★G-32 B4 ④ Gesture：gesture.scrollable G9）
     滚动容器 + bounce（弹性） + refresh（下拉刷新 emit）+ loadMore（触底加载 emit）
     Web 实现：overflow 滚动 + scroll 事件判定（refresher 下拉后续批次接入原生手势）
     双端同源码：div → view；MP/原生 refresh/bounce 由平台滚动组件承接 -->
<template>
  <div class="p-scrollable" :class="{ 'p-scrollable-bounce': bounce }" :style="scrollStyle" @scroll="onScroll">
    <slot />
    <div v-if="loadMore" class="p-scrollable-footer">
      {{ loading ? '加载中…' : '上拉加载更多' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 弹性滚动（iOS 橡皮筋） */
  bounce: { type: Boolean, default: false },
  /** 下拉刷新（语义声明——原生实现批次接入） */
  refresh: { type: Boolean, default: false },
  /** 触底加载更多 */
  loadMore: { type: Boolean, default: false },
  /** 加载中（footer 文案切换） */
  loading: { type: Boolean, default: false },
  /** 可视高度 px（0=继承/自适应） */
  height: { type: Number, default: 0 },
})

const emit = defineEmits(['load-more', 'refresh'])

function onScroll(e: Event): void {
  const el = e.target as HTMLElement
  if (!el) return
  // 触底 40px 内 → load-more
  if (props.loadMore && el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
    emit('load-more')
  }
}

const scrollStyle = computed(() => {
  const style: CSSProperties = {
    overflowY: 'auto',
  }
  if (props.height) {
    style.height = props.height + 'px'
  }
  if (props.refresh) {
    // 下拉刷新占位：顶部保留空间（原生实现批次接入真实手势）
    style.overscrollBehaviorY = 'contain'
  }
  if (props.bounce) {
    style.WebkitOverflowScrolling = 'touch'
  }
  return style as CSSProperties
})
</script>

<style scoped>
.p-scrollable {
  position: relative;
  -webkit-overflow-scrolling: touch;
}
.p-scrollable-bounce {
  overscroll-behavior-y: contain;
}
.p-scrollable-footer {
  padding: 12px;
  text-align: center;
  color: #969799;
  font-size: 13px;
}
</style>
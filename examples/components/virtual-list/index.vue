<!-- examples/components/virtual-list/index.vue —— 虚拟列表（v0.4）
     框架内置组件：长列表只渲染可视区（数据切片 + 占位），对标 Taro VirtualList / uni-app list-view
     双端同源码：<scroll-view> 模板 —— MP 原生滚动 + bindscroll；Web 自定义元素 + CSS overflow 滚动
     MVP：固定 item 模板（显示 item.title）；通用插槽渲染待编译器支持作用域插槽后 -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'

// as any 仅用于 defineProps 对象（不进产物，extractProps 只取 type 名）；
// ref 用非空初始值推导类型（空数组会推断 never[]，编译器不支持泛型标注）
const props = defineProps({
  items: { type: Array as any, default: () => [] },
  itemHeight: { type: Number, default: 44 },
  height: { type: Number, default: 400 },
})
const visible = ref([{ title: '' }])
const start = ref(0)

// 计算可视区切片：顶部占位高度 = start * itemHeight，渲染 [start, start + count)
function calc(scrollTop: number) {
  const s = Math.max(0, Math.floor(scrollTop / props.itemHeight))
  const c = Math.ceil(props.height / props.itemHeight) + 2 // 多渲染 2 行缓冲
  start.value = s
  visible.value = props.items.slice(s, s + c)
}

function onScroll(e: { detail: { scrollTop: number } }) {
  calc(e.detail.scrollTop)
}

// 首次渲染前计算首屏（scrollTop=0）
onMounted(() => {
  calc(0)
})
</script>

<template>
  <scroll-view class="vl" scroll-y :style="{ height: height + 'px' }" @scroll="onScroll">
    <view class="ph" :style="{ height: start * itemHeight + 'px' }" />
    <view v-for="(item, i) in visible" :key="i" class="row" :style="{ height: itemHeight + 'px' }">
      <text>{{ item.title }}</text>
    </view>
  </scroll-view>
</template>

<style scoped>
.vl {
  width: 100%;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}
/* Web 端：scroll-view 是自定义元素，需显式滚动（MP 端 scroll-y 属性原生滚动） */
scroll-view {
  display: block;
  overflow-y: auto;
}
.row {
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid #f3f4f6;
  font-size: 13px;
  color: #374151;
}
.ph {
  width: 100%;
}
</style>

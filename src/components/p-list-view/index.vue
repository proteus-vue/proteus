<!-- src/components/p-list-view/index.vue —— 虚拟长列表（组件库 B3，virtual-list 通用化）
     矩阵 01 §5：items / item-key / virtual / lazy-mount / buffer-size / item-size 预估
     高性能设计（超大数量复用场景）：
       - 只渲染可视窗口（数据切片 + 顶部占位），万级数据渲染行数恒定
       - scroll 守卫：窗口未跨行跳过 setData（intra-row 滚动零更新）
       - items 变化（分页/加载更多）→ watch(() => props.items) 重算窗口：
           Web = 标准 Vue watch（全响应式）；MP = 编译器 props 源 watch → WeChat observers
       - lazy：首屏不渲染，首次滚动才计算（列表在首屏外/多层嵌套时省首帧）
       - virtual=false：全量渲染（小列表省切片开销）
     ★注意：watch 回调必须花括号体（编译器仅支持 => { body }）；虚拟窗口必须搭配 scroll-view（Skyline 禁全局滚动） -->
<template>
  <scroll-view class="p-list-view" scroll-y :style="{ height: height + 'px' }" @scroll="onScroll">
    <view v-if="virtual" class="plv-ph" :style="{ height: start * itemHeight + 'px' }" />
    <template v-if="virtual">
      <view v-for="(item, i) in visible" :key="i" class="plv-row" :style="{ height: itemHeight + 'px' }">
        <text>{{ item.title }}</text>
      </view>
    </template>
    <view v-else v-for="(item, i) in items" :key="i" class="plv-row" :style="{ height: itemHeight + 'px' }">
      <text>{{ item.title }}</text>
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

const props = defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  items: { type: Array as any, default: () => [] },
  itemHeight: { type: Number, default: 44 },
  height: { type: Number, default: 400 },
  bufferSize: { type: Number, default: 2 }, // 可视区外缓冲行数（平滑滚动的提前量）
  virtual: { type: Boolean, default: true }, // 虚拟开关（false = 全量渲染，小列表省组件切片开销）
  lazy: { type: Boolean, default: false }, // 懒挂载：首屏不渲染，首次滚动才计算
})

const start = ref(0)
const visible = ref([{ title: '' }])
const ready = ref(false)

// 计算可视窗口（方法体内 props.x → this.data.x 改写 ✓）；lazy 模式下首次滚动（onScroll 置 ready）前不渲染
function calc() {
  if (props.lazy && !ready.value) return
  const c = Math.ceil(props.height / props.itemHeight) + props.bufferSize
  visible.value = props.items.slice(start.value, start.value + c)
}

function onScroll(e: { detail: { scrollTop: number } }) {
  if (props.lazy && !ready.value) {
    ready.value = true
    calc() // 懒挂载首帧：立即渲染首屏（即使窗口未跨行）
  }
  const s = Math.max(0, Math.floor(e.detail.scrollTop / props.itemHeight))
  // ★性能守卫：窗口未跨行 → 跳过 setData（intra-row 滚动零更新）
  if (s === start.value) return
  start.value = s
  calc()
}

// items 变化（分页/加载更多）→ 重算窗口：Web 标准 Vue watch；MP 编译器 props 源 watch → observers
watch(() => props.items, () => {
  calc()
})

onMounted(() => {
  calc() // 首帧（scrollTop=0）；lazy 模式被 calc 内守卫跳过
})
</script>

<style scoped>
.p-list-view {
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
.plv-row {
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid #f3f4f6;
  font-size: 13px;
  color: #374151;
}
.plv-ph {
  width: 100%;
}
</style>

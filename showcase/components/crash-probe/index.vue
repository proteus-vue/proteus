<!-- showcase/components/crash-probe/index.vue —— ★错误边界演示专用：可控崩溃的子组件
     用途：p-error-boundary 详情页需要「一个真的会在**渲染期**抛错的子组件」才能演示捕获路径
       （否则只能静态展示兜底 UI，「捕获」这件事本身无法被验证）。
     ★实现：render 期调用 probe()——crash=true 时抛错 → 由祖先的 onErrorCaptured 捕获 → 显示兜底。
       用**方法**而非 computed：方法每次渲染都执行（crash 变化即重新抛），
       且规避 MP 编译器「不支持块体 computed」的限制（见 p-grid/p-scale 的 #495c 注记）。 -->
<script setup lang="ts">
const props = defineProps({
  /** 置 true 即在渲染期抛错（模拟子树故障） */
  crash: { type: Boolean, default: false },
})

function probe(): string {
  if (props.crash) throw new Error('showcase: deliberate child crash')
  return '子树正常渲染中（点上方按钮触发崩溃）'
}
</script>

<template>
  <p-view class="crash-probe">
    <p-text class="crash-probe-text">{{ probe() }}</p-text>
  </p-view>
</template>

<style scoped>
.crash-probe { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.crash-probe-text { display: block; }
</style>

<!-- examples/pages/components-demo.vue —— 组件系统演示页（v0.3）
     父页面使用 <counter>：props 传递 / @change 事件 / usingComponents 由 gen-routes 自动注入 page.json -->
<route>
{
  "meta": {
    "title": "组件演示"
  }
}
</route>
<script setup lang="ts">
import { ref } from 'vue'
// Web 端注册组件（MP 端编译器忽略 import，标签走 usingComponents）
import Counter from '../components/counter/index.vue'
import Panel from '../components/panel/index.vue'

const total = ref(0)

// 类型提示全链路：事件处理器参数用 MpEvent<TDetail>（e.detail.value 推导；产物剥离标注）
function onChange(e: MpEvent<{ value?: number }>) {
  const val = e.detail.value
  total.value = val === undefined || val === null ? 0 : Number(val)
}
</script>

<template>
  <div class="components-demo">
    <h2>组件系统</h2>
    <p class="sub">父页面使用 &lt;counter&gt;（defineProps / emit → triggerEvent，usingComponents 自动注入）</p>
    <counter :initial="5" label="计数" @change="onChange" />
    <p>组件上报值：{{ total }}</p>

    <!-- 组件嵌套（v0.3 尾）：panel 组件内部使用 counter，component.json 自动注入 -->
    <panel title="嵌套面板" />
  </div>
</template>

<style scoped>
.components-demo {
  padding: 24px;
  text-align: center;
}
.sub {
  color: #888;
  font-size: 13px;
}
</style>

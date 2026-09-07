<!-- examples/components/panel/index.vue —— 组件嵌套演示（v0.3 尾）
     组件 A（panel）的模板使用组件 B（counter）→ panel 的 component.json
     usingComponents 自动注入（gen-routes writeComponentJsons） -->
<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ title: string }>()
const total = ref(0)

function onChange(e: { detail?: number }) {
  const val = e.detail
  total.value = val === undefined || val === null ? 0 : Number(val)
}
</script>

<template>
  <div class="panel">
    <text class="title">{{ title }}</text>
    <counter :initial="1" label="嵌套计数" @change="onChange" />
    <text class="total">子组件上报：{{ total }}</text>
  </div>
</template>

<style scoped>
.panel {
  padding: 12px;
  background: #f0fdf4;
  border-radius: 8px;
  margin: 8px 0;
  text-align: center;
}
.title {
  font-size: 14px;
  font-weight: 700;
  display: block;
  margin-bottom: 8px;
}
.total {
  display: block;
  font-size: 12px;
  color: #16a34a;
  margin-top: 8px;
}
</style>

<!-- examples/components/inject-consumer/index.vue —— provide/inject 注入消费者（vue-compat-advance Batch 3）
     const x = inject("key") → 编译为 attached() 读取 getApp().__proteusProvides 注册表 + setData（data.x 初始 undefined） -->
<script setup lang="ts">
import { ref, inject } from 'vue'

// 页面 provide → 组件 inject（深层嵌套组件同样生效：全局注册表桥）
const user = inject('demo-user')
// inject 默认值：未注册时取默认（编译为 ES5 三元：provides[k] === undefined ? def : provides[k]）
const greeting = inject('demo-greeting', '默认问候语')

// 模板显示注入值（ref 名称即 data 字段名）
const label = ref('inject 注入消费者')
</script>

<template>
  <view class="inject-consumer">
    <p class="label">{{ label }}</p>
    <p class="row">user：<text class="val">{{ user }}</text></p>
    <p class="row">greeting：<text class="val">{{ greeting }}</text></p>
  </view>
</template>

<style scoped>
.inject-consumer {
  margin: 16px auto;
  padding: 16px;
  border: 1rpx solid #e0e0e0;
  border-radius: 12rpx;
  background: #fafafa;
  text-align: left;
}
.label {
  font-weight: 600;
  margin-bottom: 8px;
}
.row {
  margin: 4px 0;
}
.val {
  color: #1a7af8;
}
</style>

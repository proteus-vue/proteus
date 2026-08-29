<!-- examples/pages/builtin-components-demo.vue —— 内置组件演示页（组件库 B2：p-view / p-text / p-image / p-button）
     双端验证：Web import 聚合 + MP usingComponents /proteus/<tag>/index 自动解析
     （components-demo.vue 保留给 v0.3 组件系统演示 counter/panel，本页专演示框架内置组件） -->
<route>
{
  "meta": {
    "title": "内置组件"
  }
}
</route>
<script setup lang="ts">
import { ref } from 'vue'
import { PView, PText, PImage, PButton } from '@proteus/components'

const clicks = ref(0)
const imgLoads = ref(0)
const imgErrors = ref(0)

function onTap() {
  clicks.value++
}
function onImgLoad() {
  imgLoads.value++
}
function onImgError() {
  imgErrors.value++
}
</script>

<template>
  <div class="cd">
    <h2>内置组件（B2）</h2>
    <p class="sub">p-view 容器 / p-text 文本 / p-button 防重复 / p-image 懒加载</p>

    <p-view class="box">
      <p-text class="row">p-view 容器 + p-text 文本（selectable）</p-text>
      <p-button :throttle="500" @click="onTap">防重复点击（500ms）</p-button>
      <p-text class="row">已点击：{{ clicks }} 次</p-text>
    </p-view>

    <p-image
      class="box"
      src="https://picsum.photos/600/200"
      alt="p-image 示例"
      mode="widthFix"
      :lazy-load="true"
      @load="onImgLoad"
      @error="onImgError"
    />
    <p-text class="row">图片加载 {{ imgLoads }} / 错误 {{ imgErrors }}</p-text>
  </div>
</template>

<style scoped>
.cd {
  padding: 24px;
}
.sub {
  color: #888;
  font-size: 13px;
  margin-bottom: 16px;
}
.box {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
.row {
  display: block;
  margin: 8px 0;
}
</style>

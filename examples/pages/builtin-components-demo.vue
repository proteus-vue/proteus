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
import { PView, PText, PImage, PButton, PScrollView, PListView, PInput, PTextarea, PPopup, PToast, PNavBar, PSkeleton } from '@proteus/components'

const clicks = ref(0)
const imgLoads = ref(0)
const imgErrors = ref(0)
const name = ref('')
const bio = ref('')
const showPopup = ref(false)
const showToast = ref(false)
const loading = ref(true)

// 万条数据：p-list-view 虚拟窗口只渲染可视区（行数恒定）
const rows = ref([] as { title: string }[])
for (let i = 0; i < 10000; i++) rows.value.push({ title: 'item ' + i })

function onTap() {
  clicks.value++
}
function onImgLoad() {
  imgLoads.value++
}
function onImgError() {
  imgErrors.value++
}
function onNameInput(e: { value: string }) {
  name.value = e.value
}
function onBioInput(e: { value: string }) {
  bio.value = e.value
}
function toggleLoading() {
  loading.value = !loading.value
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

    <h2>长列表（B3）</h2>
    <p class="sub">p-scroll-view 包裹 + p-list-view 虚拟窗口（10000 条，行数恒定）</p>
    <p-scroll-view class="box">
      <p-list-view :items="rows" :item-height="44" :height="320" />
    </p-scroll-view>

    <h2>表单（B4）</h2>
    <p class="sub">p-input / p-textarea（:value + @input，载荷 { value } 跨端归一）</p>
    <p-view class="box">
      <p-input :value="name" placeholder="姓名" @input="onNameInput" />
      <p-textarea :value="bio" placeholder="简介" @input="onBioInput" />
      <p-text class="row">name={{ name }} / bio={{ bio }}</p-text>
    </p-view>

    <h2>弹层（B5）</h2>
    <p class="sub">p-popup（转场动画）/ p-toast（自动关闭）/ p-loading / p-mask</p>
    <p-view class="box">
      <p-button @click="showPopup = true">打开弹层</p-button>
      <p-button @click="showToast = true">弹出提示（1.5s 自动关）</p-button>
    </p-view>
    <p-popup :visible="showPopup" position="bottom" @close="showPopup = false">
      <p-view class="pp-box">
        <p-text class="row">弹层内容（bottom + slide 转场）</p-text>
        <p-button @click="showPopup = false">关闭</p-button>
      </p-view>
    </p-popup>
    <p-toast :visible="showToast" text="操作成功" :duration="1500" @close="showToast = false" />

    <h2>导航/骨架（B6）</h2>
    <p class="sub">p-nav-bar（back 仅 emit，页面决定导航）+ p-skeleton（加载态）</p>
    <p-nav-bar title="页面标题" back @back="showToast = true" />
    <p-view class="box">
      <p-button @click="toggleLoading">{{ loading ? '结束加载' : '开始加载' }}</p-button>
      <p-skeleton :visible="loading" :avatar="true" />
      <p-text v-if="!loading" class="row">数据已加载</p-text>
    </p-view>
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
.pp-box {
  padding: 16px;
}
</style>

<!-- examples/pages/semantic-primitives-demo.vue —— G-32 完整语义原语演示（★G-32 B2：布局 12 + UI 18 + Shell 落地）
     p-前缀语义组件 Web 端演示：布局（inline/spacer/divider/scroll/masonry/virtual-list）+
     UI（heading/icon/switch/slider）+ Shell（nav/tabbar/drawer） —— Playground 可用 -->
<route>
  { "title": "G-32 语义原语" }
</route>
<template>
  <div class="page">
    <p-heading :level="1">G-32 语义原语演示</p-heading>
    <p-text class="desc">128 原语 SSOT 已冻结——本页演示 B2 落地的 13 个新组件</p-text>

    <section class="block">
      <p-heading :level="2">① 布局原语（Layout）</p-heading>
      <p-divider :inset="8" />
      <div class="row">
        <p-text class="label">p-inline（行内容器）：</p-text>
        <p-inline :gap="8">
          <span class="chip">A</span>
          <span class="chip">B</span>
          <span class="chip">C</span>
        </p-inline>
      </div>
      <div class="row">
        <p-text class="label">p-spacer（弹性空白）：</p-text>
        <div class="flex-row">
          <span class="chip">左</span>
          <p-spacer />
          <span class="chip">右</span>
        </div>
      </div>
      <div class="row">
        <p-text class="label">p-divider（分隔线）：</p-text>
        <p-divider />
      </div>
      <div class="row">
        <p-text class="label">p-scroll（滚动容器）：</p-text>
        <p-scroll class="scroll-box" axis="y">
          <div v-for="i in 12" :key="i" class="scroll-item">滚动项 {{ i }}</div>
        </p-scroll>
      </div>
      <div class="row">
        <p-text class="label">p-masonry（瀑布流）：</p-text>
        <p-masonry :col-count="3" :gap="8">
          <div v-for="(h, i) in heights" :key="i" class="masonry-item" :style="{ height: h + 'px' }">卡 {{ i + 1 }}</div>
        </p-masonry>
      </div>
      <div class="row">
        <p-text class="label">p-virtual-list（虚拟列表）：</p-text>
        <p-virtual-list :items="virtualItems" :item-height="36" :height="120" />
      </div>
    </section>

    <section class="block">
      <p-heading :level="2">② UI 原语（UI）</p-heading>
      <p-divider :inset="8" />
      <div class="row">
        <p-heading :level="3">标题（level 1-6）</p-heading>
      </div>
      <div class="row">
        <p-icon name="success" :size="20" color="#07c160" />
        <p-icon name="info" :size="20" color="#576b95" />
        <p-icon name="warn" :size="20" color="#fa5151" />
        <p-icon name="star" :size="20" color="#ffc300" />
        <p-icon name="search" :size="20" :spin="true" />
      </div>
      <div class="row">
        <p-text class="label">p-switch（开关）：</p-text>
        <p-switch v-model="switchOn" />
        <p-text class="hint">: {{ switchOn ? '开' : '关' }}</p-text>
      </div>
      <div class="row">
        <p-text class="label">p-slider（滑块）：</p-text>
        <p-slider v-model="sliderVal" :min="0" :max="100" :step="5" />
        <p-text class="hint">: {{ sliderVal }}</p-text>
      </div>
    </section>

    <section class="block">
      <p-heading :level="2">③ Shell 原语（Shell）</p-heading>
      <p-divider :inset="8" />
      <div class="row">
        <p-text class="label">p-nav（导航栏）：</p-text>
        <p-nav title="语义导航栏">
          <template #left>
            <p-icon name="back" :size="18" />
          </template>
          <template #right>
            <p-icon name="more" :size="18" />
          </template>
        </p-nav>
      </div>
      <div class="row">
        <p-text class="label">p-tabbar（底部标签）：</p-text>
        <p-tabbar v-model:active="tabActive" :tabs="tabs" />
      </div>
      <div class="row">
        <p-text class="label">p-drawer（侧滑抽屉）：</p-text>
        <p-button variant="primary" @click="drawerOpen = true">打开抽屉</p-button>
        <p-drawer v-model="drawerOpen" side="left" :width="240">
          <div class="drawer-inner">
            <p-heading :level="3">抽屉内容</p-heading>
            <p-text>从左侧滑出，点击遮罩关闭。</p-text>
          </div>
        </p-drawer>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  PHeading,
  PText,
  PIcon,
  PInline,
  PSpacer,
  PDivider,
  PScroll,
  PMasonry,
  PVirtualList,
  PSwitch,
  PSlider,
  PNav,
  PTabbar,
  PDrawer,
  PButton,
} from '@proteus-vue/components'

const switchOn = ref(false)
const sliderVal = ref(40)
const drawerOpen = ref(false)
const tabActive = ref('home')

const heights = [60, 90, 48, 76, 110, 66, 84, 52]
const virtualItems = Array.from({ length: 50 }, (_, i) => ({ title: '虚拟项 ' + (i + 1) }))
const tabs = [
  { key: 'home', label: '首页', icon: 'home' },
  { key: 'mine', label: '我的', icon: 'user' },
  { key: 'more', label: '更多', icon: 'more', badge: '3' },
]
</script>

<style scoped>
.page {
  padding: 16px;
}
.desc {
  color: #969799;
  margin: 8px 0 16px;
}
.block {
  margin-bottom: 20px;
  padding: 12px;
  background: #f7f8fa;
  border-radius: 8px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0;
  flex-wrap: wrap;
}
.label {
  min-width: 120px;
  color: #646566;
}
.hint {
  color: #07c160;
}
.chip {
  padding: 4px 10px;
  background: #fff;
  border: 1px solid #ebedf0;
  border-radius: 4px;
  font-size: 13px;
}
.flex-row {
  display: flex;
  align-items: center;
  flex: 1;
}
.scroll-box {
  height: 120px;
  border: 1px solid #ebedf0;
  border-radius: 6px;
  padding: 4px;
  flex: 1;
}
.scroll-item {
  padding: 8px;
  border-bottom: 1px solid #f2f3f5;
  font-size: 13px;
}
.masonry-item {
  background: #fff;
  border: 1px solid #ebedf0;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #646566;
}
.drawer-inner {
  padding: 16px;
}
</style>
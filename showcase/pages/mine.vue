<!-- showcase/pages/mine.vue —— 「我的」tab：项目信息 / 技术栈 / 快捷入口 -->
<script setup lang="ts">
import { PView, PText } from '@proteus-vue/components'
import { PSafe } from '@proteus-vue/components'
import { useAppConfig } from '@proteus-vue/app-config'
import BrandCube from '../components/brand-cube/index.vue'

const config = useAppConfig()
</script>

<template>
  <p-view class="mine">
    <p-safe area="top" :fallback="20" />
    <p-view class="profile">
      <brand-cube :size="48" />
      <p-view class="profile-main">
        <p-text class="profile-name">{{ config.app.name }}</p-text>
        <p-text class="profile-ver">v{{ config.app.version }} · {{ config.app.id }}</p-text>
      </p-view>
    </p-view>

    <p-text class="section-title">技术栈</p-text>
    <p-view class="grid">
      <p-view class="cell"><p-text class="cell-k">运行时</p-text><p-text class="cell-v">@proteus-vue/runtime</p-text></p-view>
      <p-view class="cell"><p-text class="cell-k">编译器</p-text><p-text class="cell-v">@proteus-vue/compiler</p-text></p-view>
      <p-view class="cell"><p-text class="cell-k">路由器</p-text><p-text class="cell-v">@proteus-vue/router</p-text></p-view>
      <p-view class="cell"><p-text class="cell-k">组件库</p-text><p-text class="cell-v">@proteus-vue/components</p-text></p-view>
    </p-view>

    <p-text class="section-title">关于</p-text>
    <a class="row" href="/pages/about">
      <p-text class="row-title">关于 Proteus</p-text>
      <p-text class="row-chev">›</p-text>
    </a>
  </p-view>
</template>

<style scoped>
.mine {
  min-height: 100vh;
  padding: var(--sp-4) var(--sp-4) calc(var(--sp-8) + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  background: var(--sp-bg);
}
.profile {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-4);
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-lg);
  padding: var(--sp-5) var(--sp-4);
  box-shadow: var(--sp-shadow-sm);
}
.profile-main { display: block; }
.profile-name {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: var(--sp-text);
}
.profile-ver {
  display: block;
  font-size: 12px;
  color: var(--sp-text-3);
  margin-top: 2px;
}
.section-title {
  display: block;
  font-size: 16px;
  font-weight: 700;
  margin: var(--sp-5) 0 var(--sp-3);
  color: var(--sp-text);
}
.grid { display: flex; flex-direction: row; flex-wrap: wrap; gap: var(--sp-2); }
.cell {
  width: calc(50% - var(--sp-1));
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-md);
  padding: var(--sp-3);
  box-sizing: border-box;
}
.cell-k {
  display: block;
  font-size: 12px;
  color: var(--sp-text-3);
}
.cell-v {
  display: block;
  font-size: 12px;
  font-family: var(--sp-mono);
  color: var(--sp-text);
  margin-top: 2px;
  word-break: break-all;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-md);
  padding: var(--sp-3) var(--sp-4);
  text-decoration: none;
  box-shadow: var(--sp-shadow-sm);
}
.row-title { font-size: 15px; font-weight: 600; color: var(--sp-text); }
.row-chev { color: var(--sp-text-3); font-size: 18px; }
</style>

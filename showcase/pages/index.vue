<!-- showcase/pages/index.vue —— 首页（能力总览 + 分区入口）
     设计：品牌立方体 + 一句话主张 + 框架数据 + 能力分区卡（点入二级页）。
     跨端：p-view/p-text 语义标签 → 小程序原生 / Web 模拟层；<a href> 编译为 wx.navigateTo。 -->
<script setup lang="ts">
import { ref } from 'vue'
import { PView, PText } from '@proteus-vue/components'
import { PSafe } from '@proteus-vue/components'
import BrandCube from '../components/brand-cube/index.vue'

const sections = ref([
  { to: '/pages/components', title: '组件库', desc: '79 个语义组件——布局 / 表单 / 反馈 / 外壳', tag: 'tab' },
  { to: '/pages/semantics', title: '语义与编译', desc: '一套 Vue 源码 → CompilerIR → 多端产物', tag: 'tab' },
  { to: '/pages/capabilities', title: '原生能力', desc: '相机 / 地图 / 扫码 / 分享 / 文件等能力 Hook', tag: 'tab' },
  { to: '/pages/system-glass', title: '液态玻璃', desc: 'G-07 玻璃拟态原语（真机/Web 双端）', tag: '' },
  { to: '/pages/system-fluid', title: '柔性布局', desc: 'G-22 自适应网格 / 断点分区 / 安全区', tag: '' },
  { to: '/pages/backends', title: '多渲染后端', desc: 'G-27 Vue DOM / 原生 / Flutter / Skia 可插拔', tag: '' },
  { to: '/pages/transitions', title: '转场动效', desc: 'Skyline worklet 转场 + Web Transition 同源', tag: '' },
  { to: '/pages/engineering-router', title: '工程化', desc: '路由 / 状态 / i18n / devtools 开箱即用', tag: '' },
  { to: '/pages/about', title: '关于 Proteus', desc: '定位、架构与设计原则', tag: '' },
])

const stats = ref([
  { n: '40', label: '@proteus-vue/* 包' },
  { n: '79', label: '语义组件' },
  { n: '81', label: '能力 Hook' },
  { n: '3052', label: '单测全绿' },
])
</script>

<template>
  <p-view class="home">
    <p-safe area="top" :fallback="20" />
    <p-view class="hero">
      <brand-cube :size="56" />
      <p-text class="hero-title">Proteus</p-text>
      <p-text class="hero-slogan">One semantic model. Any render engine.</p-text>
      <p-text class="hero-desc">一套语义内核，任意渲染引擎——渲染底座、编译器、宿主容器、执行载体全部可插拔。</p-text>
    </p-view>

    <p-view class="stats">
      <p-view v-for="s in stats" :key="s.label" class="stat">
        <p-text class="stat-n">{{ s.n }}</p-text>
        <p-text class="stat-l">{{ s.label }}</p-text>
      </p-view>
    </p-view>

    <p-text class="section-title">能力总览</p-text>
    <a v-for="sec in sections" :key="sec.to" class="row" :href="sec.to">
      <p-view class="row-main">
        <p-text class="row-title">{{ sec.title }}</p-text>
        <p-text class="row-desc">{{ sec.desc }}</p-text>
      </p-view>
      <p-text v-if="sec.tag" class="row-tag">{{ sec.tag }}</p-text>
      <p-text class="row-chev">›</p-text>
    </a>
  </p-view>
</template>

<style scoped>
.home {
  min-height: 100vh;
  padding: var(--sp-4) var(--sp-4) calc(var(--sp-8) + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  background: var(--sp-bg);
}
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--sp-6) 0 var(--sp-2);
}
.hero-title {
  display: block;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.5px;
  margin: var(--sp-3) 0 0;
  color: var(--sp-text);
}
.hero-slogan {
  display: block;
  font-size: 14px;
  color: var(--sp-brand-ink);
  font-weight: 600;
  margin: var(--sp-1) 0 0;
}
.hero-desc {
  display: block;
  font-size: 13px;
  color: var(--sp-text-2);
  line-height: 1.7;
  margin: var(--sp-3) 0 0;
  max-width: 320px;
}
.stats {
  display: flex;
  flex-direction: row;
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-lg);
  padding: var(--sp-3) 0;
  margin: var(--sp-5) 0 var(--sp-2);
  box-shadow: var(--sp-shadow-sm);
}
.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.stat-n {
  display: block;
  font-size: 18px;
  font-weight: 800;
  color: var(--sp-brand-ink);
}
.stat-l {
  display: block;
  font-size: 11px;
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
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-md);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-2);
  text-decoration: none;
  box-shadow: var(--sp-shadow-sm);
}
.row-main {
  flex: 1;
  min-width: 0;
  display: block;
}
.row-title {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: var(--sp-text);
}
.row-desc {
  display: block;
  font-size: 12px;
  color: var(--sp-text-3);
  margin-top: 2px;
}
.row-tag {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--sp-brand-ink);
  background: var(--sp-brand-soft);
  border-radius: var(--sp-radius-sm);
  padding: 1px 6px;
}
.row-chev {
  flex-shrink: 0;
  color: var(--sp-text-3);
  font-size: 18px;
}
</style>

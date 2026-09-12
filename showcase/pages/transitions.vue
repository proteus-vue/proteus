<!-- showcase/pages/transitions.vue —— 转场动效（真跳转触发 routeType 转场） -->
<script setup lang="ts">
import PageShell from '../components/page-shell/index.vue'
import { PText, PView } from '@proteus-vue/components'
</script>

<template>
  <page-shell title="转场动效" subtitle="Skyline worklet 转场 · 点下方链接真实触发">
    <p-text class="sec">点击体验不同转场（routeType 驱动）</p-text>
    <a class="row" href="/pages/system-glass" route-type="halfScreen">
      <p-view class="row-main">
        <p-text class="row-name">halfScreen · 半屏滑入</p-text>
        <p-text class="row-desc">遮罩可点关闭，前页保持不动</p-text>
      </p-view>
      <p-text class="chev">›</p-text>
    </a>
    <a class="row" href="/pages/system-fluid" route-type="slideUp">
      <p-view class="row-main">
        <p-text class="row-name">slideUp · 底部推入</p-text>
        <p-text class="row-desc">新页覆盖，旧页上移</p-text>
      </p-view>
      <p-text class="chev">›</p-text>
    </a>
    <a class="row" href="/pages/system-safe" route-type="scaleDown">
      <p-view class="row-main">
        <p-text class="row-name">scaleDown · 层叠缩放</p-text>
        <p-text class="row-desc">前页下沉缩放，新页滑入</p-text>
      </p-view>
      <p-text class="chev">›</p-text>
    </a>

    <p-text class="note">同一 routeType：小程序走 Skyline worklet（UI 线程），Web 走 Vue Transition——同一份声明、两端各自实现。</p-text>
  </page-shell>
</template>

<style scoped>
.sec { display: block; font-size: 14px; font-weight: 700; margin: var(--sp-2) 0 var(--sp-3); color: var(--sp-text); }
.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-3); background: var(--sp-surface); border: 1px solid var(--sp-line); border-radius: var(--sp-radius-md); padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-2); text-decoration: none; }
.row-main { flex: 1; min-width: 0; display: block; }
.row-name { display: block; font-size: 14px; font-weight: 600; color: var(--sp-text); }
.row-desc { display: block; font-size: 12px; color: var(--sp-text-3); margin-top: 2px; }
.chev { flex-shrink: 0; font-size: 18px; color: var(--sp-text-3); }
.note { display: block; font-size: 12px; color: var(--sp-text-3); line-height: 1.6; margin-top: var(--sp-3); }
</style>

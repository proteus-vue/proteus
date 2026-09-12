<!-- showcase/pages/system-safe.vue —— 安全区与自适应（真渲染 p-safe） -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../components/page-shell/index.vue'
import { PText, PView } from '@proteus-vue/components'
import PSafe from '@proteus-vue/components/p-safe/index.vue'

const fold = ref(true)
function toggleFold() { fold.value = !fold.value }
</script>

<template>
  <page-shell title="安全区与自适应" subtitle="p-safe · 状态栏 / Home 指示器避让">
    <p-text class="sec">p-safe（area=top，状态栏避让）</p-text>
    <p-view class="card">
      <psafe area="top" :fallback="20" />
      <p-text class="hint">↑ 顶部已避让状态栏（fallback=20px 兜底）</p-text>
    </p-view>

    <p-text class="sec">内容区（模拟页面主体）</p-text>
    <p-view class="card body">
      <p-text class="hint">主体内容</p-text>
    </p-view>
    <psafe area="bottom" :fallback="16" />
    <p-text class="hint">↑ 底部已避让 Home 指示器</p-text>
  </page-shell>
</template>

<style scoped>
.sec { display: block; font-size: 14px; font-weight: 700; margin: var(--sp-4) 0 var(--sp-2); color: var(--sp-text); }
.card { background: var(--sp-surface); border: 1px solid var(--sp-line); border-radius: var(--sp-radius-lg); padding: var(--sp-3); box-shadow: var(--sp-shadow-sm); }
.body { background: var(--sp-brand-soft); }
.hint { display: block; font-size: 12px; color: var(--sp-text-3); margin-top: var(--sp-1); }
</style>

<!-- showcase/pages/engineering-state.vue —— 状态管理（真 Pinia store 双向绑定） -->
<script setup lang="ts">
import PageShell from '../components/page-shell/index.vue'
import { PButton, PText, PView } from '@proteus-vue/components'
import { useCounterStore } from '../stores/counter'

// ★MP store 绑定（框架设计路径）：模板**直接引用 store.xxx** → 编译器生成
//   `this.setData({xxx}) + store.$subscribe(...setData)` 响应式桥（computed 包装会绕过它）。
const store = useCounterStore()
</script>

<template>
  <page-shell title="状态管理" subtitle="Pinia 多端适配 · 真 store 实例">
    <p-view class="card">
      <p-text class="big">{{ store.count }}</p-text>
      <p-view class="row">
        <p-button @click="store.inc()">+1</p-button>
        <p-button @click="store.dec()">-1</p-button>
        <p-button @click="store.reset()">重置</p-button>
      </p-view>
    </p-view>

    <p-view class="card">
      <p-view class="kv"><p-text class="k">double（getter）</p-text><p-text class="v">{{ store.double }}</p-text></p-view>
      <p-view class="kv"><p-text class="k">steps（getter）</p-text><p-text class="v">{{ store.steps }}</p-text></p-view>
      <p-view class="kv"><p-text class="k">history</p-text><p-text class="v">{{ store.history.join(', ') || '（空）' }}</p-text></p-view>
    </p-view>

    <p-text class="note">同一份 store 定义：Web 端 createWebPinia（LocalStorage 持久化），小程序端 createMpPinia（wx storage）。</p-text>
  </page-shell>
</template>

<style scoped>
.card { display: block; background: var(--sp-surface); border: 1px solid var(--sp-line); border-radius: var(--sp-radius-lg); padding: var(--sp-4); margin-bottom: var(--sp-3); box-shadow: var(--sp-shadow-sm); }
.big { display: block; font-size: 40px; font-weight: 800; color: var(--sp-brand-ink); text-align: center; margin-bottom: var(--sp-3); }
.row { display: flex; flex-direction: row; justify-content: center; gap: var(--sp-3); }
.kv { display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding: var(--sp-2) 0; border-bottom: 1px solid var(--sp-line-soft); }
.k { display: block; font-size: 13px; color: var(--sp-text-2); }
.v { display: block; font-size: 13px; font-family: var(--sp-mono); color: var(--sp-text); }
.note { display: block; font-size: 12px; color: var(--sp-text-3); line-height: 1.6; }
</style>

<!-- showcase/pages/engineering-i18n.vue —— 国际化（真 locale 切换） -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import PageShell from '../components/page-shell/index.vue'
import { PButton, PText, PView } from '@proteus-vue/components'
import { i18n } from '../i18n'

// ★MP 约束：把 i18n 结果经 computed 带进 data（locale 变化触发重算）
const locale = ref('zh-CN')
const hello = computed(() => i18n.t('hello') + ' · ' + locale.value)
const cart = computed(() => i18n.t('cart', { count: 3 }) + ' · ' + locale.value)
const apples = computed(() => i18n.t('appleMany', { count: 5 }) + ' · ' + locale.value)

function setLocale(l: string) {
  i18n.setLocale(l)
  locale.value = i18n.locale
}
</script>

<template>
  <page-shell title="国际化" subtitle="@proteus-vue/i18n · 切换 locale 全站响应">
    <p-view class="row">
      <p-button @click="setLocale('zh-CN')">中文</p-button>
      <p-button @click="setLocale('en-US')">English</p-button>
    </p-view>
    <p-view class="card">
      <p-view class="kv"><p-text class="k">hello</p-text><p-text class="v">{{ hello }}</p-text></p-view>
      <p-view class="kv"><p-text class="k">cart（插值）</p-text><p-text class="v">{{ cart }}</p-text></p-view>
      <p-view class="kv"><p-text class="k">appleMany（复数）</p-text><p-text class="v">{{ apples }}</p-text></p-view>
      <p-view class="kv"><p-text class="k">当前 locale</p-text><p-text class="v">{{ locale }}</p-text></p-view>
    </p-view>
    <p-text class="note">同一套词条：Web 与小程序共用；t() 类型安全 + ICU 子集（插值/复数）。</p-text>
  </page-shell>
</template>

<style scoped>
.row { display: flex; flex-direction: row; gap: var(--sp-3); margin-bottom: var(--sp-3); }
.card { display: block; background: var(--sp-surface); border: 1px solid var(--sp-line); border-radius: var(--sp-radius-lg); padding: var(--sp-4); box-shadow: var(--sp-shadow-sm); }
.kv { display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding: var(--sp-2) 0; border-bottom: 1px solid var(--sp-line-soft); }
.k { display: block; font-size: 13px; font-family: var(--sp-mono); color: var(--sp-text-2); }
.v { display: block; font-size: 13px; font-weight: 600; color: var(--sp-text); }
.note { display: block; font-size: 12px; color: var(--sp-text-3); line-height: 1.6; margin-top: var(--sp-3); }
</style>

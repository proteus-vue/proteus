<!-- examples/pages/i18n-demo.vue —— 国际化演示页（i18n-plan B3）
     双端验证：@proteus/i18n 共享模块（MP _proteus/i18n）+ locale 切换 + 复数/插值
     ★响应式说明：i18n 无内置响应式，页面持有 lang ref 触发重算（computed 依赖 lang.value 建立依赖） -->
<route>
{
  "meta": {
    "title": "国际化"
  }
}
</route>
<script setup lang="ts">
import { ref, computed } from 'vue'
import { i18n } from '../locales'

const lang = ref(i18n.locale)
const name = ref('Alex')
const count = ref(3)

// 翻译值派生：依赖 lang.value（locale 切换触发重算；slice(0,0) 建立依赖无副作用）
const greeting = computed(() => i18n.t('user.greeting', { name: name.value }) + lang.value.slice(0, 0))
const cartItems = computed(() => i18n.t('cart.items', { count: count.value }) + lang.value.slice(0, 0))
const dirLabel = computed(() => i18n.t('dir.label') + lang.value.slice(0, 0))
const dirNow = computed(() => i18n.dir() + lang.value.slice(0, 0))
const confirmLabel = computed(() => i18n.t('common.confirm') + lang.value.slice(0, 0))
const confirmed = ref(false)

function switchLocale(l: string) {
  i18n.setLocale(l)
  lang.value = i18n.locale
}
</script>

<template>
  <div class="id">
    <h2>国际化（i18n B1-B3）</h2>
    <p class="sub">@proteus/i18n：类型安全 t() + ICU 子集（插值/复数）</p>

    <div class="langs">
      <button @click="switchLocale('zhCN')">中文</button>
      <button @click="switchLocale('enUS')">English</button>
    </div>
    <p class="row">当前语言：{{ lang }} / {{ dirLabel }}：{{ dirNow }}</p>

    <p class="row">{{ greeting }}</p>

    <p class="row">{{ cartItems }}</p>
    <div class="langs">
      <button @click="count = Math.max(0, count - 1)">−</button>
      <span class="count">{{ count }}</span>
      <button @click="count++">＋</button>
    </div>

    <button class="row" @click="confirmed = true">{{ confirmLabel }}</button>
    <p v-if="confirmed" class="row">✅</p>
  </div>
</template>

<style scoped>
.id {
  padding: 24px;
}
.sub {
  color: #888;
  font-size: 13px;
  margin-bottom: 16px;
}
.langs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.row {
  margin: 8px 0;
}
.count {
  min-width: 32px;
  text-align: center;
}
</style>

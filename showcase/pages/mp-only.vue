<!-- showcase/pages/mp-only.vue —— 路由层平台门控演示（仅小程序）
     ★第 4 层：<route> platforms: ["mp"] → MP app.json 收录、Web 路由表不收录。
     写「需求」（本页仅小程序）而非在代码里判断平台。 -->
<route>
{ "path": "mp-only", "name": "mp-only", "meta": { "title": "仅小程序页" }, "platforms": ["mp"] }
</route>

<script setup lang="ts">
import PageShell from '../components/page-shell/index.vue'
import { PText } from '@proteus-vue/components'
</script>

<template>
  <page-shell title="仅小程序页" subtitle="路由层平台门控（platforms: ['mp']）">
    <p-text class="kv">本页仅在小程序构建中收录；Web 路由表不含此路由。</p-text>
    <p-text class="kv">声明写在 &lt;route&gt; 的 platforms，业务代码零平台判断。</p-text>
  </page-shell>
</template>

<style scoped>
.kv { display: block; font-size: 13px; color: var(--sp-text-2); margin-bottom: var(--sp-2); }
</style>

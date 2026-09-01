<!-- src/pages/index.vue —— 首页（TabBar 页面示例，覆盖核心映射：ref/v-if/v-for/:src/事件/ref 写入） -->
<script setup lang="ts">
import { ref } from 'vue'
// ★devtools 打通：SPA 导航走框架 router 单例（pushState + TraceBus 事件 → devtools route 回溯/守卫徽章）
import { router } from '../router'

const title = ref('Proteus')
const items = ref(['Web', 'Mini Program'])
const show = ref(true)
const count = ref(0)

function handleTap() {
  // Web 端：Vue 真实响应式更新；MP 端：编译器重写为 this.setData({ count: ... })
  count.value++
}

function go(name: 'forms' | 'config-demo') {
  router.push({ name })
}
</script>

<template>
  <div class="home">
    <h1>{{ title }}</h1>
    <p v-if="show">One Vue source. Every form.</p>
    <p class="tapped-count">tapped {{ count }} times</p>
    <div v-for="(item, idx) in items" :key="idx" class="item">{{ idx }}. {{ item }}</div>
    <button @click="handleTap">tap</button>
    <div class="links">
      <a class="link" href="/pages/forms">表单与指令11111</a>
      <a class="link" href="/pages/config-demo">配置演示</a>
      <a class="link" href="/pages/components-demo">组件演示</a>
      <a class="link" href="/pages/mp-semantics-demo">小程序语义（MP 组件/API）</a>
      <a class="link" href="/pages/platform-api-demo">PlatformAPI 收口</a>
      <a class="link" href="/pages/builtin-components-demo">内置组件</a>
      <a class="link" href="/pages/i18n-demo">国际化</a>
      <a class="link" href="/pages/provide-inject-demo">注入演示</a>
      <a class="link" href="/pages/virtual-list-demo">虚拟列表</a>
      <a class="link" href="/pages/pinia-demo">状态管理</a>
      <a class="link" href="/pages/user/index">用户中心</a>
      <a class="link" href="/pages/user/profile">个人资料</a>
      <a class="link" href="/subpackages/order/pages/list">订单列表</a>
    </div>
    <div class="router-links">
      <button class="link" @click="go('forms')">router.push → 表单与指令</button>
      <button class="link" @click="go('config-demo')">router.push → 配置演示</button>
    </div>
  </div>
</template>

<style scoped>
.home {
  text-align: center;
  padding: 48px 0;
}
.item {
  padding: 4px 0;
}
.links {
  margin-top: 24px;
}
.links .link {
  display: block;
  padding: 8px 0;
  color: #1a7af8;
}
</style>

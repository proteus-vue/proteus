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

function go(name: 'forms' | 'config-demo' | 'user') {
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
      <a class="link" href="/pages/forms">表单与指令</a>
      <a class="link" href="/pages/config-demo">配置演示</a>
      <a class="link" href="/pages/components-demo">组件演示</a>
      <a class="link" href="/pages/mp-semantics-demo">小程序语义（MP 组件/API）</a>
      <a class="link" href="/pages/platform-api-demo">PlatformAPI 收口</a>
      <a class="link" href="/pages/fluid-layout-demo">柔性布局（Fluid）</a>
      <a class="link" href="/pages/fluid-system-demo">Fluid System（折叠屏/车机）</a>
      <a class="link" href="/pages/semantic-primitives-demo">G-32 语义原语（B2）</a>
      <a class="link" href="/pages/render-backend-demo">渲染后端可插拔（G-27）</a>
      <a class="link" href="/pages/docs-engine-demo">文档引擎（md 编译渲染）</a>
      <a class="link" href="/pages/devtools-open-api-demo">开放 API 演示（第三方面板）</a>
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
    <!-- ★路由嵌套演示：嵌套链 首页 → 用户中心(user) → 个人资料(user-profile, parent: user)——
         连续点击后在 devtools route 视图查看两层嵌套导航记录（a 链接补发 + push 完整链路） -->
    <div class="nest-demo">
      <h3>路由嵌套演示</h3>
      <p class="nest-tip">嵌套链：首页 → 用户中心 → 个人资料（user-profile 的 parent 是 user）</p>
      <a class="link" href="/pages/user/index">① 进入用户中心（a 链接·嵌套入口）</a>
      <button class="link" @click="go('user')">② router.push → 用户中心（push 路径）</button>
      <p class="nest-tip">进入用户中心后点「个人资料」→ route 面板连续两条嵌套记录</p>
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
/* ★路由嵌套演示区块（route 面板回溯演示入口） */
.nest-demo {
  margin: 20px auto;
  max-width: 360px;
  padding: 12px 16px;
  border: 1px dashed #1a7af8;
  border-radius: 8px;
  text-align: center;
}
.nest-demo h3 {
  margin: 0 0 6px;
  font-size: 15px;
}
.nest-tip {
  margin: 4px 0;
  font-size: 12px;
  color: #888;
}
.nest-demo .link {
  display: block;
  padding: 6px 0;
  color: #1a7af8;
}
</style>

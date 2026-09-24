<!-- showcase/subpackages/capabilities/pages/navigation-guard.vue —— 能力详情页（useNavigationGuard，官方形态）
     ★由 scripts/gen-capability-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     范式同 camera.vue：能力说明 + 真交互演示 + API 表 + 双端兼容进度。
     ★真交互：按钮真调用能力 Hook，输出区回显 Result<T>（成功/失败 + 错误码）。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText, PView, PButton } from '@proteus-vue/components'
import { createCapabilityHooks } from '@proteus-vue/api'

// ★每页独立实例（demo 页惯例——不共享全局单例，页面间互不影响）
const cap = createCapabilityHooks()

// ★代码片段放 data（含 < > "。直写 :code 字面量会破坏 WXML 解析）
const codeDemo = ref("const g = useNavigationGuard()\nif (g.ok) {\n  await g.data.enable(\"有未保存的修改，确定离开？\")\n  /* 用户尝试离开页面时弹确认 */\n}")

const out = ref('点击「开启拦截」后，尝试关闭标签页/刷新会弹出浏览器原生确认框')
async function onEnable(): Promise<void> {
  const g = cap.useNavigationGuard()
  if (!g.ok) { out.value = `⚠ 降级：${g.error.code}`; return }
  const r = await g.data.enable('有未保存的修改，确定离开？')
  out.value = r.ok ? '✅ 已开启卸载拦截——现在尝试刷新/关闭标签页，浏览器会弹出确认' : `⚠ 降级：${r.error.code}`
}
async function onDisable(): Promise<void> {
  const g = cap.useNavigationGuard()
  if (!g.ok) { out.value = `⚠ 降级：${g.error.code}`; return }
  const r = await g.data.disable()
  out.value = r.ok ? '✅ 已关闭卸载拦截（可自由离开）' : `⚠ 降级：${r.error.code}`
}

const apiRows = ref([
  ["useNavigationGuard()", "导航拦截句柄（★同步返回 CapResult）", "CapResult<NavigationGuardAPI>"],
  ["enable(message)", "开启卸载前确认（message 为询问文案）", "Promise<CapResult<void>>"],
  ["disable()", "关闭卸载前确认", "Promise<CapResult<void>>"],
])
const compatRows = ref([
  ["Web SPA", "beforeunload（★真拦截——刷新/关标签页弹原生确认）", "✅"],
  ["微信小程序", "wx.enableAlertBeforeUnload（返回上一页时确认）", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useNavigationGuard 导航拦截" subtitle="能力原语 · capability.navigation-guard · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onEnable">开启拦截</p-button>
          <p-button size="small" @click="onDisable">关闭拦截</p-button>
        </p-view>
      </template>
      <template #output>
        <p-text class="out">{{ out }}</p-text>
      </template>
    </demo-block>

    <api-table title="API" :columns="['签名 / 字段', '说明', '类型']" :rows="apiRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.btns {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
  word-break: break-all;
}
.out-extra {
  margin-top: var(--sp-2);
  background: #f7f8fa;
  border-color: #e5e6eb;
  color: #4b5563;
  font-weight: 500;
}
</style>

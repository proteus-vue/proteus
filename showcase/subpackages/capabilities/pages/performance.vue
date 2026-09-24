<!-- showcase/subpackages/capabilities/pages/performance.vue —— 能力详情页（usePerformance，官方形态）
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
const codeDemo = ref("const h = usePerformance()\nif (h.ok) {\n  const list = await h.data.getEntries(\"navigation\")\n  /* list.data: PerformanceEntry[] */\n}")

const out = ref('点击按钮读取本页资源加载条目（真实 performance 数据）')
async function onEntries(): Promise<void> {
  const h = cap.usePerformance()
  if (!h.ok) {
    out.value = `⚠ 降级：${h.error.code}`
    return
  }
  // ★修正（类型检查暴露）：契约只接受 'navigation' | 'render' | 'script'
  //   （web 实现内部把这三者映射为浏览器侧的 'resource' —— 见 webBridge.webType）
  const entries = await h.data.getEntries('navigation')
  out.value = entries.ok
    ? `✅ navigation 条目 ${entries.data.length} 条 · 累计 ${entries.data.reduce((n, e) => n + (e.duration || 0), 0).toFixed(1)}ms`
    : `⚠ 降级：${entries.error.code}`
}

const apiRows = ref([
  ["usePerformance()", "性能句柄（★同步返回 CapResult）", "CapResult<PerformanceAPI>"],
  ["getEntries(entryType?)", "按类型读条目：navigation / render / script（缺省全部）", "Promise<CapResult<PerformanceEntry[]>>"],
  ["getEntriesByName(name, entryType?)", "按名字读条目", "Promise<CapResult<PerformanceEntry[]>>"],
  ["createObserver() / setBufferSize(n)", "实时观察新条目 / 缓冲区大小", "PerformanceObserverHandle / void"],
  ["report(id, value)", "自定义指标上报（★仅小程序有后端——Web 端恒 Err）", "Promise<CapResult<void>>"],
])
const compatRows = ref([
  ["Web SPA", "performance.getEntriesByType（★微信语义 navigation/render/script → Web 侧映射为 resource）", "✅"],
  ["微信小程序", "wx.getPerformance（含 report → 微信性能监控平台）", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="usePerformance 性能条目" subtitle="能力原语 · capability.performance · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onEntries">读取 navigation 条目</p-button>
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

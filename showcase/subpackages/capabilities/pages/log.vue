<!-- showcase/subpackages/capabilities/pages/log.vue —— 能力详情页（useLog，官方形态）
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
const codeDemo = ref("const logger = useLog()\nawait logger.log(\"user-action\", { id: 1 })\nawait logger.warn(\"slow-render\", { ms: 120 })\nawait logger.error(\"boom\", { code: 500 })")

const out = ref('点击按钮写一条日志（Web 落 console，小程序落 wx 日志上报）')
async function onLog(): Promise<void> {
  const logger = cap.useLog()
  const r = await logger.log('proteus-demo', { at: Date.now() })
  out.value = r.ok ? '✅ 日志已写入（请打开浏览器控制台查看 proteus-demo）' : `⚠ 降级：${r.error.code}`
}
async function onWarn(): Promise<void> {
  const logger = cap.useLog()
  const r = await logger.warn('proteus-demo-warn', { level: 'warn' })
  out.value = r.ok ? '✅ warn 级日志已写入（控制台可见）' : `⚠ 降级：${r.error.code}`
}

const apiRows = ref([
  ["useLog()", "日志器（★同步返回 Logger，非 CapResult）", "Logger"],
  ["log(message, data?)", "普通日志；返回 Promise<CapResult<void>>", "Promise<CapResult<void>>"],
  ["warn(message, data?)", "警告日志", "Promise<CapResult<void>>"],
  ["error(message, data?)", "错误日志（可触发上报）", "Promise<CapResult<void>>"],
])
const compatRows = ref([
  ["Web SPA", "console.log/warn/error（真写入，可在控制台核验）", "✅"],
  ["微信小程序", "wx 日志上报通道", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useLog 日志上报" subtitle="能力原语 · capability.log · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onLog">写 log</p-button>
          <p-button size="small" @click="onWarn">写 warn</p-button>
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

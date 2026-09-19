<!-- showcase/subpackages/capabilities/pages/clipboard.vue —— 能力详情页（useClipboard，官方形态）
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
const codeDemo = ref("const read = await useClipboard()\nconst write = await setClipboard(\"hello\")\nif (read.ok) { /* read.data: string */ }")

const out = ref('点击按钮读/写剪贴板（浏览器需用户手势 + 权限）')
async function onRead(): Promise<void> {
  const res = await cap.useClipboard()
  out.value = res.ok ? `✅ 读到：${res.data || '（空）'}` : `⚠ 降级：${res.error.code}`
}
async function onWrite(): Promise<void> {
  const res = await cap.setClipboard('Proteus showcase · ' + Date.now())
  out.value = res.ok ? '✅ 已写入剪贴板（可点「读取」验证往返）' : `⚠ 降级：${res.error.code}`
}

const apiRows = ref([
  ["useClipboard()", "读取剪贴板文本；返回 Promise<CapResult<string>>", "CapResult<string>"],
  ["setClipboard(text)", "写入剪贴板文本；返回 Promise<CapResult<void>>", "CapResult<void>"],
  ["data", "读到的文本（useClipboard 成功时）", "string"],
  ["error.code", "机器码：clipboard.unsupported（无 Clipboard API）等", "string"],
])
const compatRows = ref([
  ["Web SPA", "navigator.clipboard（需安全上下文 + 用户手势）", "✅"],
  ["微信小程序", "wx.getClipboardData / wx.setClipboardData", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useClipboard 剪贴板" subtitle="能力原语 · capability.clipboard · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view class="btns">
          <p-button size="small" @click="onRead">读取剪贴板</p-button>
          <p-button size="small" @click="onWrite">写入剪贴板</p-button>
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
</style>

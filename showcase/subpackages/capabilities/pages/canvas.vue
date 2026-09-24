<!-- showcase/subpackages/capabilities/pages/canvas.vue —— 能力详情页（useCanvas，官方形态）
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
const codeDemo = ref("const res = useCanvas(\"#demo-canvas\")\nif (res.ok) {\n  const ctx = res.data.createContext()   // 方法名对齐官方 CanvasContext\n  /* ctx.setFillStyle / fillRect / draw / toDataURL … */\n}")

const out = ref('点击按钮用 Canvas 控制器真画一个矩形，并导出 data URL')
function onDraw(): void {
  const res = cap.useCanvas('demo-canvas')
  if (!res.ok) { out.value = `⚠ 降级：${res.error.code}`; return }
  const c = res.data.createContext()
  if (!c.ok) { out.value = `⚠ 降级：${c.error.code}`; return }
  const ctx = c.data
  ctx.setFillStyle('#4f6bff')
  ctx.fillRect(8, 8, 60, 36)
  ctx.setFillStyle('#07c160')
  ctx.fillRect(76, 20, 40, 24)
  ctx.draw()
  out.value = '✅ 已绘制两个矩形（画布区域可见变化）'
}
async function onExport(): Promise<void> {
  const res = cap.useCanvas('demo-canvas')
  if (!res.ok) { out.value = `⚠ 降级：${res.error.code}`; return }
  const url = await res.data.toDataURL()
  out.value = url.ok ? `✅ 已导出 data URL（${String(url.data).slice(0, 40)}…，共 ${String(url.data).length} 字符）` : `⚠ 降级：${url.error.code}`
}

const apiRows = ref([
  ["useCanvas(id)", "画布控制器（★同步返回 CapResult；id 去 # 前缀）", "CapResult<CanvasController>"],
  ["createContext()", "旧版 2D 上下文（方法名对齐官方 CanvasContext）", "CapResult<CanvasContext>"],
  ["node()", "取画布节点（用于 rAF / 标准 getContext）", "Promise<CapResult<CanvasNode>>"],
  ["toTempFilePath(options?)", "导出临时文件路径（wx 原生；web 返回 data URL）", "Promise<CapResult<string>>"],
  ["toDataURL(options?)", "导出 data URL", "Promise<CapResult<string>>"],
])
const compatRows = ref([
  ["Web SPA", "HTMLCanvasElement（★真绘制 + 真导出）", "✅"],
  ["微信小程序", "wx.createCanvasContext / canvasToTempFilePath", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useCanvas 画布控制" subtitle="能力原语 · capability.canvas · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onDraw">绘制矩形</p-button>
          <p-button size="small" @click="onExport">导出 data URL</p-button>
        </p-view>
        <canvas id="demo-canvas" width="240" height="120" style="width:240px;height:120px;border:1px solid #e5e6eb;border-radius:8px"></canvas>
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

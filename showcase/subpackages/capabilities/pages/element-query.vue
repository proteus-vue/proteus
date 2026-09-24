<!-- showcase/subpackages/capabilities/pages/element-query.vue —— 能力详情页（useElement，官方形态）
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
const codeDemo = ref("const h = useElement(\"#demo-btns\")\nif (h.ok) {\n  const rect = await h.data.boundingClientRect()\n  /* rect.data: { left, top, width, height, … } */\n}")

const out = ref('点击按钮测量演示区按钮容器 #demo-btns 的真实几何')
async function onGeometry(): Promise<void> {
  const h = cap.useElement('#demo-btns')
  if (!h.ok) {
    out.value = `⚠ 降级：${h.error.code}`
    return
  }
  const rect = await h.data.boundingClientRect()
  out.value = rect.ok
    ? `✅ 几何：${Math.round(rect.data.width)}×${Math.round(rect.data.height)} @ (${Math.round(rect.data.left)}, ${Math.round(rect.data.top)})`
    : `⚠ 降级：${rect.error.code}`
}
async function onScroll(): Promise<void> {
  const h = cap.useElement('#demo-btns')
  if (!h.ok) {
    out.value = `⚠ 降级：${h.error.code}`
    return
  }
  const off = await h.data.scrollOffset()
  out.value = off.ok
    ? `✅ 滚动位置：top ${off.data.scrollTop} · left ${off.data.scrollLeft}`
    : `⚠ 降级：${off.error.code}`
}

const apiRows = ref([
  ["useElement(id?)", "元素查询句柄（★同步返回 CapResult）", "CapResult<ElementQuery>"],
  ["boundingClientRect(selector?)", "几何：left/top/right/bottom/width/height", "Promise<CapResult<ElementRect>>"],
  ["scrollOffset(selector?)", "滚动位置：scrollTop / scrollLeft", "Promise<CapResult<…>>"],
  ["size(selector?) / batch(selectors)", "尺寸（width/height）/ 批量查询", "Promise<CapResult<…>>"],
  ["fields(options, selector?)", "按需取 node / rect / size / scrollOffset / computedStyle", "Promise<CapResult<…>>"],
  ["error.code", "机器码：element.not-found（选择器未命中）/ element.unsupported", "string"],
])
const compatRows = ref([
  ["Web SPA", "querySelector + getBoundingClientRect（id 或类选择器均可）", "✅"],
  ["微信小程序", "wx.createSelectorQuery（★须用 id 选择器——类选择器不达页面级原生节点）+ 组件探针回落", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useElement 元素查询" subtitle="能力原语 · capability.element-query · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onGeometry">测量几何</p-button>
          <p-button size="small" @click="onScroll">读滚动位置</p-button>
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

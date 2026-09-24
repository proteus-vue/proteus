<!-- showcase/subpackages/capabilities/pages/intersection.vue —— 能力详情页（useIntersection，官方形态）
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
const codeDemo = ref("const h = useIntersection({ thresholds: [0] })\nif (h.ok) {\n  h.data.relativeToViewport().observe(\"#target\", (r) => {\n    /* r.intersectionRatio: 0–1 */\n  })\n}")

const out = ref('点击按钮观察 #demo-btns 与视口的相交状态')
let ih: { disconnect(): void } | null = null
function onObserve(): void {
  const h = cap.useIntersection({ thresholds: [0] })
  if (!h.ok) {
    out.value = `⚠ 降级：${h.error.code}`
    return
  }
  out.value = '⏳ 已开始观察 #demo-btns（相对视口）…'
  h.data.relativeToViewport().observe('#demo-btns', (r) => {
    out.value = `✅ 相交比例 ${(r.intersectionRatio * 100).toFixed(0)}% · 目标高 ${Math.round(r.boundingClientRect.height)}px`
  })
  ih = h.data
}
function onStop(): void {
  if (!ih) {
    out.value = '（尚未开始观察——请先点左侧按钮）'
    return
  }
  ih.disconnect()
  ih = null
  out.value = '✅ 已停止观察（disconnect 释放观察器）'
}

const apiRows = ref([
  ["useIntersection(options?)", "交叉观察句柄（★同步返回 CapResult）；options.thresholds / initialRatio / observeAll", "CapResult<IntersectionHandle>"],
  ["relativeToViewport(margins?)", "以视口为参照（margins 可扩展/收缩边界）", "IntersectionHandle"],
  ["relativeTo(selector, margins?)", "以指定元素为参照", "IntersectionHandle"],
  ["observe(targetSelector, cb)", "开始观察目标元素；结果含 intersectionRatio / boundingClientRect / relativeRect / time", "void"],
  ["disconnect()", "停止观察（释放）", "void"],
])
const compatRows = ref([
  ["Web SPA", "IntersectionObserver（★relativeTo 受限：浏览器要求 root 在构造期确定 → 当前以视口为参照）", "✅"],
  ["微信小程序", "wx.createIntersectionObserver（relativeTo 原生支持）", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useIntersection 交叉观察" subtitle="能力原语 · capability.intersection · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onObserve">观察 #demo-btns</p-button>
          <p-button size="small" @click="onStop">停止观察</p-button>
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

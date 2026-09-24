<!-- showcase/subpackages/capabilities/pages/media-query.vue —— 能力详情页（useMediaQuery，官方形态）
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
const codeDemo = ref("const h = useMediaQuery()\nif (h.ok) {\n  h.data.observe({ maxWidth: 500 }, (r) => {\n    /* r.matches: 当前是否命中 */\n  })\n  h.data.disconnect()   // 释放\n}")

const out = ref('点击按钮开始观察「视口 ≤ 500px」（回调会先以初始状态回调一次）')
let mqHandle: { disconnect(): void } | null = null
function onObserve(): void {
  const h = cap.useMediaQuery()
  if (!h.ok) {
    out.value = `⚠ 降级：${h.error.code}`
    return
  }
  h.data.observe({ maxWidth: 500 }, (r) => {
    out.value = r.matches ? '✅ 窄屏分支命中（视口 ≤ 500px）' : '✅ 宽屏分支命中（视口 > 500px）'
  })
  mqHandle = h.data
}
function onStop(): void {
  if (!mqHandle) {
    out.value = '（尚未开始观察——请先点左侧按钮）'
    return
  }
  mqHandle.disconnect()
  mqHandle = null
  out.value = '✅ 已停止观察（disconnect 释放监听）'
}

const apiRows = ref([
  ["useMediaQuery()", "媒体查询句柄（★同步返回 CapResult，非 Promise）", "CapResult<MediaQueryObserver>"],
  ["observe(condition, cb)", "开始观察；condition 支持 minWidth/maxWidth/width/minHeight/maxHeight/height/orientation（px）", "void"],
  ["disconnect()", "停止观察并释放监听", "void"],
  ["error.code", "机器码：element.unsupported（桥未提供 createMediaQuery）等", "string"],
])
const compatRows = ref([
  ["Web SPA", "matchMedia（回调首次即回传初始命中态；窗口尺寸变化自动推送）", "✅"],
  ["微信小程序", "wx.createMediaQueryObserver", "✅"],
  ["Headless（SSR/测试）", "mock 桥注入", "✅"],
  ["iOS / Android / 鸿蒙 / Flutter", "端原型映射·能力桥未接线（Err 显式降级）", "🟡"],
])
</script>

<template>
  <page-shell title="useMediaQuery 媒体查询" subtitle="能力原语 · capability.media-query · 双端同源码">
    <demo-block index="01" title="真交互演示" :has-output="true" desc="同一份源码、同一个 Result&lt;T&gt; 契约——按 res.ok 分支，无回调、无 try/catch 义务" :code="codeDemo">
      <template #demo>
        <p-view id="demo-btns" class="btns">
          <p-button size="small" @click="onObserve">观察 maxWidth:500</p-button>
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
.out-extra {
  margin-top: var(--sp-2);
  background: #f7f8fa;
  border-color: #e5e6eb;
  color: #4b5563;
  font-weight: 500;
}
</style>

<!-- showcase/subpackages/components/pages/p-scan-qr.vue —— p-scan-qr 扫码能力入口 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-scan-qr.md ← gen-content.mjs ← packages/components/p-scan-qr/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PScanQr, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- 成功 emit scan，失败 emit error（能力缺失是 error 路径，不是静默） -->\n<p-scan-qr label=\"扫一扫\" @scan=\"onScan\" @error=\"onScanError\" />",
})

const qrMsg = ref('点按钮触发扫码——Web 端能力不可用时会走显式降级（这正是要看的行为）')
function onScan(data: unknown): void {
  qrMsg.value = `✅ 扫码成功：${String(data)}`
}
function onScanError(msg: unknown): void {
  qrMsg.value = `⚠ 降级（error 事件）：${String(msg)}｜Web 端无标准扫码 API → 框架给显式错误码，不是「点了没反应」`
}

const apiRows = ref([
  [
    "label",
    "无障碍标签 / 默认按钮文案",
    "String"
  ],
  [
    "auto",
    "自动触发（挂载即扫；默认点击触发）",
    "Boolean"
  ]
])
const eventRows = ref([
  [
    "scan",
    "—",
    "r.data"
  ],
  [
    "error",
    "加载/执行失败",
    "'scan-failed')"
  ]
])
const slotRows = ref([
  [
    "default",
    "默认插槽（组件主内容）",
    "—"
  ]
])
const compatRows = ref([
  [
    "Web SPA",
    "✅",
    "vue-dom · 双端同源码编译目标（编译期映射 + 事件归一）"
  ],
  [
    "微信小程序",
    "✅",
    "skyline（WebView 降级） · Proteus 扩展组件——无小程序对应"
  ],
  [
    "Headless（SSR / 测试）",
    "✅",
    "headless · IR 渲染测试档（工具端）"
  ],
  [
    "iOS 原生",
    "🟡",
    "native-ios（UIKit） · 端原型映射——组件级接线未开始"
  ],
  [
    "Android 原生",
    "🟡",
    "native-android（Jetpack） · 端原型映射——组件级接线未开始"
  ],
  [
    "鸿蒙",
    "🟡",
    "native-harmony（ArkUI） · 端原型映射——组件级接线未开始"
  ],
  [
    "Flutter 混合",
    "🟡",
    "flutter · widget 级映射——组件级未验证"
  ],
  [
    "快应用",
    "⬜",
    "快应用引擎（待定） · 端未开始"
  ]
])
</script>

<template>
  <page-shell title="p-scan-qr 扫码能力入口" subtitle="能力入口 · capability.scan-qr · 双端同源码">
    <demo-block index="01" title="点击触发扫码（Web 端展示显式降级路径）" desc="★点按钮：Web 端 `webBridge` 无扫码实现 → 触发 **error 事件**并带机器码（真机小程序端走 `wx.scanCode` 成功路径）。★这个演示的意义正是「能力缺失时框架的行为必须可观测」" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-scan-qr class="cap-entry" label="扫一扫" @scan="onScan" @error="onScanError" />
      </template>
      <template #output>
        <p-text class="out">{{ qrMsg }}</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.cap-entry { background: #fff7ed; border-radius: var(--sp-radius-sm); padding: var(--sp-3); margin-bottom: var(--sp-2); }
</style>

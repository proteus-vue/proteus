<!-- showcase/subpackages/components/pages/p-pick-photo.vue —— p-pick-photo 选图能力入口 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-pick-photo.md ← gen-content.mjs ← packages/components/p-pick-photo/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PPickPhoto, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- 成功 emit pick（MediaFile[]），失败/取消 emit error -->\n<p-pick-photo label=\"选择图片\" @pick=\"onPick\" @error=\"onPickError\" />",
})

const pickMsg = ref('点按钮从本地选一张图片（Web 走系统文件选择器；取消 → 显式降级）')
function onPick(data: unknown): void {
  const files = Array.isArray(data) ? data : []
  const first = files[0] as { path?: string; size?: number } | undefined
  pickMsg.value = `✅ 已选 ${files.length} 张：${first?.path?.slice(0, 60) ?? ''}${first?.size ? ' · ' + Math.round(first.size / 1024) + 'KB' : ''}`
}
function onPickError(msg: unknown): void {
  pickMsg.value = `⚠ 降级（error 事件）：${String(msg)}`
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
    "pick",
    "—",
    "r.data"
  ],
  [
    "error",
    "加载/执行失败",
    "'pick-failed')"
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
  <page-shell title="p-pick-photo 选图能力入口" subtitle="能力入口 · capability.album · 双端同源码">
    <demo-block index="01" title="点击选图（Web 走 <input type=file>，取消/失败走 error）" desc="★点按钮打开系统文件选择器：选中 → pick 事件带文件信息；取消 → **error 事件**（显式，不是静默）。★Web 端能力真实可用（`getAlbum.pick` 已实现），小程序端走 `wx.chooseMedia`" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-pick-photo class="cap-entry" label="选择图片" @pick="onPick" @error="onPickError" />
      </template>
      <template #output>
        <p-text class="out">{{ pickMsg }}</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.cap-entry { background: #f2fbf5; border-radius: var(--sp-radius-sm); padding: var(--sp-3); margin-bottom: var(--sp-2); }
</style>

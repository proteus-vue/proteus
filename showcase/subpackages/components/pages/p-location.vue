<!-- showcase/subpackages/components/pages/p-location.vue —— p-location 定位能力入口 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-location.md ← gen-content.mjs ← packages/components/p-location/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PLocation, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- 声明式入口：点击触发 useLocation()；成功 emit locate，失败 emit error -->\n<p-location label=\"获取当前位置\" @locate=\"onLocate\" @error=\"onLocateError\" />",
})

const locMsg = ref('点按钮触发定位（浏览器会弹权限申请；拒绝 → 显式降级，不是静默失败）')
function onLocate(data: unknown): void {
  const c = data as { latitude?: number; longitude?: number; accuracy?: number }
  locMsg.value = `✅ 定位成功：纬度 ${c?.latitude?.toFixed(4)} · 经度 ${c?.longitude?.toFixed(4)} · 精度 ${c?.accuracy?.toFixed(0)}m`
}
function onLocateError(msg: unknown): void {
  locMsg.value = `⚠ 降级（error 事件）：${String(msg)}`
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
    "locate",
    "—",
    "r.data"
  ],
  [
    "error",
    "加载/执行失败",
    "'locate-failed')"
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
  <page-shell title="p-location 定位能力入口" subtitle="能力入口 · capability.location · 双端同源码">
    <demo-block index="01" title="点击触发定位（locate / error 双事件）" desc="★点按钮真调 `useLocation()`：允许授权 → locate 事件带经纬度；拒绝/不支持 → error 事件带机器码（**两条路径都是显式事件**，不会静默无反应）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-location class="cap-entry" label="获取当前位置" @locate="onLocate" @error="onLocateError" />
      </template>
      <template #output>
        <p-text class="out">{{ locMsg }}</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.cap-entry { background: #eef2ff; border-radius: var(--sp-radius-sm); padding: var(--sp-3); margin-bottom: var(--sp-2); }
</style>

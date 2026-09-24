<!-- showcase/subpackages/components/pages/p-animate.vue —— p-animate 动画声明 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-animate.md ← gen-content.mjs ← packages/components/p-animate/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PAnimate, PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  presets: "<!-- 预设动画名：fade / bounce / pulse / shake / zoom-in / spin -->\n<p-animate keyframes=\"pulse\" :duration=\"1200\" loop>\n  <p-text>循环脉冲</p-text>\n</p-animate>",
  delay: "<!-- delay 延迟 + duration 时长 + loop 开关 -->\n<p-animate keyframes=\"shake\" :duration=\"600\" :delay=\"300\" :loop=\"false\">…</p-animate>",
})

const apiRows = ref([
  [
    "keyframes",
    "动画预设名（fade/bounce/pulse/shake/zoom-in/spin）",
    "String"
  ],
  [
    "duration",
    "动画时长（ms）",
    "Number"
  ],
  [
    "loop",
    "循环播放（缺省 true——装饰动画；false 播一次）",
    "Boolean"
  ],
  [
    "delay",
    "延迟（ms）",
    "Number"
  ]
])
const eventRows = ref([])
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
    "skyline（WebView 降级） · 原生控件映射 → <keyframe-animation>（L1 原语）"
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
  <page-shell title="p-animate 动画声明" subtitle="工程 · animation CSS 语义面 · 双端同源码">
    <demo-block index="01" title="六个预设（fade / bounce / pulse / shake / spin / zoom-in）" desc="预设名 → 全局 @keyframes 类（p-animate-{name}）；★全部在动，用于直观对照" :has-output="false" :code="codes.presets">
      <template #demo>
        <p-view class="anim-row">
            <p-animate class="anim-cell" keyframes="fade"><p-text>fade</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="bounce"><p-text>bounce</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="pulse"><p-text>pulse</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="shake"><p-text>shake</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="spin"><p-text>spin</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="zoom-in"><p-text>zoom</p-text></p-animate>
          </p-view>
      </template>
    </demo-block>

    <demo-block index="02" title="时长与延迟（duration / delay / loop）" desc="duration 控制周期（ms），delay 延迟启动，loop=false 只播一次——★不 loop、不 delay 的脉冲会「动一下就停」" :has-output="true" :code="codes.delay">
      <template #demo>
        <p-view class="anim-row">
            <p-animate class="anim-cell" keyframes="pulse" :duration="600" loop><p-text>600ms</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="pulse" :duration="2000" loop><p-text>2000ms</p-text></p-animate>
            <p-animate class="anim-cell" keyframes="pulse" :duration="1200" :delay="800" loop><p-text>延迟 800</p-text></p-animate>
          </p-view>
      </template>
      <template #output>
        <p-text class="out">★动画走 CSS @keyframes（双端一致）：组件只声明语义，不写平台动画 API</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.anim-row { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.anim-cell { background: #eef2ff; border-radius: var(--sp-radius-sm); padding: var(--sp-3) var(--sp-2); text-align: center; min-width: 64px; }
</style>

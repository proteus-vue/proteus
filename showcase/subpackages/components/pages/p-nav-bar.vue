<!-- showcase/subpackages/components/pages/p-nav-bar.vue —— p-nav-bar 导航栏 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-nav-bar.md ← gen-content.mjs ← packages/components/p-nav-bar/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PNavBar, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  base: "<p-nav-bar title=\"页面标题\" />",
  back: "<p-nav-bar title=\"详情页\" back @back=\"onBack\" />",
  slots: "<p-nav-bar title=\"插槽\"><template #right><p-icon name=\"more\" /></template></p-nav-bar>",
  loading: "<p-nav-bar title=\"加载中\" loading />",
  color: "<p-nav-bar title=\"深色导航\" background-color=\"#1a1a1e\" front-color=\"#ffffff\" />",
})

const lastEvent = ref('（点击返回观察 back 事件）')
function onBack() {
  lastEvent.value = 'back 事件触发（页面决定导航，组件不直接调路由）'
}

const apiRows = ref([
  [
    "pid",
    "组件实例标识（调试/观测/测试定位用——D-2 dogfooding 契约）",
    "String"
  ],
  [
    "disabled",
    "禁用态（禁交互 + 弱化视觉；MP 原生 disabled 透传）",
    "Boolean"
  ],
  [
    "ariaLabel",
    "无障碍标签（读屏器朗读文本）",
    "String"
  ],
  [
    "title",
    "标题",
    "String"
  ],
  [
    "back",
    "是否显示返回按钮（仅 emit 事件，导航由页面自决——组件不直接调路由）",
    "Boolean"
  ],
  [
    "fixed",
    "是否固定定位（吸顶/吸底）",
    "Boolean"
  ],
  [
    "loading",
    "是否在标题区显示 loading 加载指示",
    "Boolean"
  ],
  [
    "frontColor",
    "导航条前景色（按钮/标题/状态栏），仅支持 #ffffff / #000000",
    "String"
  ],
  [
    "backgroundColor",
    "导航条背景色（十六进制）",
    "String"
  ],
  [
    "colorAnimationDuration",
    "改变导航栏颜色时的动画时长（ms，0 = 无动画）",
    "Number"
  ],
  [
    "colorAnimationTimingFunc",
    "换色动画方式：linear / easeIn / easeOut / easeInOut",
    "String"
  ]
])
const eventRows = ref([
  [
    "back",
    "点击返回按钮（导航由页面自决——组件不直接调路由）",
    "—"
  ]
])
const slotRows = ref([
  [
    "left",
    "具名插槽",
    "—"
  ],
  [
    "right",
    "具名插槽",
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
  <page-shell title="p-nav-bar 导航栏" subtitle="页面外壳 · 对齐官方 navigation-bar">
    <demo-block index="01" title="基础与返回" desc="title 标题；back 显示返回（仅 emit）" :has-output="true" :code="codes.back">
      <template #demo>
        <view class="col">
  <p-nav-bar title="基础标题" />
  <p-nav-bar title="详情页" back @back="onBack" />
</view>
      </template>
      <template #output>
        <p-text class="out">{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="右侧插槽" desc="left/right 插槽承载操作区" :has-output="false" :code="codes.slots">
      <template #demo>
        <p-nav-bar title="带操作">
  <template #right><p-text class="act">更多</p-text></template>
</p-nav-bar>
      </template>
    </demo-block>

    <demo-block index="03" title="loading 指示" desc="loading 在标题区显示加载指示（★官方 loading）" :has-output="false" :code="codes.loading">
      <template #demo>
        <p-nav-bar title="加载中" loading />
      </template>
    </demo-block>

    <demo-block index="04" title="配色（front-color / background-color）" desc="深色导航条；换色动画（★官方 front-color / background-color）" :has-output="false" :code="codes.color">
      <template #demo>
        <p-nav-bar title="深色导航" background-color="#1a1a1e" front-color="#ffffff" back />
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.col { display: flex; flex-direction: column; gap: var(--sp-3); }
.act { color: #1a7af8; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>

<!-- showcase/subpackages/components/pages/p-view.vue —— p-view 通用容器 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-view.md ← gen-content.mjs ← packages/components/p-view/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  base: "<p-view>内容</p-view>",
  hover: "<p-view hover-class=\"my-hover\" :hover-start-time=\"0\" :hover-stay-time=\"200\">按住我</p-view>",
  none: "<p-view hover-class=\"none\">按住无反馈</p-view>",
  disabled: "<p-view disabled>禁用</p-view>",
})

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
    "hoverClass",
    "按下样式类：缺省（''）→ 框架默认 p-view--hover；'none' → 关闭按压态；其它值 → 自定义类名（MP）",
    "String"
  ],
  [
    "hoverStopPropagation",
    "是否阻止祖先节点出现按压态",
    "Boolean"
  ],
  [
    "hoverStartTime",
    "按住多久出现按压态（ms）",
    "Number"
  ],
  [
    "hoverStayTime",
    "松开后按压态保留时间（ms）",
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
    "skyline（WebView 降级） · 原生控件映射 → <view>（L1 原语） · <cover-view>（L1 原语）"
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
  <page-shell title="p-view 通用容器" subtitle="布局基元 · 纵向 flex 容器 + 按压反馈">
    <demo-block index="01" title="基础容器" desc="display:flex 纵向；box-sizing 与双端对齐" :has-output="false" :code="codes.base">
      <template #demo>
        <p-view class="box"><p-text>普通容器内容</p-text></p-view>
      </template>
    </demo-block>

    <demo-block index="02" title="按压反馈（hover-*）" desc="官方 hover-class / hover-start-time / hover-stay-time：按住出现按压态" :has-output="true" :code="codes.hover">
      <template #demo>
        <p-view class="box box--hover" hover-class="demo-hover" :hover-start-time="0" :hover-stay-time="200">
  <p-text>按住我看反馈（松手 200ms 后消失）</p-text>
</p-view>
      </template>
      <template #output>
        <p-text class="out">MP：hover-class="demo-hover" 由平台在按下时加类；Web：模拟层等效反馈</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="关闭按压 / 禁用" desc="hover-class=none 无反馈；disabled 整体淡化" :has-output="false" :code="codes.none">
      <template #demo>
        <p-view class="col">
  <p-view class="box" hover-class="none"><p-text>hover-class=none（无按压态）</p-text></p-view>
  <p-view class="box" disabled><p-text>disabled 容器</p-text></p-view>
</p-view>
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
.box { padding: var(--sp-3); border: 1px solid var(--p-border, #e5e5e5); border-radius: var(--sp-radius-sm); background: #fff; }
.box--hover { border-style: dashed; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>

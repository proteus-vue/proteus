<!-- showcase/subpackages/components/pages/p-text.vue —— p-text 文本 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-text.md ← gen-content.mjs ← packages/components/p-text/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  base: "<p-text>普通文本</p-text>",
  select: "<p-text user-select>这段文本可以选中复制</p-text>",
  ellipsis: "<p-text overflow=\"ellipsis\" style=\"width:200px\">很长的文本会被裁剪为省略号…</p-text>",
  clamp: "<p-text :max-lines=\"2\" style=\"width:240px\">多行文本最多显示两行，超出部分被裁剪…</p-text>",
  space: "<p-text space=\"emsp\">用 emsp 显示连续空格</p-text>",
  gesture: "<p-text select-on-gesture>允许通过手势选择文本</p-text>",
})

const long = ref('这是一段足够长的示例文本，用于演示 overflow=ellipsis 与 max-lines 两种溢出处理方式的差异，请观察行尾表现。')

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
    "selectable",
    "文本是否可选（官方已废弃 → 兼容保留；新代码用 userSelect）",
    "Boolean"
  ],
  [
    "userSelect",
    "文本是否可选（官方 user-select；Web 用 CSS user-select，MP 用原生属性）",
    "Boolean"
  ],
  [
    "overflow",
    "文本溢出处理：ellipsis（省略号）/ clip（裁剪）",
    "String"
  ],
  [
    "maxLines",
    "限制文本最大行数（Web 用 -webkit-line-clamp 映射）",
    "Number"
  ],
  [
    "selectOnGesture",
    "是否允许通过手势选择文本",
    "Boolean"
  ],
  [
    "space",
    "显示连续空格：ensp / emsp / nbsp",
    "String"
  ],
  [
    "decode",
    "是否解码 &nbsp; 等实体",
    "Boolean"
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
    "skyline（WebView 降级） · 原生控件映射 → <text>（L1 原语） · <textarea>（L1 原语）"
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
  <page-shell title="p-text 文本" subtitle="内容基元 · 可选 / 溢出 / 空格处理">
    <demo-block index="01" title="可选文本（user-select）" desc="user-select 使文本可被选中复制（官方 user-select）" :has-output="false" :code="codes.select">
      <template #demo>
        <p-text class="para" user-select>这段文本可以被选中并复制（user-select）。</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="溢出处理" desc="overflow=ellipsis 单行省略号；max-lines 多行钳制" :has-output="false" :code="codes.ellipsis">
      <template #demo>
        <view class="col">
  <p-text class="clip1" overflow="ellipsis">{{ long }}</p-text>
  <p-text class="clip2" :max-lines="2">{{ long }}</p-text>
</view>
      </template>
    </demo-block>

    <demo-block index="03" title="连续空格与手势选择" desc="space=emsp/ensp/nbsp 显示连续空格；select-on-gesture 手势选择" :has-output="false" :code="codes.space">
      <template #demo>
        <view class="col">
  <p-text space="emsp">A   B（emsp 连续空格）</p-text>
  <p-text select-on-gesture>允许通过手势选择文本（select-on-gesture）</p-text>
</view>
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
.para { display: block; line-height: 1.6; }
.clip1 { display: block; width: 200px; }
.clip2 { display: block; width: 240px; line-height: 1.6; }
</style>

<!-- showcase/subpackages/components/pages/p-avatar.vue —— p-avatar 头像 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-avatar.md ← gen-content.mjs ← packages/components/p-avatar/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PAvatar, PStack, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  shapes: "<!-- 形状：circle 圆形 / square 圆角方形 -->\n<p-avatar src=\"/assets/avatar-demo.svg\" shape=\"circle\" :size=\"48\" fallback=\"P\" />\n<p-avatar shape=\"square\" :size=\"48\" fallback=\"方\" />",
  fallback: "<!-- 缺图/加载失败 → 显示 fallback 首字符 -->\n<p-avatar fallback=\"Proteus\" :size=\"48\" />\n<p-avatar src=\"/assets/not-exist.png\" fallback=\"兜底\" :size=\"48\" />",
})

const apiRows = ref([
  [
    "src",
    "头像图源",
    "String"
  ],
  [
    "shape",
    "形状：circle 圆形 / square 圆角方形",
    "String"
  ],
  [
    "size",
    "尺寸 px",
    "Number"
  ],
  [
    "fallback",
    "兜底文本（缺图/加载失败显示——首字符）",
    "String"
  ]
])
const eventRows = ref([])
const slotRows = ref([
  [
    "—",
    "无插槽",
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
  <page-shell title="p-avatar 头像" subtitle="UI 原语 · ui.avatar · 双端同源码">
    <demo-block index="01" title="形状与尺寸（shape / size）" desc="circle 圆形 / square 圆角方形（圆角 = size × 0.2）；size 控制边长" :has-output="false" :code="codes.shapes">
      <template #demo>
        <p-stack direction="row" :gap="10" align="center">
            <p-avatar src="/assets/avatar-demo.svg" shape="circle" :size="44" fallback="圆" />
            <p-avatar src="/assets/avatar-demo.svg" shape="square" :size="44" fallback="方" />
            <p-avatar shape="circle" :size="36" fallback="小" />
            <p-avatar shape="square" :size="56" fallback="大" />
          </p-stack>
      </template>
    </demo-block>

    <demo-block index="02" title="缺图兜底（fallback）" desc="★src 为空 **或图片加载失败** → 显示 fallback 首字符（此前加载失败分支未接模板 → 会显示破图；本批修复并加回归锁）" :has-output="true" :code="codes.fallback">
      <template #demo>
        <p-stack direction="row" :gap="10" align="center">
            <p-avatar :size="44" fallback="无图" />
            <p-avatar src="/assets/definitely-missing.png" :size="44" fallback="失败" />
          </p-stack>
      </template>
      <template #output>
        <p-text class="out">左：无 src → 直接兜底；右：图 404 → onError 置 broken → 兜底首字符（非破图）</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<!-- showcase/subpackages/components/pages/p-popover.vue —— p-popover 气泡浮层 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-popover.md ← gen-content.mjs ← packages/components/p-popover/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PPopover, PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- trigger 插槽 = 触发区；placement 定位；默认插槽 = 气泡内容 -->\n<p-popover v-model=\"open\" placement=\"bottom\">\n  <template #trigger><p-button size=\"small\">点我</p-button></template>\n  <p-text>气泡内容</p-text>\n</p-popover>",
})

const popoverVisible = ref(false)

const apiRows = ref([
  [
    "modelValue",
    "显隐（v-model）",
    "Boolean"
  ],
  [
    "trigger",
    "触发方式：click / hover / focus（hover/focus 批次接入——B4 薄壳 click）",
    "String"
  ],
  [
    "placement",
    "位置：top / bottom / left / right",
    "String"
  ]
])
const eventRows = ref([
  [
    "update:modelValue",
    "v-model 双向绑定：v-model 值变化时触发（同步父级绑定）",
    "false"
  ]
])
const slotRows = ref([
  [
    "trigger",
    "具名插槽",
    "—"
  ],
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
  <page-shell title="p-popover 气泡浮层" subtitle="页面外壳 · 锚定气泡 · 双端同源码">
    <demo-block index="01" title="触发区 + 四个方位（placement）" desc="★点触发区开合气泡；placement: bottom / top / left / right；点浮层外关闭（overlay 层）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-view class="btns">
            <p-popover v-model="popoverVisible" placement="bottom">
              <template #trigger><p-button size="small">底部气泡</p-button></template>
              <p-text>这是气泡内容（点外部关闭）</p-text>
            </p-popover>
          </p-view>
      </template>
      <template #output>
        <p-text class="out">★实现要点：用标准 `&lt;teleport to="body"&gt;` 逃逸页面层叠（编译器转 Skyline root-portal）——定位用 fixed+坐标，不依赖相对锚定</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.btns { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
</style>

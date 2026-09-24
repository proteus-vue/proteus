<!-- showcase/subpackages/components/pages/p-drawer.vue —— p-drawer 侧滑抽屉 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-drawer.md ← gen-content.mjs ← packages/components/p-drawer/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PDrawer, PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- v-model:open 受控；side: left / right；overlay 点遮罩关闭 -->\n<p-drawer v-model=\"open\" side=\"left\" :width=\"280\">\n  <p-text>抽屉内容</p-text>\n</p-drawer>",
})

const drawerLeft = ref(false)
const drawerRight = ref(false)

const apiRows = ref([
  [
    "modelValue",
    "展开状态（v-model:open）",
    "Boolean"
  ],
  [
    "side",
    "侧向：left / right",
    "String"
  ],
  [
    "width",
    "抽屉宽度 px",
    "Number"
  ],
  [
    "overlay",
    "遮罩（点击关闭）",
    "Boolean"
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
  <page-shell title="p-drawer 侧滑抽屉" subtitle="页面外壳 · 侧向抽屉 · 双端同源码">
    <demo-block index="01" title="左右两侧（side）+ 点遮罩关闭（overlay）" desc="★两个独立抽屉：左侧与右侧分别受控；width 控制展开宽度；overlay 开启时点遮罩 emit update:modelValue(false) 关闭" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-view class="btns">
            <p-button size="small" @click="drawerLeft = true">从左侧滑出</p-button>
            <p-button size="small" @click="drawerRight = true">从右侧滑出</p-button>
          </p-view>
          <p-drawer v-model="drawerLeft" side="left" :width="260">
            <p-text>左侧抽屉（点遮罩关闭）</p-text>
          </p-drawer>
          <p-drawer v-model="drawerRight" side="right" :width="260">
            <p-text>右侧抽屉（点遮罩关闭）</p-text>
          </p-drawer>
      </template>
      <template #output>
        <p-text class="out">★面板内点击用显式 noop 方法承载 .stop（MP 的 catchtap 无值形式不可编译——源码注释记录该约束）</p-text>
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

<!-- showcase/subpackages/components/pages/p-safe.vue —— p-safe 安全区避让 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-safe.md ← gen-content.mjs ← packages/components/p-safe/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PSafe, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  top: "<!-- 顶部安全区（刘海/状态栏/胶囊） -->\n<p-safe area=\"top\" :fallback=\"20\">\n  <p-text>内容避开顶部安全区</p-text>\n</p-safe>",
  bottom: "<!-- 底部安全区（Home Indicator） -->\n<p-safe area=\"bottom\" :fallback=\"12\">…</p-safe>",
})

const apiRows = ref([
  [
    "area",
    "避让方向：top / bottom / left / right / horizontal / all（默认 top）",
    "String"
  ],
  [
    "fold",
    "折叠屏 hinge 避让：display-mode fold/span 时左右避开折叠区域（默认关闭）",
    "Boolean"
  ],
  [
    "fallback",
    "兜底 px：桌面/无刘海屏 env()=0 时强制至少该值（max() 包裹；0 = 不兜底）",
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
  <page-shell title="p-safe 安全区避让" subtitle="布局原语 · Fluid System S2 · 双端同源码">
    <demo-block index="01" title="顶部安全区（area=&quot;top&quot; + fallback 兜底）" desc="★fallback 是无刘海/桌面环境下的**最小**内边距（max() 包裹）——没有它，env()=0 时该块会塌成 0 高（演示会「看不见」）" :has-output="false" :code="codes.top">
      <template #demo>
        <p-safe class="safe-box" area="top" :fallback="20">
            <p-text>内容避开顶部安全区（fallback 20px）</p-text>
          </p-safe>
      </template>
    </demo-block>

    <demo-block index="02" title="底部安全区（area=&quot;bottom&quot;）" desc="底部 Home Indicator 避让；★MP 端 env() 整条声明被丢弃 → 组件改走运行时读数（getWindowInfo + 胶囊下沿），真机同样生效" :has-output="true" :code="codes.bottom">
      <template #demo>
        <p-safe class="safe-box" area="bottom" :fallback="12">
            <p-text>内容避开底部安全区（fallback 12px）</p-text>
          </p-safe>
      </template>
      <template #output>
        <p-text class="out">★折叠屏 hinge 避让：:fold 开启后 display-mode=fold/span 时左右避开折叠区域（env(fold-*)，把系统能力搬进框架）</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.safe-box { background: #eef2ff; border: 1px solid #d6ddff; border-radius: var(--sp-radius-sm); }
</style>

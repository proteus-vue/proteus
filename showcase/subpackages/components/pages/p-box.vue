<!-- showcase/subpackages/components/pages/p-box.vue —— p-box 原子容器 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-box.md ← gen-content.mjs ← packages/components/p-box/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PBox, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  aspect: "<!-- 16:9 比例容器 -->\n<p-box aspect-ratio=\"16/9\">\n  <p-text>16:9</p-text>\n</p-box>",
  clip: "<!-- 裁剪溢出内容 -->\n<p-box overflow=\"hidden\">\n  <p-text>超长内容被裁剪</p-text>\n</p-box>",
})

const inBox = ref('内容自适应（未设比例）')

const apiRows = ref([
  [
    "---",
    "---",
    "---"
  ],
  [
    "aspectRatio",
    "宽高比（如 '16/9'；0/空 = 不设）——Skyline 无 aspect-ratio → 降级为不约束（内容撑高）",
    "String"
  ],
  [
    "overflow",
    "溢出：visible（默认）/ hidden（裁剪）",
    "String"
  ]
])
const eventRows = ref([])
const slotRows = ref([
  [
    "---",
    "---",
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
    "---",
    "---",
    "---"
  ],
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
  <page-shell title="p-box 原子容器" subtitle="布局原语 · layout.box · 双端同源码">
    <demo-block index="01" title="宽高比（aspectRatio）" desc="aspectRatio=&quot;16/9&quot; → 固定比例的盒子；★诚实边界：Skyline 无 aspect-ratio → 降级为不约束（内容撑高）" :has-output="false" :code="codes.aspect">
      <template #demo>
        <p-box class="box-aspect" aspect-ratio="16/9">
            <p-text>16 : 9</p-text>
          </p-box>
      </template>
    </demo-block>

    <demo-block index="02" title="溢出裁剪（overflow）" desc="overflow=&quot;hidden&quot; → 超出容器的内容被裁剪（★两端同语义）" :has-output="false" :code="codes.clip">
      <template #demo>
        <p-box class="box-clip" overflow="hidden">
            <p-text>{{ inBox }}</p-text>
          </p-box>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.box-aspect { background: #eef2ff; border: 1px solid #d6ddff; border-radius: var(--sp-radius-sm); align-items: center; justify-content: center; }
.box-clip { background: #fff7ed; border: 1px solid #fed7aa; border-radius: var(--sp-radius-sm); height: 44px; padding: var(--sp-2); }
</style>

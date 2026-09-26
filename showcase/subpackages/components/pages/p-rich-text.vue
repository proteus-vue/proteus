<!-- showcase/subpackages/components/pages/p-rich-text.vue —— p-rich-text 富文本 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-rich-text.md ← gen-content.mjs ← packages/components/p-rich-text/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PRichText, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  html: "<p-rich-text nodes=\"<p>HTML 字符串</p>\" />",
  nodes: "<p-rich-text :nodes=\"nodes\" />",
  space: "<p-rich-text :nodes=\"text\" space=\"nbsp\" user-select />",
})

// ★字面量必须直接内联进 ref()（编译器静态求值：标识符初值 → data 为 undefined，见 S33/S57）
const html = ref('<p style="margin:0 0 8px">这是<strong>富文本</strong>：支持 <em>斜体</em>、<span style="color:#7c5cff">着色</span>。</p><ul style="margin:0;padding-left:20px"><li>列表项 A</li><li>列表项 B</li></ul>')
// ★类型（2026-09-24 类型检查暴露）：nodes 的 type/children[].type 需为**字面量**联合
//   （p-rich-text 契约是 'text' | 'node'），as const 收窄，否则被推断为 string 而类型不符
const nodes = ref<Array<Record<string, unknown>>>([
  { type: 'node', name: 'h3', attrs: { style: 'margin:0 0 6px;font-size:15px' }, children: [{ type: 'text', text: '节点数组形态' }] },
  { type: 'node', name: 'p', attrs: { style: 'margin:0;color:#666' }, children: [{ type: 'text', text: 'structured nodes（官方 nodes 数组）' }] },
])
const spaces = ref('连续空格（默认压缩）:  1  2  3\n启用 space=nbsp:  1  2  3')

const apiRows = ref([
  [
    "nodes",
    "节点列表 / HTML 字符串（★官方 nodes）",
    "[String, Array] as unknown as () => string | RichTextNode[]"
  ],
  [
    "space",
    "显示连续空格：ensp / emsp / nbsp（★官方 space）",
    "String"
  ],
  [
    "userSelect",
    "文本是否可选（★官方 user-select；会使节点显示为 block）",
    "Boolean"
  ],
  [
    "mode",
    "布局兼容模式：default / compat（★官方 mode）",
    "String"
  ],
  [
    "source",
    "HTML 源（框架可读别名——等价 nodes 的字符串形态，二者取其一）",
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
    "skyline（WebView 降级） · 原生控件映射 → <rich-text>（L1 原语） · <editor>（L1 原语）"
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
  <page-shell title="p-rich-text 富文本" subtitle="内容基元 · HTML / 节点数组渲染">
    <demo-block index="01" title="HTML 字符串" desc="nodes 传入 HTML 字符串（MP 原生 rich-text / Web v-html）" :has-output="false" :code="codes.html">
      <template #demo>
        <view class="box"><p-rich-text :nodes="html" /></view>
      </template>
    </demo-block>

    <demo-block index="02" title="节点数组" desc="structured nodes（type/name/attrs/children）——跨端同数据结构" :has-output="false" :code="codes.nodes">
      <template #demo>
        <view class="box"><p-rich-text :nodes="nodes" /></view>
      </template>
    </demo-block>

    <demo-block index="03" title="空格与可选" desc="space 控制连续空格呈现；user-select 使文本可选中" :has-output="true" :code="codes.space">
      <template #demo>
        <view class="box">
  <p-rich-text :nodes="spaces" space="nbsp" user-select />
</view>
      </template>
      <template #output>
        <p-text class="out">space=nbsp 下连续空格保留；user-select 后可拖选文本</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.box { padding: var(--sp-3); border: 1px solid var(--p-border, #e5e5e5); border-radius: var(--sp-radius-sm); background: #fff; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>

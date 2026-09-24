<!-- showcase/subpackages/components/pages/p-split.vue —— p-split 自适应分栏 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-split.md ← gen-content.mjs ← packages/components/p-split/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PSplit, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  split: "<!-- 容器宽 ≥ minSplitWidth → 并排；窄于此 → 堆叠 -->\n<p-split :min-split-width=\"640\" :gap=\"12\">\n  <template #aside><p-text>侧栏</p-text></template>\n  <p-text>主区</p-text>\n</p-split>",
  always: "<!-- 小阈值（200）→ 在当前窄容器里也并排，便于观察两种形态 -->\n<p-split :min-split-width=\"200\" :gap=\"12\">…</p-split>",
})

const apiRows = ref([
  [
    "---",
    "---",
    "---"
  ],
  [
    "minSplitWidth",
    "容器宽度达到此值 → 并排分栏（px；窄于此 → 堆叠）",
    "Number"
  ],
  [
    "gap",
    "分栏/堆叠间距（px）",
    "Number"
  ],
  [
    "designWidth",
    "设计稿宽度（容器断点推导基准）",
    "Number"
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
    "aside",
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
  <page-shell title="p-split 自适应分栏" subtitle="布局原语 · Fluid System S1 · 平板/多窗口核心">
    <demo-block index="01" title="默认阈值 640 → 当前容器窄，堆叠" desc="★按**容器**宽度（非视口）求解：窄容器堆叠（column），达到阈值并排（row）" :has-output="false" :code="codes.split">
      <template #demo>
        <p-split class="split-box" :min-split-width="640" :gap="10">
            <template #aside><p-text class="side">侧栏（堆叠时在上）</p-text></template>
            <p-text class="main">主区内容</p-text>
          </p-split>
      </template>
    </demo-block>

    <demo-block index="02" title="小阈值 200 → 当前容器即并排" desc="把 minSplitWidth 降到 200，同一容器立即切到并排形态（对照上块）" :has-output="true" :code="codes.always">
      <template #demo>
        <p-split class="split-box" :min-split-width="200" :gap="10">
            <template #aside><p-text class="side">侧栏</p-text></template>
            <p-text class="main">主区（并排形态）</p-text>
          </p-split>
      </template>
      <template #output>
        <p-text class="out">★MP 端同样生效：Skyline 无 ResizeObserver → 走 SelectorQuery 运行时测量（容器响应式不再是 Web 专属）</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.split-box { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-bottom: var(--sp-2); }
.side { background: #dbeafe; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.main { background: #fff; border-radius: var(--sp-radius-sm); padding: var(--sp-3); flex: 1; }
</style>

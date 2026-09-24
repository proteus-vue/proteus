<!-- showcase/subpackages/components/pages/p-sidebar.vue —— p-sidebar 自适应导航栏 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-sidebar.md ← gen-content.mjs ← packages/components/p-sidebar/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PSidebar, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- 容器宽 ≥ minSidebarWidth → 常驻侧栏；窄于此 → 折叠（点「导航」展开） -->\n<p-sidebar :min-sidebar-width=\"640\" :nav-width=\"200\" toggle-label=\"导航\">\n  <template #nav><p-text>导航项</p-text></template>\n  <p-text>主内容</p-text>\n</p-sidebar>",
})

const apiRows = ref([
  [
    "minSidebarWidth",
    "容器宽度达到此值 → side-rail 侧栏；窄于此 → collapsed 折叠（px）",
    "Number"
  ],
  [
    "navWidth",
    "side-rail 模式导航栏宽度（px）",
    "Number"
  ],
  [
    "designWidth",
    "设计稿宽度（容器断点推导基准）",
    "Number"
  ],
  [
    "toggleLabel",
    "★collapsed 模式切换条文案（#384）",
    "String"
  ]
])
const eventRows = ref([])
const slotRows = ref([
  [
    "nav",
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
  <page-shell title="p-sidebar 自适应导航栏" subtitle="页面外壳 · 响应式侧栏 · 双端同源码">
    <demo-block index="01" title="响应式侧栏（窄容器 → 折叠态，点切换条展开）" desc="★按**容器宽度**求解：≥ minSidebarWidth 常驻侧栏（side-rail），窄于此折叠为切换条——★点「☰ 导航」展开抽屉式导航（真交互）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-sidebar class="sb-box" :min-sidebar-width="640" :nav-width="180" toggle-label="导航">
            <template #nav>
              <p-text class="sb-nav-item">概览</p-text>
              <p-text class="sb-nav-item">组件</p-text>
              <p-text class="sb-nav-item">能力</p-text>
            </template>
            <p-text>主内容区（侧栏随容器宽度自适应：宽则常驻，窄则折叠为切换条）</p-text>
          </p-sidebar>
      </template>
      <template #output>
        <p-text class="out">★与 p-split 同族：容器级响应式（Web 用容器查询运行时，MP 用 SelectorQuery 测量）——业务零媒体查询代码</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.sb-box { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.sb-nav-item { display: block; padding: 6px 8px; border-radius: var(--sp-radius-sm); background: #eef2ff; margin-bottom: 6px; }
</style>

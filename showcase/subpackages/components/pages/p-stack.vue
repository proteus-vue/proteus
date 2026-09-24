<!-- showcase/subpackages/components/pages/p-stack.vue —— p-stack 弹性栈 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-stack.md ← gen-content.mjs ← packages/components/p-stack/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PStack, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  column: "<!-- 纵向排列 + 间距 -->\n<p-stack direction=\"column\" :gap=\"8\">\n  <p-text>一</p-text>\n  <p-text>二</p-text>\n</p-stack>",
  row: "<!-- 横向 + 自动换行 -->\n<p-stack direction=\"row\" :gap=\"8\" wrap>\n  <p-text>一</p-text><p-text>二</p-text>\n</p-stack>",
  snap: "<!-- 轮播（一维排列 + 吸附）：swiper 的语义消灭形态 -->\n<p-stack direction=\"row\" :gap=\"8\" snap=\"mandatory\">\n  <p-text>卡片 1</p-text>\n  <p-text>卡片 2</p-text>\n</p-stack>",
})

const snapMode = ref('none')

const apiRows = ref([
  [
    "pid",
    "元素标识（框架扩展，用于调试/定位——真机探针/几何断言的稳定锚点；同 p-scroll-view 惯例）",
    "String"
  ],
  [
    "direction",
    "主轴方向：row（横向）/ column（纵向）",
    "String"
  ],
  [
    "wrap",
    "空间不足自动换行（仅 row）",
    "Boolean"
  ],
  [
    "gap",
    "子项间距（px）",
    "Number"
  ],
  [
    "align",
    "交叉轴对齐（flex 值；空串 = 不设置，保持 flex 默认 stretch）",
    "String"
  ],
  [
    "snap",
    "吸附：none / proximity / mandatory——非 none 时容器转滚动容器（轮播语义）",
    "String"
  ],
  [
    "loop",
    "循环：滚到末项后回环到首项（仅 snap 生效时有意义）",
    "Boolean"
  ]
])
const eventRows = ref([
  [
    "scroll",
    "滚动（eventScrollTop 归一：MP e.detail.scrollTop / Web e.target.scrollTop）",
    "payload"
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
    "skyline（WebView 降级） · 原生控件映射 → <view>（L1 原语） · <swiper>（L1 原语） · <swiper-item>（L1 原语）"
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
  <page-shell title="p-stack 弹性栈" subtitle="布局原语 · layout.stack · 双端同源码">
    <demo-block index="01" title="纵向排列 + 间距" desc="direction=&quot;column&quot;（默认）· gap 控制子项间距" :has-output="false" :code="codes.column">
      <template #demo>
        <p-stack :gap="8">
            <p-text class="chip">第一项</p-text>
            <p-text class="chip">第二项</p-text>
            <p-text class="chip">第三项</p-text>
          </p-stack>
      </template>
    </demo-block>

    <demo-block index="02" title="横向 + 自动换行" desc="direction=&quot;row&quot; + wrap → 空间不足自动换行" :has-output="false" :code="codes.row">
      <template #demo>
        <p-stack direction="row" :gap="8" wrap>
            <p-text class="chip">1</p-text>
            <p-text class="chip">2</p-text>
            <p-text class="chip">3</p-text>
            <p-text class="chip">4</p-text>
            <p-text class="chip">5</p-text>
            <p-text class="chip">6</p-text>
            <p-text class="chip">7</p-text>
            <p-text class="chip">8</p-text>
          </p-stack>
      </template>
    </demo-block>

    <demo-block index="03" title="吸附与循环（snap / loop）" desc="snap=&quot;mandatory&quot; → 容器转滚动容器 + CSS scroll-snap（轮播）。★诚实边界：MP 端 WXSS 无 scroll-snap → 降级为普通排列并给出可观察提示" :has-output="true" :code="codes.snap">
      <template #demo>
        <p-stack class="snap-demo" direction="row" :gap="8" snap="mandatory" :pid="'showcase-stack-snap'">
            <p-text class="card">卡片 1</p-text>
            <p-text class="card">卡片 2</p-text>
            <p-text class="card">卡片 3</p-text>
          </p-stack>
      </template>
      <template #output>
        <p-text class="out">横向拖动卡片区 → 松手吸附到最近卡片起点（Web）；小程序端为普通排列</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.chip { background: #eef2ff; border-radius: var(--sp-radius-sm); padding: 4px 8px; }
.card { min-width: 140px; background: #eef2ff; border-radius: var(--sp-radius-sm); padding: var(--sp-3); text-align: center; }
.snap-demo { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
</style>

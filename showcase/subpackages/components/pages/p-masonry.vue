<!-- showcase/subpackages/components/pages/p-masonry.vue —— p-masonry 瀑布流 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-masonry.md ← gen-content.mjs ← packages/components/p-masonry/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PMasonry, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- 列数 + 间距；子项自动避免跨列断开 -->\n<p-masonry :col-count=\"2\" :gap=\"12\">\n  <p-text>卡片 1</p-text>\n  <p-text>卡片 2</p-text>\n</p-masonry>",
})

const apiRows = ref([
  [
    "colCount",
    "列数（默认 2）",
    "Number"
  ],
  [
    "gap",
    "列与行间距 px",
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
  <page-shell title="p-masonry 瀑布流" subtitle="布局 · layout.masonry · 双端同源码">
    <demo-block index="01" title="两列瀑布流（colCount / gap）" desc="CSS columns 实现：子项高度不齐时自动错落填充（break-inside: avoid 防跨列断开）；★子项高度不同才看得出瀑布流效果" :has-output="false" :code="codes.basic">
      <template #demo>
        <p-masonry class="ms-box" :col-count="2" :gap="10">
            <p-text class="ms-item" style="height: 60px">卡片 1（矮）</p-text>
            <p-text class="ms-item" style="height: 96px">卡片 2（高）</p-text>
            <p-text class="ms-item" style="height: 72px">卡片 3（中）</p-text>
            <p-text class="ms-item" style="height: 88px">卡片 4（较高）</p-text>
            <p-text class="ms-item" style="height: 56px">卡片 5</p-text>
            <p-text class="ms-item" style="height: 80px">卡片 6</p-text>
          </p-masonry>
      </template>
    </demo-block>

    <demo-block index="02" title="三列（colCount=3）" desc="同一批内容换成三列——列数只声明，填充由引擎计算" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-masonry class="ms-box" :col-count="3" :gap="8">
            <p-text class="ms-item" style="height: 56px">1</p-text>
            <p-text class="ms-item" style="height: 80px">2</p-text>
            <p-text class="ms-item" style="height: 64px">3</p-text>
            <p-text class="ms-item" style="height: 72px">4</p-text>
            <p-text class="ms-item" style="height: 48px">5</p-text>
            <p-text class="ms-item" style="height: 88px">6</p-text>
          </p-masonry>
      </template>
      <template #output>
        <p-text class="out">★实现：CSS columns（Web 原生能力）+ --p-masonry-gap 间距 token——不做 JS 布局计算</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.ms-box { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.ms-item { display: block; background: #dbeafe; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-bottom: 0; }
</style>

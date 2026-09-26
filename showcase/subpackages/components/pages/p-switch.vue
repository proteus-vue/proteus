<!-- showcase/subpackages/components/pages/p-switch.vue —— p-switch 开关 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-switch.md ← gen-content.mjs ← packages/components/p-switch/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PSwitch, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<p-switch v-model=\"on\" @change=\"onChange\" />",
  disabled: "<p-switch :model-value=\"true\" disabled />",
  shapes: "<p-switch shape=\"round\" /><p-switch shape=\"square\" />",
  color: "<p-switch v-model=\"on\" color=\"#7c5cff\" />",
  loading: "<p-switch v-model=\"on\" loading />",
})

const on = ref(true)
const onDisabled = ref(false)
const onRound = ref(true)
const onSquare = ref(true)
const onColor = ref(true)
const onLoading = ref(true)
const lastEvent = ref('（暂无）')

// ★事件契约：change 载荷 { detail: { value } }（与 MP 原生 bind:change 一致）
// ★跨端读法：组件 emit 裸载荷 → Web 直接是载荷、MP 是 e.detail（`e?.detail ?? e` 通吃）
function onChange(e: unknown) {
  const p = e as { detail?: { value?: unknown }; value?: unknown }
  const v = Boolean((p?.detail ?? p)?.value)
  lastEvent.value = `change → ${v}`
}

const apiRows = ref([
  [
    "modelValue",
    "开关状态（受控 v-model；★官方 checked 经语义归一为 modelValue）",
    "Boolean"
  ],
  [
    "disabled",
    "是否禁用（★官方对齐）",
    "Boolean"
  ],
  [
    "shape",
    "★形态（替代官方 type）：round 圆角（默认）/ square 方角——都是开关，仅圆角不同。",
    "String"
  ],
  [
    "color",
    "打开态颜色（★官方对齐；缺省微信绿 #07c160）",
    "String"
  ],
  [
    "loading",
    "★框架扩展：加载中（禁切换 + 拇指内旋转指示器，与禁用态可分辨）",
    "Boolean"
  ]
])
const eventRows = ref([
  [
    "update:modelValue",
    "v-model 双向绑定：v-model 值变化时触发（同步父级绑定）",
    "next"
  ],
  [
    "change",
    "选中值变化",
    "{ value: next }"
  ]
])
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
    "skyline（WebView 降级） · 原生控件映射 → <switch>（L1 原语）"
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
  <page-shell title="p-switch 开关" subtitle="开关选择器 · 中性标签双端同源码">
    <demo-block index="01" title="基础用法（受控 v-model）" desc="v-model 受控；切换触发 change（载荷与 MP 原生一致）" :has-output="true" :code="codes.basic">
      <template #demo>
        <view class="row">
  <p-switch v-model="on" @change="onChange" />
</view>
      </template>
      <template #output>
        <p-text class="out">状态：{{ on ? '开' : '关' }} · 最后事件：{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="禁用态" desc="disabled 不可交互 + 整体淡化（★两端状态视觉统一；基础库 disabled opacity .3）" :has-output="false" :code="codes.disabled">
      <template #demo>
        <view class="row">
  <p-switch :model-value="false" disabled />
  <p-switch :model-value="true" disabled />
</view>
      </template>
    </demo-block>

    <demo-block index="03" title="形态（shape）" desc="round 圆角开关 / square 方角开关——★都是开关，仅圆角不同（不沿用官方 type=checkbox 的复选框形态：平台历史包袱，与 p-checkbox 语义重复）" :has-output="false" :code="codes.shapes">
      <template #demo>
        <view class="row">
  <p-switch v-model="onRound" shape="round" />
  <p-switch v-model="onSquare" shape="square" />
</view>
      </template>
    </demo-block>

    <demo-block index="04" title="自定义颜色" desc="color 设定打开态轨道色（★官方 color 属性；缺省微信绿）" :has-output="false" :code="codes.color">
      <template #demo>
        <view class="row">
  <p-switch v-model="onColor" color="#7c5cff" />
</view>
      </template>
    </demo-block>

    <demo-block index="05" title="加载态" desc="loading 期间禁切换 + 旋转指示器（★与禁用态可分辨；框架扩展，两端一致）" :has-output="false" :code="codes.loading">
      <template #demo>
        <view class="row">
  <p-switch v-model="onLoading" loading @change="onChange" />
</view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-4); flex-wrap: wrap; }
.out {
  display: block;
  background: #f2fbf5;
  border: 1px solid #d6f0e0;
  border-radius: var(--sp-radius-sm);
  padding: var(--sp-2) var(--sp-3);
  font-size: 12.5px;
  color: #2f7a4d;
  font-weight: 600;
}
</style>

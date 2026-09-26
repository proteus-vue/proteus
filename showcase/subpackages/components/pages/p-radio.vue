<!-- showcase/subpackages/components/pages/p-radio.vue —— p-radio 单选 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-radio.md ← gen-content.mjs ← packages/components/p-radio/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PRadio, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<p-radio v-model=\"plan\" value=\"x\">方案 X</p-radio>\n<p-radio v-model=\"plan\" value=\"y\">方案 Y</p-radio>",
  disabled: "<p-radio model-value=\"a\" value=\"a\" disabled>禁用（选中）</p-radio>",
  color: "<p-radio v-model=\"brand\" value=\"p\" color=\"#7c5cff\">品牌紫</p-radio>",
})

const plan = ref('x')
const brand = ref('p')
const lastEvent = ref('（暂无）')

// ★跨端读法：组件 emit 裸载荷 → Web 直接是载荷、MP 是 e.detail（`e?.detail ?? e` 通吃）
function onChange(e: unknown) {
  const p = e as { detail?: { value?: unknown }; value?: unknown }
  const d = (p?.detail ?? p) as { value?: unknown }
  lastEvent.value = `选中 ${d?.value}`
}

const apiRows = ref([
  [
    "value",
    "本项标识（★官方 value；选中时随 change 携带）",
    "[String, Number]"
  ],
  [
    "modelValue",
    "当前选中值（★v-model；官方 checked 经语义归一——组选中值由父级持有）",
    "[String, Number]"
  ],
  [
    "disabled",
    "是否禁用（★官方对齐）",
    "Boolean"
  ],
  [
    "color",
    "选中色（★官方 color；缺省微信绿 #07c160）",
    "String"
  ],
  [
    "name",
    "组名（框架扩展：同组 radio 共享 name，便于 change 区分组）",
    "String"
  ]
])
const eventRows = ref([
  [
    "update:modelValue",
    "v-model 双向绑定：v-model 值变化时触发（同步父级绑定）",
    "props.value"
  ],
  [
    "change",
    "选中值变化",
    "{ value: props.value, name: props.name }"
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
    "skyline（WebView 降级） · 原生控件映射 → <radio>（L1 原语）"
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
  <page-shell title="p-radio 单选" subtitle="单选框 · 自绘圆形双端一致">
    <demo-block index="01" title="基础用法（单选组）" desc="同组 radio 共享 v-model；value 为组内标识，选中即命中" :has-output="true" :code="codes.basic">
      <template #demo>
        <view class="row">
  <p-radio v-model="plan" value="x" name="plan" @change="onChange">方案 X</p-radio>
  <p-radio v-model="plan" value="y" name="plan" @change="onChange">方案 Y</p-radio>
</view>
      </template>
      <template #output>
        <p-text class="out">当前选中：{{ plan }} · 最后事件：{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="禁用态" desc="disabled 不可交互 + 淡化（★两端状态视觉统一）" :has-output="false" :code="codes.disabled">
      <template #demo>
        <view class="row">
  <p-radio :model-value="'a'" value="a" disabled>禁用（选中）</p-radio>
  <p-radio :model-value="'a'" value="b" disabled>禁用（未选）</p-radio>
</view>
      </template>
    </demo-block>

    <demo-block index="03" title="自定义颜色" desc="color 设定选中色（★官方 color 属性；缺省微信绿）" :has-output="false" :code="codes.color">
      <template #demo>
        <view class="row">
  <p-radio v-model="brand" value="p" color="#7c5cff">品牌紫</p-radio>
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

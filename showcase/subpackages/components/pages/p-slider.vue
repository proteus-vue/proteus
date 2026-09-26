<!-- showcase/subpackages/components/pages/p-slider.vue —— p-slider 滑块 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-slider.md ← gen-content.mjs ← packages/components/p-slider/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PSlider, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<p-slider v-model=\"val\" :min=\"0\" :max=\"100\" :step=\"1\" @change=\"onChange\" />",
  step: "<p-slider v-model=\"val10\" :min=\"0\" :max=\"100\" :step=\"10\" />",
  color: "<p-slider v-model=\"val\" active-color=\"#7c5cff\" color=\"#e5e5e5\" block-color=\"#7c5cff\" />",
  block: "<p-slider v-model=\"val\" :block-size=\"16\" block-color=\"#07c160\" />",
  showValue: "<p-slider v-model=\"val\" show-value />",
  disabled: "<p-slider :model-value=\"40\" disabled />",
})

const val = ref(40)
const val10 = ref(30)
const valColor = ref(60)
const valBlock = ref(50)
const lastEvent = ref('（暂无）')

// ★事件契约：change/changing 载荷 { value }（跨端读法 e?.detail ?? e）
function onChange(e: unknown) {
  const p = e as { detail?: { value?: unknown }; value?: unknown }
  const v = Number((p?.detail ?? p)?.value)
  if (Number.isFinite(v)) {
    lastEvent.value = `change → ${v}`
  }
}
function onChanging(e: unknown) {
  const p = e as { detail?: { value?: unknown }; value?: unknown }
  const v = Number((p?.detail ?? p)?.value)
  if (Number.isFinite(v)) {
    lastEvent.value = `changing → ${v}`
  }
}

const apiRows = ref([
  [
    "modelValue",
    "双向绑定值（v-model；MP 自定义组件 v-model 限制见 useInput 事件契约）",
    "Number"
  ],
  [
    "min",
    "最小值",
    "Number"
  ],
  [
    "max",
    "最大值",
    "Number"
  ],
  [
    "step",
    "步长",
    "Number"
  ],
  [
    "activeColor",
    "激活色（滑轨已选填充；官方 selected-color，Web/MP 均支持）",
    "String"
  ],
  [
    "color",
    "背景条（未选轨道）颜色（官方 color；官方已标记为 deprecated→backgroundColor）",
    "String"
  ],
  [
    "blockSize",
    "滑块大小 12–28（官方 block-size）",
    "Number"
  ],
  [
    "blockColor",
    "滑块颜色（官方 block-color）",
    "String"
  ],
  [
    "showValue",
    "是否在滑块旁显示当前值（官方 show-value）",
    "Boolean"
  ],
  [
    "disabled",
    "禁用",
    "Boolean"
  ]
])
const eventRows = ref([
  [
    "update:modelValue",
    "v-model 双向绑定：v-model 值变化时触发（同步父级绑定）",
    "Number.isFinite(v) ? v : props.modelValue"
  ],
  [
    "change",
    "选中值变化",
    "{ value: Number.isFinite(v) ? v : props.modelValue }"
  ],
  [
    "changing",
    "—",
    "{ value: Number.isFinite(v) ? v : props.modelValue }"
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
    "skyline（WebView 降级） · 原生控件映射 → <slider>（L1 原语）"
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
  <page-shell title="p-slider 滑块" subtitle="滑动输入 · 中性标签双端同源码">
    <demo-block index="01" title="基础用法（min/max/step + v-model）" desc="拖动改变取值；完成拖动触发 change" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-slider v-model="val" :min="0" :max="100" :step="1" @change="onChange" @changing="onChanging" />
      </template>
      <template #output>
        <p-text class="out">当前值：{{ val }} · 最后事件：{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="步长（step）" desc="step=10 → 取值按 10 递增（用于档位选择）" :has-output="true" :code="codes.step">
      <template #demo>
        <p-slider v-model="val10" :min="0" :max="100" :step="10" @change="onChange" />
      </template>
      <template #output>
        <p-text class="out">当前值：{{ val10 }}（档位 {{ val10 / 10 }} 级）</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="颜色（激活色 / 背景条 / 滑块）" desc="active-color 已选轨道 · color 未选背景条 · block-color 滑块（★官方三色属性）" :has-output="true" :code="codes.color">
      <template #demo>
        <p-slider v-model="valColor" active-color="#7c5cff" color="#e5e5e5" block-color="#7c5cff" />
      </template>
      <template #output>
        <p-text class="out">当前值：{{ valColor }}</p-text>
      </template>
    </demo-block>

    <demo-block index="04" title="滑块尺寸（block-size）" desc="block-size 12–28：小滑块适合精细调节（★官方 block-size）" :has-output="true" :code="codes.block">
      <template #demo>
        <p-slider v-model="valBlock" :block-size="16" block-color="#07c160" />
      </template>
      <template #output>
        <p-text class="out">当前值：{{ valBlock }}（滑块 16px）</p-text>
      </template>
    </demo-block>

    <demo-block index="05" title="显示当前值（show-value）" desc="show-value 在滑块旁显示数值（★官方 show-value）" :has-output="true" :code="codes.showValue">
      <template #demo>
        <p-slider v-model="val" show-value />
      </template>
      <template #output>
        <p-text class="out">当前值：{{ val }}</p-text>
      </template>
    </demo-block>

    <demo-block index="06" title="禁用态" desc="disabled 不可交互 + 整体淡化（★官方对齐）" :has-output="false" :code="codes.disabled">
      <template #demo>
        <p-slider :model-value="40" disabled show-value />
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
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

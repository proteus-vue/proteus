<!-- showcase/subpackages/components/pages/p-picker.vue —— p-picker 选择器 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-picker.md ← gen-content.mjs ← packages/components/p-picker/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PPicker, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<p-picker mode=\"selector\" :range=\"cities\" :value=\"idx\" @change=\"onChange\">\n  <p-text>{{ cities[idx] }}</p-text>\n</p-picker>",
  multi: "<p-picker mode=\"multiSelector\" :range=\"multi\" :value=\"multiIdx\" @change=\"onMultiChange\" />",
  disabled: "<p-picker mode=\"selector\" :range=\"cities\" disabled><p-text>禁用</p-text></p-picker>",
  header: "<p-picker mode=\"selector\" :range=\"cities\" header-text=\"选择城市\">…</p-picker>",
  buttons: "<p-picker mode=\"selector\" :range=\"cities\" button-mode=\"double\"><p-text>双按钮</p-text></p-picker>\n<p-picker mode=\"selector\" :range=\"cities\" :show-buttons=\"false\"><p-text>无按钮</p-text></p-picker>",
})

// 单列
const cities = ref(['北京', '上海', '广州', '深圳', '杭州'])
const idx = ref(0)
// 多列（各列静态数据；联动由开发者据 columnchange 改 range 驱动）
const multi = ref([
  ['2026', '2027', '2028'],
  ['01', '02', '03'],
])
const multiIdx = ref([0, 0])
const lastEvent = ref('（暂无）')
// ★模板内不可调用函数（WXML 表达式限制，S38）→ 用 computed 派生展示串
const multiIdxText = computed(() => multiIdx.value.join(', '))

function pick(e: unknown): { value?: unknown; column?: number } {
  const p = e as { detail?: { value?: unknown; column?: number }; value?: unknown; column?: number }
  return (p?.detail ?? p) as { value?: unknown; column?: number }
}
function onChange(e: unknown) {
  const v = pick(e).value
  if (typeof v === 'number') {
    idx.value = v
    lastEvent.value = `选中「${cities.value[v]}」（索引 ${v}）`
  } else if (Array.isArray(v)) {
    multiIdx.value = v as number[]
    lastEvent.value = `多列索引 [${(v as number[]).join(', ')}]`
  }
}
function onColumnChange(e: unknown) {
  const d = pick(e)
  lastEvent.value = `列 ${d.column} → 索引 ${d.value}`
}

const apiRows = ref([
  [
    "mode",
    "选择器类型：selector（单列）/ multiSelector（多列）——与原生 picker 一致",
    "String"
  ],
  [
    "range",
    "选项列表：selector 一维数组；multiSelector 二维数组（各列一个数组）",
    "Array"
  ],
  [
    "rangeKey",
    "range 元素为对象时的显示字段名（原生 range-key）",
    "String"
  ],
  [
    "value",
    "选中项索引：selector 为 number；multiSelector 为 number[]",
    "[Number, Array]"
  ],
  [
    "disabled",
    "是否禁用（★官方对齐）",
    "Boolean"
  ],
  [
    "headerText",
    "选择器标题（★官方 header-text；两端均映射为弹层标题）",
    "String"
  ],
  [
    "showButtons",
    "★是否显示底部按钮（默认 true）。false 时滚动即实时 emit change，关闭即结束（无需确认键）",
    "Boolean"
  ],
  [
    "buttonMode",
    "★底部按钮形态：single 单按钮「确定」（默认）/ double「取消 + 确定」",
    "String"
  ],
  [
    "indicatorStyle",
    "滚轮选中指示线样式（原生 picker-view indicator-style；缺省 48px 细线）",
    "String"
  ],
  [
    "indicatorClass",
    "滚轮指示线附加类名（原生 picker-view indicator-class）",
    "String"
  ],
  [
    "maskClass",
    "遮罩层附加类名（原生 picker-view mask-class）",
    "String"
  ],
  [
    "maskStyle",
    "遮罩层内联样式（原生 picker-view mask-style）",
    "String"
  ],
  [
    "immediateChange",
    "滚动即实时触发 change（原生 picker-view immediate-change；亦等价于 showButtons=false 的实时生效语义）",
    "Boolean"
  ]
])
const eventRows = ref([
  [
    "change",
    "选中值变化",
    "{ value: props.mode === 'multiSelector' ? d.slice() : d[0] }"
  ],
  [
    "cancel",
    "取消/关闭",
    "e"
  ],
  [
    "columnchange",
    "—",
    "{ column: i, value: next[i] }"
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
    "skyline（WebView 降级） · 原生控件映射 → <picker>（L1 原语） · <picker-view>（L1 原语）"
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
  <page-shell title="p-picker 选择器" subtitle="滚轮选择 · weui 标准双端一致">
    <demo-block index="01" title="单列选择（selector）" desc="range 一维数组；点击触发区打开滚轮（两端同款 weui 半屏弹层）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-picker mode="selector" :range="cities" :value="idx" header-text="选择城市" @change="onChange">
  <p-text class="field">{{ cities[idx] }}</p-text>
</p-picker>
      </template>
      <template #output>
        <p-text class="out">当前：{{ cities[idx] }} · 最后事件：{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="多列选择（multiSelector）" desc="range 二维数组（各列一个数组）；columnchange 用于联动改 range" :has-output="true" :code="codes.multi">
      <template #demo>
        <p-picker mode="multiSelector" :range="multi" :value="multiIdx" header-text="选择年月" @change="onChange" @columnchange="onColumnChange">
  <p-text class="field">{{ multi[0][multiIdx[0]] }} - {{ multi[1][multiIdx[1]] }}</p-text>
</p-picker>
      </template>
      <template #output>
        <p-text class="out">当前：[{{ multiIdxText }}] · 最后事件：{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="标题（header-text）" desc="★官方 header-text：两端均为弹层居中标题" :has-output="false" :code="codes.header">
      <template #demo>
        <p-picker mode="selector" :range="cities" :value="idx" header-text="选择城市">
  <p-text class="field">点击选择（标题：选择城市）</p-text>
</p-picker>
      </template>
    </demo-block>

    <demo-block index="04" title="禁用态" desc="disabled 不可交互 + 淡化（★官方对齐）" :has-output="false" :code="codes.disabled">
      <template #demo>
        <p-picker mode="selector" :range="cities" disabled>
  <p-text class="field">禁用（不可打开）</p-text>
</p-picker>
      </template>
    </demo-block>

    <demo-block index="05" title="底部按钮（可配置）" desc="★button-mode 控制单/双按钮；show-buttons=false 无底部按钮（滚动即实时生效，关闭即结束）" :has-output="false" :code="codes.buttons">
      <template #demo>
        <view class="picker-row">
  <p-picker mode="selector" :range="cities" header-text="双按钮" button-mode="double" @change="onChange">
    <p-text class="field">双按钮（取消 + 确定）</p-text>
  </p-picker>
  <p-picker mode="selector" :range="cities" header-text="无按钮" :show-buttons="false" @change="onChange">
    <p-text class="field">无底部按钮（滚动即生效）</p-text>
  </p-picker>
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
.picker-row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.field {
  display: block;
  min-height: 48px;
  line-height: 48px;
  padding: 0 16px;
  border: 1px solid #d1d1d1;
  border-radius: 4px;
  background: #fff;
  box-sizing: border-box;
  font-size: 17px;
  color: rgba(0, 0, 0, 0.9);
}
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

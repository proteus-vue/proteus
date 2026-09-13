<!-- showcase/subpackages/components/pages/p-slider.vue —— p-slider 组件演示（官方形态）
     覆盖：基础（min/max/step）/ 双向绑定 / 颜色（激活色+背景条+滑块色）/ 滑块尺寸 / 显示当前值 /
           禁用 / 事件契约（change 完成 vs changing 拖动中）。
     ★中性标签范式：模板写原生 <slider>，MP 走微信原生、Web 走 WebSlider（官方视觉对齐）。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PSlider, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: '<p-slider v-model="val" :min="0" :max="100" :step="1" @change="onChange" />',
  step: '<p-slider v-model="val10" :min="0" :max="100" :step="10" />',
  color: '<p-slider v-model="val" active-color="#7c5cff" color="#e5e5e5" block-color="#7c5cff" />',
  block: '<p-slider v-model="val" :block-size="16" block-color="#07c160" />',
  showValue: '<p-slider v-model="val" show-value />',
  disabled: '<p-slider :model-value="40" disabled />',
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
  ['modelValue', '当前取值（受控 v-model；★官方 value 语义归一）', 'number'],
  ['min', '最小值（★官方对齐）', 'number'],
  ['max', '最大值（★官方对齐）', 'number'],
  ['step', '步长，需 >0 且可被 (max-min) 整除（★官方对齐）', 'number'],
  ['activeColor', '已选轨道色（★官方 selected-color）', 'string'],
  ['color', '未选轨道（背景条）色（★官方 color，官方已标记弃用→backgroundColor）', 'string'],
  ['blockSize', '滑块大小 12–28（★官方 block-size）', 'number'],
  ['blockColor', '滑块颜色（★官方 block-color）', 'string'],
  ['showValue', '是否显示当前值（★官方 show-value）', 'boolean'],
  ['disabled', '是否禁用（★官方对齐）', 'boolean'],
])
const eventRows = ref([
  ['change', '完成一次拖动后触发（★载荷 { value }）', '{ value: number }'],
  ['changing', '拖动过程中触发（★载荷 { value }）', '{ value: number }'],
  ['update:modelValue', 'v-model 更新（受控回写）', 'number'],
])
const slotRows = ref([['—', 'p-slider 无插槽（原生 slider 语义）', '—']])
</script>

<template>
  <page-shell title="p-slider 滑块" subtitle="滑动输入 · 中性标签双端同源码">
    <demo-block index="01" title="基础用法（min/max/step + v-model）" :has-output="true" desc="拖动改变取值；完成拖动触发 change" :code="codes.basic">
      <template #demo>
        <p-slider v-model="val" :min="0" :max="100" :step="1" @change="onChange" @changing="onChanging" />
      </template>
      <template #output>
        <p-text class="out">当前值：{{ val }} · 最后事件：{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="步长（step）" :has-output="true" desc="step=10 → 取值按 10 递增（用于档位选择）" :code="codes.step">
      <template #demo>
        <p-slider v-model="val10" :min="0" :max="100" :step="10" @change="onChange" />
      </template>
      <template #output>
        <p-text class="out">当前值：{{ val10 }}（档位 {{ val10 / 10 }} 级）</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="颜色（激活色 / 背景条 / 滑块）" :has-output="true" desc="active-color 已选轨道 · color 未选背景条 · block-color 滑块（★官方三色属性）" :code="codes.color">
      <template #demo>
        <p-slider v-model="valColor" active-color="#7c5cff" color="#e5e5e5" block-color="#7c5cff" />
      </template>
      <template #output>
        <p-text class="out">当前值：{{ valColor }}</p-text>
      </template>
    </demo-block>

    <demo-block index="04" title="滑块尺寸（block-size）" :has-output="true" desc="block-size 12–28：小滑块适合精细调节（★官方 block-size）" :code="codes.block">
      <template #demo>
        <p-slider v-model="valBlock" :block-size="16" block-color="#07c160" />
      </template>
      <template #output>
        <p-text class="out">当前值：{{ valBlock }}（滑块 16px）</p-text>
      </template>
    </demo-block>

    <demo-block index="05" title="显示当前值（show-value）" :has-output="true" desc="show-value 在滑块旁显示数值（★官方 show-value）" :code="codes.showValue">
      <template #demo>
        <p-slider v-model="val" show-value />
      </template>
      <template #output>
        <p-text class="out">当前值：{{ val }}</p-text>
      </template>
    </demo-block>

    <demo-block index="06" title="禁用态" desc="disabled 不可交互 + 整体淡化（★官方对齐）" :code="codes.disabled">
      <template #demo>
        <p-slider :model-value="40" disabled show-value />
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
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

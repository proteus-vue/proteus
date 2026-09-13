<!-- showcase/subpackages/components/pages/p-switch.vue —— p-switch 组件演示（官方形态）
     覆盖：基础受控 / 禁用 / 样式类型（switch·checkbox）/ 自定义颜色 / 加载态 / 事件契约。
     ★中性标签范式：模板写原生 <switch>，MP 走微信原生、Web 走 WebSwitch（官方视觉对齐）。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PSwitch, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: '<p-switch v-model="on" @change="onChange" />',
  disabled: '<p-switch :model-value="true" disabled />',
  shapes: '<p-switch shape="round" /><p-switch shape="square" />',
  color: '<p-switch v-model="on" color="#7c5cff" />',
  loading: '<p-switch v-model="on" loading />',
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
  ['modelValue', '开关状态（受控 v-model；★官方 checked 语义归一）', 'boolean'],
  ['disabled', '是否禁用（★官方对齐）', 'boolean'],
  ['shape', '★形态：round 圆角（默认）/ square 方角——都是开关（不沿用官方 type=checkbox 平台包袱）', 'string'],
  ['color', '打开态颜色（★官方对齐；缺省微信绿 #07c160）', 'string'],
  ['loading', '★框架扩展：加载中（禁切换 + 弱化视觉）', 'boolean'],
])
const eventRows = ref([
  ['change', 'checked 改变时触发（★载荷 { detail: { value } }，与 MP 原生一致）', '{ detail: { value: boolean } }'],
  ['update:modelValue', 'v-model 更新（受控回写）', 'boolean'],
])
const slotRows = ref([['—', 'p-switch 无插槽（开关无内容）', '—']])
</script>

<template>
  <page-shell title="p-switch 开关" subtitle="开关选择器 · 中性标签双端同源码">
    <demo-block index="01" title="基础用法（受控 v-model）" :has-output="true" desc="v-model 受控；切换触发 change（载荷与 MP 原生一致）" :code="codes.basic">
      <template #demo>
        <view class="row">
          <p-switch v-model="on" @change="onChange" />
        </view>
      </template>
      <template #output>
        <p-text class="out">状态：{{ on ? '开' : '关' }} · 最后事件：{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="禁用态" desc="disabled 不可交互 + 整体淡化（★两端状态视觉统一；基础库 disabled opacity .3）" :code="codes.disabled">
      <template #demo>
        <view class="row">
          <p-switch :model-value="false" disabled />
          <p-switch :model-value="true" disabled />
        </view>
      </template>
    </demo-block>

    <demo-block index="03" title="形态（shape）" desc="round 圆角开关 / square 方角开关——★都是开关，仅圆角不同（不沿用官方 type=checkbox 的复选框形态：平台历史包袱，与 p-checkbox 语义重复）" :code="codes.shapes">
      <template #demo>
        <view class="row">
          <p-switch v-model="onRound" shape="round" />
          <p-switch v-model="onSquare" shape="square" />
        </view>
      </template>
    </demo-block>

    <demo-block index="04" title="自定义颜色" desc="color 设定打开态轨道色（★官方 color 属性；缺省微信绿）" :code="codes.color">
      <template #demo>
        <view class="row">
          <p-switch v-model="onColor" color="#7c5cff" />
        </view>
      </template>
    </demo-block>

    <demo-block index="05" title="加载态" desc="loading 期间禁切换 + 旋转指示器（★与禁用态可分辨；框架扩展，两端一致）" :code="codes.loading">
      <template #demo>
        <view class="row">
          <p-switch v-model="onLoading" loading @change="onChange" />
        </view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
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

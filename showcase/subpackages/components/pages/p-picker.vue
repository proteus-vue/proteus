<!-- showcase/subpackages/components/pages/p-picker.vue —— p-picker 组件演示（官方形态）
     覆盖：单列（selector）/ 多列（multiSelector）/ 禁用 / 标题 / 事件回显。
     ★两端同视觉：内容即触发区（slot）；Web 走 WebPicker、MP 自绘同一套 weui 半屏（原生 picker-view 滚轮）。 -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PPicker, PText } from '@proteus-vue/components'

const codes = ref({
  basic: '<p-picker mode="selector" :range="cities" :value="idx" @change="onChange">\n  <p-text>{{ cities[idx] }}</p-text>\n</p-picker>',
  multi: '<p-picker mode="multiSelector" :range="multi" :value="multiIdx" @change="onMultiChange" />',
  disabled: '<p-picker mode="selector" :range="cities" disabled><p-text>禁用</p-text></p-picker>',
  header: '<p-picker mode="selector" :range="cities" header-text="选择城市">…</p-picker>',
  buttons: '<p-picker mode="selector" :range="cities" button-mode="double"><p-text>双按钮</p-text></p-picker>\n<p-picker mode="selector" :range="cities" :show-buttons="false"><p-text>无按钮</p-text></p-picker>',
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
  ['mode', '选择器类型：selector（单列）/ multiSelector（多列）（与原生 picker 一致）', 'string'],
  ['range', '选项列表：selector 一维数组；multiSelector 二维数组', 'array'],
  ['rangeKey', 'range 元素为对象时的显示字段名（原生 range-key）', 'string'],
  ['value', '选中项索引：selector 为 number；multiSelector 为 number[]', 'number | number[]'],
  ['disabled', '是否禁用（★官方对齐）', 'boolean'],
  ['headerText', '选择器标题（★官方 header-text；两端均映射为弹层标题）', 'string'],
  ['showButtons', '★是否显示底部按钮（默认 true）。false = 无底部按钮：**滚动即实时生效**（change 随滚动触发），关闭（×/遮罩）即结束', 'boolean'],
  ['buttonMode', '★底部按钮形态：single 单按钮「确定」（默认）/ double 双按钮「取消 + 确定」', 'string'],
  ['indicatorStyle', '滚轮选中指示线样式（原生 picker-view indicator-style；缺省 48px 细线）', 'string'],
  ['indicatorClass', '滚轮指示线附加类名（原生 picker-view indicator-class）', 'string'],
  ['maskClass', '遮罩层附加类名（原生 picker-view mask-class）', 'string'],
  ['maskStyle', '遮罩层内联样式（原生 picker-view mask-style）', 'string'],
  ['immediateChange', '滚动即实时触发 change（原生 picker-view immediate-change）', 'boolean'],
])
const eventRows = ref([
  ['change', '确认选择（★裸载荷 { value }：索引或索引数组）', '{ value: number | number[] }'],
  ['columnchange', '多列滚动（★裸载荷 { column, value }；联动由开发者改 range）', '{ column: number, value: number }'],
  ['cancel', '取消选择（点击弹层关闭/遮罩）', 'event'],
])
const slotRows = ref([['default', '触发区内容（点击打开选择器）', '—']])
</script>

<template>
  <page-shell title="p-picker 选择器" subtitle="滚轮选择 · weui 标准双端一致">
    <demo-block index="01" title="单列选择（selector）" :has-output="true" desc="range 一维数组；点击触发区打开滚轮（两端同款 weui 半屏弹层）" :code="codes.basic">
      <template #demo>
        <p-picker mode="selector" :range="cities" :value="idx" header-text="选择城市" @change="onChange">
          <p-text class="field">{{ cities[idx] }}</p-text>
        </p-picker>
      </template>
      <template #output>
        <p-text class="out">当前：{{ cities[idx] }} · 最后事件：{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="多列选择（multiSelector）" :has-output="true" desc="range 二维数组（各列一个数组）；columnchange 用于联动改 range" :code="codes.multi">
      <template #demo>
        <p-picker mode="multiSelector" :range="multi" :value="multiIdx" header-text="选择年月" @change="onChange" @columnchange="onColumnChange">
          <p-text class="field">{{ multi[0][multiIdx[0]] }} - {{ multi[1][multiIdx[1]] }}</p-text>
        </p-picker>
      </template>
      <template #output>
        <p-text class="out">当前：[{{ multiIdxText }}] · 最后事件：{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="标题（header-text）" desc="★官方 header-text：两端均为弹层居中标题" :code="codes.header">
      <template #demo>
        <p-picker mode="selector" :range="cities" :value="idx" header-text="选择城市">
          <p-text class="field">点击选择（标题：选择城市）</p-text>
        </p-picker>
      </template>
    </demo-block>

    <demo-block index="04" title="禁用态" desc="disabled 不可交互 + 淡化（★官方对齐）" :code="codes.disabled">
      <template #demo>
        <p-picker mode="selector" :range="cities" disabled>
          <p-text class="field">禁用（不可打开）</p-text>
        </p-picker>
      </template>
    </demo-block>

    <demo-block index="05" title="底部按钮（可配置）" desc="★button-mode 控制单/双按钮；show-buttons=false 无底部按钮（滚动即实时生效，关闭即结束）" :code="codes.buttons">
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
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
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

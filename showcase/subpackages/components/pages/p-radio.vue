<!-- showcase/subpackages/components/pages/p-radio.vue —— p-radio 组件演示（官方形态）
     覆盖：基础单选组 / 禁用 / 自定义颜色 / 事件契约。
     ★语义归一：官方 `checked` → `modelValue`（v-model）；`value` 为组内标识。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PRadio, PText } from '@proteus-vue/components'

const codes = ref({
  basic: '<p-radio v-model="plan" value="x">方案 X</p-radio>\n<p-radio v-model="plan" value="y">方案 Y</p-radio>',
  disabled: '<p-radio model-value="a" value="a" disabled>禁用（选中）</p-radio>',
  color: '<p-radio v-model="brand" value="p" color="#7c5cff">品牌紫</p-radio>',
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
  ['modelValue', '当前选中值（★v-model；官方 checked 语义归一——组选中值由父级持有）', 'string | number'],
  ['value', '★官方：本项标识（选中时随 change 携带）', 'string | number'],
  ['disabled', '是否禁用（★官方对齐）', 'boolean'],
  ['color', '选中色（★官方对齐；缺省微信绿 #07c160）', 'string'],
  ['name', '★框架扩展：组名（便于 change 区分多个单选组）', 'string'],
])
const eventRows = ref([
  ['change', '选中变化（★载荷 { detail: { value, name } }）', '{ detail: { value, name } }'],
  ['update:modelValue', 'v-model 更新（受控回写）', 'string | number'],
])
const slotRows = ref([['default', '选项文字', '—']])
</script>

<template>
  <page-shell title="p-radio 单选" subtitle="单选框 · 自绘圆形双端一致">
    <demo-block index="01" title="基础用法（单选组）" :has-output="true" desc="同组 radio 共享 v-model；value 为组内标识，选中即命中" :code="codes.basic">
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

    <demo-block index="02" title="禁用态" desc="disabled 不可交互 + 淡化（★两端状态视觉统一）" :code="codes.disabled">
      <template #demo>
        <view class="row">
          <p-radio :model-value="'a'" value="a" disabled>禁用（选中）</p-radio>
          <p-radio :model-value="'a'" value="b" disabled>禁用（未选）</p-radio>
        </view>
      </template>
    </demo-block>

    <demo-block index="03" title="自定义颜色" desc="color 设定选中色（★官方 color 属性；缺省微信绿）" :code="codes.color">
      <template #demo>
        <view class="row">
          <p-radio v-model="brand" value="p" color="#7c5cff">品牌紫</p-radio>
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

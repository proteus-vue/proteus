<!-- showcase/subpackages/components/pages/p-checkbox.vue —— p-checkbox 组件演示（官方形态）
     覆盖：基础受控 / 半选 / 禁用 / 自定义颜色 / 群选（value 标识）。
     ★自绘「小方框 + 勾」（与官方 checkbox 形态一致，两端统一）。 -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PCheckbox, PText } from '@proteus-vue/components'

const codes = ref({
  basic: '<p-checkbox v-model="on" @change="onChange">同意协议</p-checkbox>',
  indeterminate: '<p-checkbox :model-value="false" :indeterminate="true">半选</p-checkbox>',
  disabled: '<p-checkbox :model-value="true" disabled>禁用（已选）</p-checkbox>',
  color: '<p-checkbox v-model="on" color="#7c5cff">品牌紫</p-checkbox>',
  group: '<p-checkbox v-for="f in fruits" :key="f.id" :value="f.id" :model-value="picked[f.id]" @change="onGroupChange">{{ f.name }}</p-checkbox>',
})

const on = ref(true)
const onColor = ref(true)
const lastEvent = ref('（暂无）')

// ★事件契约：change 载荷 { detail: { value: 选中态, name: 群选标识 } }
// ★跨端事件载荷读法（框架约定）：组件 emit 裸载荷 → Web 端 handler 直接收到载荷，
//   MP 端收到的事件对象 `e.detail` 才是载荷 → `e?.detail ?? e` 两端通吃。
function payload(e: unknown): { value?: unknown; name?: string } {
  const p = e as { detail?: { value?: unknown; name?: string } }
  return (p?.detail ?? p) as { value?: unknown; name?: string }
}
function onChange(e: unknown) {
  const d = payload(e)
  lastEvent.value = `${d?.name || '单个'} → ${d?.value}`
}

// 群选：value 作标识，选中态各自 v-model
const fruits = ref([
  { id: 'apple', name: '苹果' },
  { id: 'banana', name: '香蕉' },
  { id: 'cherry', name: '樱桃' },
])
// ★MP 约束：ref 不带类型实参（初值须可静态求值）；类型用「字面量 as 断言」（断言在字面量上，编译期剥离后仍是字面量）
// ★类型（2026-09-24 类型检查暴露）：模板用 picked[f.id] 索引 → 需索引签名，
//   否则 TS7053「不能用作索引类型」（此前页面不在类型检查范围内的漏网项）
const picked = ref<Record<string, boolean>>({ apple: true, banana: false, cherry: false })
const pickedCount = computed(() => Object.values(picked.value).filter(Boolean).length)
function onGroupChange(e: unknown) {
  // ★跨端读法：e?.detail ?? e（Web 直接收载荷、MP 收 e.detail）
  const raw = e as { detail?: { name?: string; value?: unknown }; name?: string; value?: unknown }
  const d = (raw?.detail ?? raw) as { name?: string; value?: unknown }
  // ★整体替换写法：ref 无类型实参、初值可静态求值；拼新对象 → 编译器走 setData 路径。
  //   （ref 对象「嵌套字段写」亦受框架支持，见 registry 的 script/ref-nested-write；
  //    注释内不写具体代码形态，避免被编译器规则误匹配。）
  if (d?.name) picked.value = { ...picked.value, [d.name]: Boolean(d.value) }
}

const apiRows = ref([
  ['modelValue', '选中态（受控 v-model；★官方 checked 语义归一）', 'boolean'],
  ['value', '★官方：checkbox 标识（群选时随 change 携带）', 'string'],
  ['indeterminate', '★框架扩展：半选态（父级不定，如全选组部分选中）', 'boolean'],
  ['disabled', '是否禁用（★官方对齐）', 'boolean'],
  ['color', '选中色（★官方对齐；缺省微信绿 #07c160）', 'string'],
])
const eventRows = ref([
  ['change', '选中态变化（★载荷 { detail: { value, name } }；name 为 value 标识）', '{ detail: { value: boolean, name: string } }'],
  ['update:modelValue', 'v-model 更新（受控回写）', 'boolean'],
])
const slotRows = ref([['default', '选项文字（label 内容）', '—']])
</script>

<template>
  <page-shell title="p-checkbox 多选" subtitle="复选框 · 自绘小方框双端一致">
    <demo-block index="01" title="基础用法（受控 v-model）" :has-output="true" desc="v-model 受控；切换触发 change（载荷含选中态与标识）" :code="codes.basic">
      <template #demo>
        <view class="row">
          <p-checkbox v-model="on" value="agree" @change="onChange">同意协议</p-checkbox>
        </view>
      </template>
      <template #output>
        <p-text class="out">状态：{{ on ? '已勾选' : '未勾选' }} · 最后事件：{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="半选态" desc="indeterminate 表达「部分选中」（★框架扩展；常用于全选组）" :code="codes.indeterminate">
      <template #demo>
        <view class="row">
          <p-checkbox :model-value="false" :indeterminate="true">半选</p-checkbox>
          <p-checkbox :model-value="true">全选</p-checkbox>
          <p-checkbox :model-value="false">未选</p-checkbox>
        </view>
      </template>
    </demo-block>

    <demo-block index="03" title="禁用态" desc="disabled 不可交互 + 淡化（★两端状态视觉统一）" :code="codes.disabled">
      <template #demo>
        <view class="row">
          <p-checkbox :model-value="true" disabled>禁用（已选）</p-checkbox>
          <p-checkbox :model-value="false" disabled>禁用（未选）</p-checkbox>
        </view>
      </template>
    </demo-block>

    <demo-block index="04" title="自定义颜色" desc="color 设定选中色（★官方 color 属性；缺省微信绿）" :code="codes.color">
      <template #demo>
        <view class="row">
          <p-checkbox v-model="onColor" color="#7c5cff">品牌紫</p-checkbox>
        </view>
      </template>
    </demo-block>

    <demo-block index="05" title="群选（value 标识）" :has-output="true" desc="多个 checkbox 用 value 区分标识；change 携带 name 回传选中项" :code="codes.group">
      <template #demo>
        <view class="row">
          <p-checkbox
            v-for="f in fruits"
            :key="f.id"
            :model-value="picked[f.id]"
            :value="f.id"
            @change="onGroupChange"
          >{{ f.name }}</p-checkbox>
        </view>
      </template>
      <template #output>
        <p-text class="out">已选 {{ pickedCount }} / {{ fruits.length }} 项</p-text>
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

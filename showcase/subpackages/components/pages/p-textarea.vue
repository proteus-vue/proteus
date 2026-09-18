<!-- showcase/subpackages/components/pages/p-textarea.vue —— p-textarea 组件演示（官方形态）
     覆盖：基础（value + @input 契约）/ 占位符（placeholder + 样式/类）/ 最大长度 / 自动增高 /
           聚焦 / 禁用 / 光标与键盘参数（cursor-spacing / cursor / selection-* / adjust-*）/
           confirm-type 键盘确认钮 / 事件契约。
     ★双端同源码：textarea 原生透传（MP 原生 bindconfirm）。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PTextarea, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: '<p-textarea :value="val" placeholder="请输入内容" @input="onInput" />',
  placeholder: '<p-textarea :value="val" placeholder="自定义占位符" placeholder-style="color:#7c5cff;font-size:16px" />',
  maxlength: '<p-textarea :value="val" :maxlength="20" placeholder="最多 20 字" @input="onInput" />',
  autoHeight: '<p-textarea :value="val" auto-height placeholder="随内容自动增高" />',
  focus: '<p-textarea :value="val" :focus="true" placeholder="自动聚焦" />',
  disabled: '<p-textarea :value="txt" disabled />',
  keyboard: '<p-textarea :value="val" :cursor-spacing="20" confirm-type="send" :confirm-hold="true" @confirm="onConfirm" />',
})

const val = ref('')
const txt = ref('禁用状态下的文本内容')
const lastEvent = ref('（暂无）')

// ★事件契约：input/confirm 载荷 { value }（跨端读法 e?.detail ?? e）
function readValue(e: unknown): string {
  const p = e as { detail?: { value?: unknown }; value?: unknown }
  const v = (p?.detail ?? p)?.value
  return typeof v === 'string' ? v : ''
}
function onInput(e: unknown) {
  val.value = readValue(e)
  lastEvent.value = `input → "${val.value}"`
}
function onConfirm(e: unknown) {
  lastEvent.value = `confirm → "${readValue(e)}"`
}
function onFocus() {
  lastEvent.value = 'focus'
}
function onBlur() {
  lastEvent.value = 'blur'
}

const apiRows = ref([
  ['pid', '元素标识（框架扩展，用于调试/定位）', 'string'],
  ['disabled', '是否禁用（★官方对齐）', 'boolean'],
  ['ariaLabel', '无障碍标签（框架扩展）', 'string'],
  ['value', '输入框内容（受控；★官方 value）', 'string'],
  ['maxlength', '最大输入长度，-1 不限（★官方 maxlength）', 'number'],
  ['placeholder', '空时的占位符（★官方 placeholder）', 'string'],
  ['placeholderStyle', '占位符内联样式（★官方 placeholder-style，仅 color/font-size/font-weight/line-height 有效）', 'string'],
  ['placeholderClass', '占位符类名（★官方 placeholder-class）', 'string'],
  ['focus', '获取焦点（★官方 focus / auto-focus）', 'boolean'],
  ['autoHeight', '自动增高，设 style.height 不生效（★官方 auto-height）', 'boolean'],
  ['cursorSpacing', '光标与键盘的距离（★官方 cursor-spacing）', 'number'],
  ['cursor', 'focus 时光标位置（★官方 cursor）', 'number'],
  ['selectionStart', '自动聚焦时光标起始位置，需与 selection-end 搭配（★官方 selection-start）', 'number'],
  ['selectionEnd', '自动聚焦时光标结束位置（★官方 selection-end）', 'number'],
  ['adjustPosition', '键盘弹起时自动上推页面（★官方 adjust-position）', 'boolean'],
  ['holdKeyboard', 'focus 时点击页面不收起键盘（★官方 hold-keyboard）', 'boolean'],
  ['disableDefaultPadding', '去掉 iOS 默认内边距（★官方 disable-default-padding）', 'boolean'],
  ['confirmType', '键盘右下角按钮文字：send/search/next/go/done（★官方 confirm-type）', 'string'],
  ['confirmHold', '点击键盘右下角按钮时保持键盘不收起（★官方 confirm-hold）', 'boolean'],
  ['adjustKeyboardTo', '键盘对齐位置：cursor/none（★官方 adjust-keyboard-to）', 'string'],
  ['fixed', 'fixed 定位（★官方 fixed，MP 私有布局语义）', 'boolean'],
  ['showConfirmBar', '是否显示键盘上方完成横条（iOS）（★官方 show-confirm-bar）', 'boolean'],
])
const eventRows = ref([
  ['input', '输入时触发（★载荷 { value }）', '{ value: string }'],
  ['confirm', '点击键盘确认按钮触发（★载荷 { value }）', '{ value: string }'],
  ['focus', '聚焦时触发', 'event'],
  ['blur', '失焦时触发', 'event'],
])
const slotRows = ref([['—', 'p-textarea 无插槽（原生 textarea 语义）', '—']])
</script>

<template>
  <page-shell title="p-textarea 多行文本域" subtitle="多行输入 · 双端同源码">
    <demo-block index="01" title="基础用法（value + @input）" :has-output="true" desc="受控写法：value 传入 + @input 回写（载荷 { value }）" :code="codes.basic">
      <template #demo>
        <p-textarea :value="val" placeholder="请输入内容" @input="onInput" @focus="onFocus" @blur="onBlur" />
      </template>
      <template #output>
        <p-text class="out">内容：「{{ val }}」 · 最后事件：{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="占位符与样式" desc="placeholder 文案 + placeholder-style 内联样式（★官方两属性）" :code="codes.placeholder">
      <template #demo>
        <p-textarea :value="val" placeholder="自定义占位符" placeholder-style="color:#7c5cff;font-size:16px" />
      </template>
    </demo-block>

    <demo-block index="03" title="最大长度（maxlength）" :has-output="true" desc="超过 maxlength 无法继续输入（★官方 maxlength）" :code="codes.maxlength">
      <template #demo>
        <p-textarea :value="val" :maxlength="20" placeholder="最多 20 字" @input="onInput" />
      </template>
      <template #output>
        <p-text class="out">已输入 {{ val.length }} 字</p-text>
      </template>
    </demo-block>

    <demo-block index="04" title="自动增高（auto-height）" desc="内容增多时高度自适应（★官方 auto-height）" :code="codes.autoHeight">
      <template #demo>
        <p-textarea :value="val" auto-height placeholder="随内容自动增高（多打几行试试）" />
      </template>
    </demo-block>

    <demo-block index="05" title="聚焦与键盘参数" desc="focus 自动聚焦；cursor-spacing / cursor / selection-* / adjust-* 控制光标与键盘（★官方系列属性）" :code="codes.keyboard">
      <template #demo>
        <p-textarea :value="val" :cursor-spacing="20" confirm-type="send" :confirm-hold="true" placeholder="按住输入并观察键盘行为" @confirm="onConfirm" />
      </template>
    </demo-block>

    <demo-block index="06" title="禁用态" desc="disabled 不可编辑 + 淡化（★官方对齐）" :code="codes.disabled">
      <template #demo>
        <p-textarea :value="txt" disabled />
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

<!-- showcase/pages/component-input.vue —— p-input 组件演示
     覆盖：基础输入 / 受控绑定 / 输入类型 / 字数限制 / 聚焦 / 禁用 / 事件回显。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PInput, PText, PView } from '@proteus-vue/components'

const codes = ref({
  basic: '<p-input placeholder="请输入" @input="onInput" />',
  controlled: '<p-input :value="text" @input="onInput" />',
  types: '<p-input type="number" /><p-input type="password" />',
  maxlength: '<p-input :maxlength="10" />',
  focus: '<p-input :focus="true" />',
  disabled: '<p-input :disabled="true" value="禁用内容" />',
})

const lastInput = ref('')
const text = ref('')
const numVal = ref('')
const pwdVal = ref('')
const limited = ref('')
const lastEvent = ref('（暂无）')

// ★事件载荷契约：p-input emit **{ value }**（无 detail 包裹——见 examples 的正确接法）。
//   此前误按 MP 原生 e.detail.value 取值 → 恒 undefined → 「输入后结果不变化」（真机+Web 复现）。
function pickValue(e: unknown): string {
  const p = e as { value?: string; detail?: { value?: string } }
  return String(p?.value ?? p?.detail?.value ?? '')
}
function onInput(e: unknown) {
  const v = pickValue(e)
  lastInput.value = v
  text.value = v
}
function onNumInput(e: unknown) { numVal.value = pickValue(e) }
function onPwdInput(e: unknown) { pwdVal.value = pickValue(e) }
function onLimitedInput(e: unknown) { limited.value = pickValue(e) }
function evt(name: string) {
  lastEvent.value = name + ' @ ' + (Date.now() % 100000)
}

const apiRows = ref([
  ['value', '输入框内容（受控——配合 @input 回写）', 'string'],
  ['type', '输入类型：text / number / password / idcard / digit', 'string'],
  ['placeholder', '占位提示文字', 'string'],
  ['maxlength', '最大输入长度（≤0 不限）', 'number'],
  ['focus', '自动聚焦（true 时获取焦点）', 'boolean'],
  ['disabled', '禁用态（不可编辑）', 'boolean'],
  ['ariaLabel', '无障碍标签', 'string'],
  ['pid', '组件实例标识（调试/测试定位）', 'string'],
])
const eventRows = ref([
  ['input', '输入内容变化（★emit { value }，非 e.detail）', '{ value: string }'],
  ['confirm', '键盘完成/回车', '(e)'],
  ['focus', '获取焦点', '(e)'],
  ['blur', '失去焦点', '(e)'],
])
</script>

<template>
  <page-shell title="p-input 输入框" subtitle="文本输入 · 受控组件（value + input 回写）">
    <demo-block index="01" title="基础用法" :has-output="true" desc="受控输入：@input 事件回传 { value }" :code="codes.basic">
      <template #demo>
        <p-input placeholder="请输入内容" @input="onInput" />
      </template>
      <template #output>
        <p-text class="out">结果：实时输入 {{ lastInput || '（空）' }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="受控绑定" :has-output="true" desc="value 受控 + @input 回写（v-model 的双端等价写法）" :code="codes.controlled">
      <template #demo>
        <p-input :value="text" placeholder="输入后同步到下方" @input="onInput" />
      </template>
      <template #output>
        <p-text class="out">结果：同步值 {{ text || '（空）' }} · 长度 {{ text.length }}</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="输入类型" :has-output="true" desc="type=number 数字键盘 / type=password 密码遮蔽" :code="codes.types">
      <template #demo>
        <view class="col">
          <p-input type="number" placeholder="数字键盘" @input="onNumInput" />
          <p-input type="password" placeholder="密码输入" @input="onPwdInput" />
        </view>
      </template>
      <template #output>
        <p-text class="out">结果：number={{ numVal || '空' }} · password={{ pwdVal ? '已输入' + pwdVal.length + '位' : '空' }}</p-text>
      </template>
    </demo-block>

    <demo-block index="04" title="字数限制" :has-output="true" desc="maxlength=10 限制最大输入长度" :code="codes.maxlength">
      <template #demo>
        <p-input :maxlength="10" placeholder="最多 10 字" @input="onLimitedInput" />
      </template>
      <template #output>
        <p-text class="out">结果：已输入 {{ limited.length }} / 10</p-text>
      </template>
    </demo-block>

    <demo-block index="05" title="自动聚焦" desc="focus=true 时进入页面即获取焦点（调起键盘）" :code="codes.focus">
      <template #demo>
        <p-input :focus="true" placeholder="进入即聚焦" />
      </template>
    </demo-block>

    <demo-block index="06" title="禁用态" desc="disabled 不可编辑" :code="codes.disabled">
      <template #demo>
        <p-input :disabled="true" value="禁用内容" />
      </template>
    </demo-block>

    <demo-block index="07" title="事件回显" :has-output="true" desc="focus / blur / confirm 事件实时回显">
      <template #demo>
        <p-input placeholder="聚焦 / 失焦 / 回车试试" @focus="evt('focus')" @blur="evt('blur')" @confirm="evt('confirm')" />
      </template>
      <template #output>
        <p-text class="out">结果：最后事件 {{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
  </page-shell>
</template>

<style scoped>
.col { display: flex; flex-direction: column; gap: var(--sp-3); }
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

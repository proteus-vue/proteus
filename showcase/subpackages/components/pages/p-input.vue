<!-- showcase/subpackages/components/pages/p-input.vue —— p-input 输入框 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-input.md ← gen-content.mjs ← packages/components/p-input/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PInput, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<p-input placeholder=\"请输入\" @input=\"onInput\" />",
  controlled: "<p-input :value=\"text\" @input=\"onInput\" />",
  types: "<p-input type=\"number\" /><p-input type=\"password\" />",
  maxlength: "<p-input :maxlength=\"10\" />",
  focus: "<p-input :focus=\"true\" />",
  disabled: "<p-input :disabled=\"true\" value=\"禁用内容\" />",
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
  [
    "pid",
    "组件实例标识（调试/观测/测试定位用——D-2 dogfooding 契约）",
    "String"
  ],
  [
    "disabled",
    "禁用态（禁交互 + 弱化视觉；MP 原生 disabled 透传）",
    "Boolean"
  ],
  [
    "ariaLabel",
    "无障碍标签（读屏器朗读文本）",
    "String"
  ],
  [
    "value",
    "绑定值",
    "String"
  ],
  [
    "type",
    "类型变体",
    "String"
  ],
  [
    "maxlength",
    "最大输入长度（≤ 0 = 不限）",
    "Number"
  ],
  [
    "placeholder",
    "占位提示文本",
    "String"
  ],
  [
    "password",
    "是否是密码类型（官方独立属性；等价 type=\"password\"）",
    "Boolean"
  ],
  [
    "placeholderStyle",
    "占位符样式（内联样式字符串）",
    "String"
  ],
  [
    "cursorSpacing",
    "指定光标与键盘的距离（px）",
    "Number"
  ],
  [
    "confirmType",
    "键盘右下角按钮文字：send/search/next/go/done",
    "String"
  ],
  [
    "cursor",
    "光标位置",
    "Number"
  ],
  [
    "autoHeight",
    "是否自动增高（textarea 语义，input 端透传）",
    "Boolean"
  ],
  [
    "focus",
    "自动聚焦",
    "Boolean"
  ],
  [
    "alwaysEmbed",
    "强制 input 处于同层状态（iOS：默认 focus 时会切非同层）",
    "Boolean"
  ],
  [
    "confirmHold",
    "点击键盘右下角按钮时是否保持键盘不收起",
    "Boolean"
  ],
  [
    "adjustPosition",
    "键盘弹起时是否自动上推页面（官方默认 true）",
    "Boolean"
  ],
  [
    "holdKeyboard",
    "focus 时点击页面是否不收起键盘",
    "Boolean"
  ],
  [
    "cursorColor",
    "光标颜色（iOS 十六进制；Android 仅 default/green）",
    "String"
  ],
  [
    "selectionStart",
    "光标起始位置（自动聚集时有效，需与 selectionEnd 搭配）",
    "Number"
  ],
  [
    "selectionEnd",
    "光标结束位置（自动聚集时有效，需与 selectionStart 搭配）",
    "Number"
  ],
  [
    "placeholderClass",
    "placeholder 样式类名（与 placeholderStyle 互补：类 vs 内联样式）",
    "String"
  ],
  [
    "safePasswordCertPath",
    "安全键盘加密公钥路径（仅支持包内路径）",
    "String"
  ],
  [
    "safePasswordLength",
    "安全键盘输入密码长度",
    "Number"
  ],
  [
    "safePasswordTimeStamp",
    "安全键盘加密时间戳",
    "Number"
  ],
  [
    "safePasswordNonce",
    "安全键盘加密盐值",
    "String"
  ],
  [
    "safePasswordSalt",
    "安全键盘计算 hash 盐值（指定 customHash 则无效）",
    "String"
  ],
  [
    "safePasswordCustomHash",
    "安全键盘计算 hash 的算法表达式，如 md5(sha1('foo' + sha256(sm3(passw)))",
    "String"
  ]
])
const eventRows = ref([
  [
    "input",
    "输入变化（载荷 { value } 跨端归一——MP 自定义组件 v-model 仅覆盖原生 input/textarea，故显式事件契约）",
    "{ value: eventValue(e) }"
  ],
  [
    "confirm",
    "键盘确认（回车/完成键）",
    "{ value: eventValue(e) }"
  ],
  [
    "focus",
    "获得焦点",
    "e"
  ],
  [
    "blur",
    "失去焦点",
    "e"
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
    "skyline（WebView 降级） · 原生控件映射 → <input>（L1 原语）"
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
  <page-shell title="p-input 输入框" subtitle="文本输入 · 受控组件（value + input 回写）">
    <demo-block index="01" title="基础用法" desc="受控输入：@input 事件回传 { value }" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-input placeholder="请输入内容" @input="onInput" />
      </template>
      <template #output>
        <p-text class="out">结果：实时输入 {{ lastInput || '（空）' }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="受控绑定" desc="value 受控 + @input 回写（v-model 的双端等价写法）" :has-output="true" :code="codes.controlled">
      <template #demo>
        <p-input :value="text" placeholder="输入后同步到下方" @input="onInput" />
      </template>
      <template #output>
        <p-text class="out">结果：同步值 {{ text || '（空）' }} · 长度 {{ text.length }}</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="输入类型" desc="type=number 数字键盘 / type=password 密码遮蔽" :has-output="true" :code="codes.types">
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

    <demo-block index="04" title="字数限制" desc="maxlength=10 限制最大输入长度" :has-output="true" :code="codes.maxlength">
      <template #demo>
        <p-input :maxlength="10" placeholder="最多 10 字" @input="onLimitedInput" />
      </template>
      <template #output>
        <p-text class="out">结果：已输入 {{ limited.length }} / 10</p-text>
      </template>
    </demo-block>

    <demo-block index="05" title="自动聚焦" desc="focus=true 时进入页面即获取焦点（调起键盘）" :has-output="false" :code="codes.focus">
      <template #demo>
        <p-input :focus="true" placeholder="进入即聚焦" />
      </template>
    </demo-block>

    <demo-block index="06" title="禁用态" desc="disabled 不可编辑" :has-output="false" :code="codes.disabled">
      <template #demo>
        <p-input :disabled="true" value="禁用内容" />
      </template>
    </demo-block>

    <demo-block index="07" title="事件回显" desc="focus / blur / confirm 事件实时回显" :has-output="true">
      <template #demo>
        <p-input placeholder="聚焦 / 失焦 / 回车试试" @focus="evt('focus')" @blur="evt('blur')" @confirm="evt('confirm')" />
      </template>
      <template #output>
        <p-text class="out">结果：最后事件 {{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
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

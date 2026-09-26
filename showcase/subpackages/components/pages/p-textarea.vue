<!-- showcase/subpackages/components/pages/p-textarea.vue —— p-textarea 多行文本域 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-textarea.md ← gen-content.mjs ← packages/components/p-textarea/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText, PTextarea } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<p-textarea :value=\"val\" placeholder=\"请输入内容\" @input=\"onInput\" />",
  placeholder: "<p-textarea :value=\"val\" placeholder=\"自定义占位符\" placeholder-style=\"color:#7c5cff;font-size:16px\" />",
  maxlength: "<p-textarea :value=\"val\" :maxlength=\"20\" placeholder=\"最多 20 字\" @input=\"onInput\" />",
  autoHeight: "<p-textarea :value=\"val\" auto-height placeholder=\"随内容自动增高\" />",
  focus: "<p-textarea :value=\"val\" :focus=\"true\" placeholder=\"自动聚焦\" />",
  disabled: "<p-textarea :value=\"txt\" disabled />",
  keyboard: "<p-textarea :value=\"val\" :cursor-spacing=\"20\" confirm-type=\"send\" :confirm-hold=\"true\" @confirm=\"onConfirm\" />",
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
    "placeholderStyle",
    "★官方 placeholder-style：占位符内联样式（仅 color/font-size/font-weight/line-height 有效）",
    "String"
  ],
  [
    "placeholderClass",
    "★官方 placeholder-class：占位符类名",
    "String"
  ],
  [
    "focus",
    "自动聚焦",
    "Boolean"
  ],
  [
    "autoHeight",
    "★官方 auto-height：自动增高（设 style.height 不生效）",
    "Boolean"
  ],
  [
    "cursorSpacing",
    "★官方 cursor-spacing：光标与键盘距离",
    "Number"
  ],
  [
    "cursor",
    "★官方 cursor：focus 时光标位置",
    "Number"
  ],
  [
    "selectionStart",
    "★官方 selection-start：自动聚焦时光标起始位置（需与 selection-end 搭配）",
    "Number"
  ],
  [
    "selectionEnd",
    "★官方 selection-end：自动聚焦时光标结束位置",
    "Number"
  ],
  [
    "adjustPosition",
    "★官方 adjust-position：键盘弹起时自动上推页面",
    "Boolean"
  ],
  [
    "holdKeyboard",
    "★官方 hold-keyboard：focus 时点击页面不收起键盘",
    "Boolean"
  ],
  [
    "disableDefaultPadding",
    "★官方 disable-default-padding：去掉 iOS 默认内边距",
    "Boolean"
  ],
  [
    "confirmType",
    "★官方 confirm-type：键盘右下角按钮文字（send/search/next/go/done）",
    "String"
  ],
  [
    "confirmHold",
    "★官方 confirm-hold：点击键盘右下角按钮时保持键盘不收起",
    "Boolean"
  ],
  [
    "adjustKeyboardTo",
    "★官方 adjust-keyboard-to：键盘对齐位置（cursor/none）",
    "String"
  ],
  [
    "fixed",
    "★官方 fixed：fixed 定位（MP 私有布局语义）",
    "Boolean"
  ],
  [
    "showConfirmBar",
    "★官方 show-confirm-bar：是否显示键盘上方完成横条（iOS）",
    "Boolean"
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
    "skyline（WebView 降级） · 原生控件映射 → <textarea>（L1 原语）"
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
  <page-shell title="p-textarea 多行文本域" subtitle="多行输入 · 双端同源码">
    <demo-block index="01" title="基础用法（value + @input）" desc="受控写法：value 传入 + @input 回写（载荷 { value }）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-textarea :value="val" placeholder="请输入内容" @input="onInput" @focus="onFocus" @blur="onBlur" />
      </template>
      <template #output>
        <p-text class="out">内容：「{{ val }}」 · 最后事件：{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="占位符与样式" desc="placeholder 文案 + placeholder-style 内联样式（★官方两属性）" :has-output="false" :code="codes.placeholder">
      <template #demo>
        <p-textarea :value="val" placeholder="自定义占位符" placeholder-style="color:#7c5cff;font-size:16px" />
      </template>
    </demo-block>

    <demo-block index="03" title="最大长度（maxlength）" desc="超过 maxlength 无法继续输入（★官方 maxlength）" :has-output="true" :code="codes.maxlength">
      <template #demo>
        <p-textarea :value="val" :maxlength="20" placeholder="最多 20 字" @input="onInput" />
      </template>
      <template #output>
        <p-text class="out">已输入 {{ val.length }} 字</p-text>
      </template>
    </demo-block>

    <demo-block index="04" title="自动增高（auto-height）" desc="内容增多时高度自适应（★官方 auto-height）" :has-output="false" :code="codes.autoHeight">
      <template #demo>
        <p-textarea :value="val" auto-height placeholder="随内容自动增高（多打几行试试）" />
      </template>
    </demo-block>

    <demo-block index="05" title="聚焦与键盘参数" desc="focus 自动聚焦；cursor-spacing / cursor / selection-* / adjust-* 控制光标与键盘（★官方系列属性）" :has-output="false" :code="codes.keyboard">
      <template #demo>
        <p-textarea :value="val" :cursor-spacing="20" confirm-type="send" :confirm-hold="true" placeholder="按住输入并观察键盘行为" @confirm="onConfirm" />
      </template>
    </demo-block>

    <demo-block index="06" title="禁用态" desc="disabled 不可编辑 + 淡化（★官方对齐）" :has-output="false" :code="codes.disabled">
      <template #demo>
        <p-textarea :value="txt" disabled />
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

<!-- showcase/subpackages/components/pages/p-form.vue —— p-form 表单容器 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-form.md ← gen-content.mjs ← packages/components/p-form/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PForm, PInput, PLabel, PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- form 提供表单语义 + submit 事件；字段与校验由页面组织 -->\n<p-form :model=\"model\" layout=\"vertical\" @submit=\"onSubmit\">\n  <p-label for=\"f-name\">用户名</p-label>\n  <p-input id=\"f-name\" v-model=\"model.name\" />\n  <p-button form-type=\"submit\">提交</p-button>\n</p-form>",
})

const formModel = ref({ name: '', age: '' })
const formErrors = ref<Record<string, string>>({})
const formMsg = ref('（尚未提交）')
// ★规则放**页面**（不放 rules prop）：rules 是函数表，MP 端 WXML 数据无法承载函数——
//   表单校验留在这层既双端可用，也让「校验失败长什么样」立即可见。
function validateForm(): Record<string, string> {
  const errs: Record<string, string> = {}
  if (!String(formModel.value.name).trim()) errs.name = '请输入用户名'
  const age = String(formModel.value.age)
  if (!age) errs.age = '请输入年龄'
  else if (!/^\d+$/.test(age)) errs.age = '年龄必须是数字'
  else if (Number(age) < 18) errs.age = '年龄需满 18 岁'
  return errs
}
function onSubmit(): void {
  const errs = validateForm()
  formErrors.value = errs
  formMsg.value = Object.keys(errs).length ? '校验未通过（见各字段下方红色提示）' : '校验通过 → submit 事件已触发'
}

const apiRows = ref([
  [
    "model",
    "表单数据模型（校验对象）",
    "Object"
  ],
  [
    "rules",
    "校验规则 {field: (value) => string \\",
    "null}（返回错误文案；null=通过）"
  ],
  [
    "layout",
    "布局：horizontal 横排 / vertical 纵排",
    "String"
  ],
  [
    "reportSubmit",
    "是否返回 formId 用于发送模板消息",
    "Boolean"
  ],
  [
    "reportSubmitTimeout",
    "等待一段时间（毫秒）以确认 formId 是否生效（不指定则 formId 有很小概率无效——官方建议设置）",
    "Number"
  ]
])
const eventRows = ref([
  [
    "submit",
    "表单提交",
    "{ model: props.model, errors: { ...errors.value } }"
  ]
])
const slotRows = ref([
  [
    "default",
    "默认插槽（作用域参数：errors）",
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
    "skyline（WebView 降级） · 原生控件映射 → <form>（L1 原语）"
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
  <page-shell title="p-form 表单容器" subtitle="内容与表单 · ui.form · 双端同源码">
    <demo-block index="01" title="提交触发校验（submit + 字段错误回显）" desc="★点「提交」触发校验：故意留空 → 各字段下方出现红色错误提示；填对后再点 → 提交通过（这是表单容器的真实职责：聚合校验时机与 submit 事件）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-form layout="vertical" @submit="onSubmit">
            <p-view class="fd">
              <p-label for="f-name">用户名</p-label>
              <p-input id="f-name" :model-value="formModel.name" placeholder="留空试试" @update:model-value="(v: unknown) => { formModel.name = String(v ?? '') }" />
              <p-text v-if="formErrors.name" class="fe">{{ formErrors.name }}</p-text>
            </p-view>
            <p-view class="fd">
              <p-label for="f-age">年龄</p-label>
              <p-input id="f-age" :model-value="formModel.age" placeholder="试试 17 或 abc" @update:model-value="(v: unknown) => { formModel.age = String(v ?? '') }" />
              <p-text v-if="formErrors.age" class="fe">{{ formErrors.age }}</p-text>
            </p-view>
            <p-button size="small" form-type="submit">提交</p-button>
          </p-form>
      </template>
      <template #output>
        <p-text class="out">{{ formMsg }}</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.fd { margin-bottom: var(--sp-3); }
.fe { display: block; color: #e54d42; font-size: 12px; margin-top: 4px; }
</style>

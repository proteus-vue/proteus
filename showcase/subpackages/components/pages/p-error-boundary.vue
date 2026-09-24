<!-- showcase/subpackages/components/pages/p-error-boundary.vue —— p-error-boundary 错误兜底 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-error-boundary.md ← gen-content.mjs ← packages/components/p-error-boundary/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref, nextTick } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import CrashProbe from '../../../components/crash-probe/index.vue'
import { PButton, PErrorBoundary, PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- 捕获后代组件渲染/生命周期错误 → 显示 fallback 槽（缺省 fallbackText） -->\n<p-error-boundary fallback-text=\"出错了，请重试\">\n  <p-text>正常内容</p-text>\n</p-error-boundary>",
  slot: "<!-- 自定义兜底：fallback 命名槽 -->\n<p-error-boundary>\n  <template #fallback><p-text>自定义兜底 UI</p-text></template>\n  <p-text>正常内容</p-text>\n</p-error-boundary>",
})

const ebCrash = ref(false)
const ebMounted = ref(true)
function crashNow(): void {
  ebCrash.value = true
}
function resetCrashed(): void {
  // ★错误状态由组件内部持有 → 必须先卸载再挂载才能真正复位。
  //   ★不用 :key（那是「换 key 即重挂载」的 Web 手法）——MP 的 wx:key 只对 wx:for 有意义，
  //     独立使用会被编译器判为悬挂属性并**中止构建**（实测 [InvalidAttribute] wx:key 无 wx:for 悬挂）。
  //   用 v-if 显式卸载 → nextTick 后重新挂载，两端语义一致。
  ebMounted.value = false
  ebCrash.value = false
  void nextTick(() => {
    ebMounted.value = true
  })
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
    "fallbackText",
    "加载失败/空态的兑底文案",
    "String"
  ]
])
const eventRows = ref([])
const slotRows = ref([
  [
    "fallback",
    "具名插槽",
    "—"
  ],
  [
    "default",
    "默认插槽（组件主内容）",
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
    "skyline（WebView 降级） · Proteus 扩展组件——无小程序对应"
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
  <page-shell title="p-error-boundary 错误兜底" subtitle="工程 · 错误边界 · 双端同源码">
    <demo-block index="01" title="捕获子树错误 → 显示兜底" desc="★点「触发子组件崩溃」会让下方的子组件在渲染期抛错，错误边界捕获后显示兜底文案（而不是整页白屏）；点「重置」重新挂载" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-view class="btns">
            <p-button size="small" @click="crashNow">触发子组件崩溃</p-button>
            <p-button size="small" @click="resetCrashed">重置</p-button>
          </p-view>
          <p-error-boundary v-if="ebMounted" fallback-text="⚠ 子树出错了（错误边界已兜底）">
            <crash-probe :crash="ebCrash" />
          </p-error-boundary>
      </template>
      <template #output>
        <p-text class="out">★错误边界是「隔离故障」的基础件：一棵子树崩了不影响其他区域（onErrorCaptured + return false 阻止继续冒泡）</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.btns { display: flex; gap: var(--sp-2); flex-wrap: wrap; margin-bottom: var(--sp-2); }
</style>

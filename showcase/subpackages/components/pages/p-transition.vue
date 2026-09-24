<!-- showcase/subpackages/components/pages/p-transition.vue —— p-transition 过渡 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-transition.md ← gen-content.mjs ← packages/components/p-transition/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PText, PTransition, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- name: fade / slide-up / slide-down / slide-left / slide-right / zoom -->\n<!-- mode: in / out / both；visible 驱动显隐 -->\n<p-transition name=\"slide-up\" mode=\"both\" :visible=\"show\">\n  <p-text>内容</p-text>\n</p-transition>",
})

const trVisible = ref(true)
const trName = ref('fade')
function toggleTr(): void {
  trVisible.value = !trVisible.value
}
function setTr(n: string): void {
  trName.value = n
  trVisible.value = true
}

const apiRows = ref([
  [
    "name",
    "过渡预设名（fade/slide-up/slide-down/slide-left/slide-right/zoom）",
    "String"
  ],
  [
    "mode",
    "过渡方向：in（仅进入）/ out（仅退出）/ both（双向）",
    "String"
  ],
  [
    "duration",
    "过渡时长（ms）",
    "Number"
  ],
  [
    "visible",
    "显隐开关（父级控制）",
    "Boolean"
  ]
])
const eventRows = ref([])
const slotRows = ref([
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
    "skyline（WebView 降级） · 原生控件映射 → <keyframe-animation>（L1 原语） · <root-portal>（L1 原语）"
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
  <page-shell title="p-transition 过渡" subtitle="工程 · 进入/离开过渡 · 双端同源码">
    <demo-block index="01" title="六个预设 + 显隐切换（name / visible）" desc="★点按钮切换显隐（观察过渡），点预设名切换形态；★切「隐藏」时会看到淡出/位移，切「显示」是反向过程" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-view class="btns">
            <p-button size="small" @click="toggleTr">{{ trVisible ? '隐藏' : '显示' }}</p-button>
            <p-button size="small" @click="setTr('fade')">fade</p-button>
            <p-button size="small" @click="setTr('slide-up')">slide-up</p-button>
            <p-button size="small" @click="setTr('zoom')">zoom</p-button>
          </p-view>
          <p-transition class="tr-stage" :name="trName" mode="both" :visible="trVisible">
            <p-text>{{ trName }} 过渡内容</p-text>
          </p-transition>
      </template>
      <template #output>
        <p-text class="out">当前预设：{{ trName }} · 可见：{{ trVisible ? "是" : "否" }}</p-text>
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
.tr-stage { background: #eef2ff; border-radius: var(--sp-radius-sm); padding: var(--sp-4); text-align: center; }
</style>

<!-- showcase/subpackages/components/pages/p-toast.vue —— p-toast 轻提示 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-toast.md ← gen-content.mjs ← packages/components/p-toast/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PText, PToast, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- duration 到点自动 emit close（0 = 不自动关） -->\n<p-toast :visible=\"toastVisible\" text=\"操作成功\" :duration=\"1500\" :position=\"pos\" @close=\"onToastClose\" />",
})

const toastVisible = ref(false)
const toastPos = ref('center')
function showToast(pos: string): void {
  toastPos.value = pos
  toastVisible.value = true
}
function onToastClose(): void {
  toastVisible.value = false
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
    "visible",
    "是否可见（显隐由响应式数据驱动，零平台分支）",
    "Boolean"
  ],
  [
    "text",
    "显示文本",
    "String"
  ],
  [
    "duration",
    "持续时间（ms）",
    "Number"
  ],
  [
    "position",
    "位置/方位",
    "String"
  ]
])
const eventRows = ref([
  [
    "close",
    "关闭",
    "—"
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
  <page-shell title="p-toast 轻提示" subtitle="页面外壳 · 轻提示 · 双端同源码">
    <demo-block index="01" title="自动关闭 + 三个位置（center / top / bottom）" desc="★点按钮弹出轻提示，1.5s 后**自动 emit close**（父置 visible=false）；三个位置对照（自带淡入动画）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-view class="btns">
            <p-button size="small" @click="showToast('center')">居中</p-button>
            <p-button size="small" @click="showToast('top')">顶部</p-button>
            <p-button size="small" @click="showToast('bottom')">底部</p-button>
          </p-view>
          <p-toast :visible="toastVisible" text="操作成功（1.5s 自动关闭）" :duration="1500" :position="toastPos" @close="onToastClose" />
      </template>
      <template #output>
        <p-text class="out">★避开了原生 wx.showToast 的限制：自绘 toast 支持自定义位置与时长，两端视觉一致（组件内定时器在 onUnmounted 清理）</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.btns { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
</style>

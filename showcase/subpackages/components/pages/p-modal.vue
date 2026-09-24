<!-- showcase/subpackages/components/pages/p-modal.vue —— p-modal 弹窗 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-modal.md ← gen-content.mjs ← packages/components/p-modal/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PModal, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- v-model:visible 受控 + 标题/关闭按钮/点遮罩关闭 -->\n<p-modal v-model:visible=\"visible\" title=\"标题\">\n  <p-text>内容</p-text>\n</p-modal>",
})

const modalVisible = ref(false)
const modalLast = ref('（暂无）')
function openModal(): void {
  modalVisible.value = true
}
// ★观察显隐变化用 watch，**不要**再写 @update:visible——v-model:visible 已隐含该绑定，
//   两者同写会产出重复的 bind:update-visible（MP 编译器按平台标准报违规并中止构建）
watch(modalVisible, (v) => {
  modalLast.value = v ? '打开' : '关闭'
})

const apiRows = ref([
  [
    "visible",
    "弹窗可见（v-model:visible）",
    "Boolean"
  ],
  [
    "pAdaptive",
    "★形态区间声明：模板写 p-adaptive=\"sheet(0, 600) \\",
    "dialog(600, 840) \\"
  ],
  [
    "anchor",
    "popover 形态锚定触发源（元素引用；缺省 → popover 居中降级，03 §6 降级链）",
    "Object"
  ],
  [
    "width",
    "形态求解宽度覆盖（0 = 跟随视口；>0 = 强制指定——预览/验证/测试不同窗口大小）",
    "Number"
  ],
  [
    "title",
    "标题（header slot 存在时优先）",
    "String"
  ],
  [
    "closable",
    "右上角关闭按钮",
    "Boolean"
  ],
  [
    "maskClosable",
    "点击遮罩关闭",
    "Boolean"
  ],
  [
    "maskOpacity",
    "遮罩透明度",
    "Number"
  ]
])
const eventRows = ref([
  [
    "update:visible",
    "v-model 双向绑定：visible变化时触发（同步父级绑定）",
    "false"
  ],
  [
    "formChange",
    "表单项变化",
    "next"
  ]
])
const slotRows = ref([
  [
    "header",
    "具名插槽",
    "—"
  ],
  [
    "default",
    "默认插槽（组件主内容）",
    "—"
  ],
  [
    "footer",
    "具名插槽",
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
  <page-shell title="p-modal 弹窗" subtitle="页面外壳 · 形态自适应弹窗 · 双端同源码">
    <demo-block index="01" title="受控显隐 + 点遮罩关闭（v-model:visible）" desc="★点按钮打开；点遮罩或右上角 × 关闭（maskClosable / closable 缺省开启）；★形态区间自适应：pAdaptive 按**宽度**选 sheet(0–600) / dialog(600–840) / popover(840+)" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-button size="small" @click="openModal">打开弹窗</p-button>
          <p-modal v-model:visible="modalVisible" title="形态自适应弹窗">
            <p-text>手机宽度 → sheet 形态（贴底）；平板 → dialog 居中；宽屏 → popover</p-text>
          </p-modal>
      </template>
      <template #output>
        <p-text class="out">最后操作：{{ modalLast }}（经 watch 观察 v-model 变化）</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

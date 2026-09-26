<!-- showcase/subpackages/components/pages/p-page-container.vue —— p-page-container 页面容器 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-page-container.md ← gen-content.mjs ← packages/components/p-page-container/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PPageContainer, PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  base: "<p-page-container v-model:show=\"show\" @close=\"onClose\"><p-view>内容</p-view></p-page-container>",
  top: "<p-page-container v-model:show=\"showTop\" position=\"top\">…</p-page-container>",
  center: "<p-page-container v-model:show=\"showCenter\" position=\"center\">…</p-page-container>",
  overlay: "<p-page-container v-model:show=\"showNoOverlay\" :overlay=\"false\">…</p-page-container>",
  slide: "<p-page-container v-model:show=\"showSlide\" close-on-slide-down>…</p-page-container>",
})

const show = ref(false)
const showTop = ref(false)
const showCenter = ref(false)
const showNoOverlay = ref(false)
const showSlide = ref(false)
const lastEvent = ref('（未触发 close）')
function onClose() {
  lastEvent.value = 'close 事件触发'
}

const apiRows = ref([
  [
    "show",
    "显示（v-model:show）",
    "Boolean"
  ],
  [
    "position",
    "位置：bottom 底部（默认）/ top 顶部 / center 居中（★官方 position）",
    "String"
  ],
  [
    "overlay",
    "是否显示遮罩",
    "Boolean"
  ],
  [
    "closeOnClickOverlay",
    "点击遮罩关闭",
    "Boolean"
  ],
  [
    "round",
    "圆角（★官方 round）",
    "Boolean"
  ],
  [
    "duration",
    "进出场动画时长（ms）",
    "Number"
  ],
  [
    "zIndex",
    "层级",
    "Number"
  ],
  [
    "closeOnSlideDown",
    "下滑一段距离后关闭（触摸/鼠标手势，双端同源）",
    "Boolean"
  ],
  [
    "overlayStyle",
    "自定义遮罩层样式",
    "String"
  ],
  [
    "customStyle",
    "自定义弹出层样式",
    "String"
  ]
])
const eventRows = ref([
  [
    "update:show",
    "v-model 双向绑定：show变化时触发（同步父级绑定）",
    "false"
  ],
  [
    "close",
    "关闭",
    "—"
  ]
])
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
    "skyline（WebView 降级） · 原生控件映射 → <page-container>（L1 原语）"
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
  <page-shell title="p-page-container 页面容器" subtitle="页面外壳 · 底部/顶部/居中弹出层">
    <demo-block index="01" title="基础弹出（底部）" desc="v-model:show 控制；点击遮罩关闭（update:show 回写）" :has-output="true" :code="codes.base">
      <template #demo>
        <p-button @click="show = true">打开底部容器</p-button>
      </template>
      <template #output>
        <p-text class="out">{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="位置（position）" desc="top 从顶部弹出 / center 居中弹出（★官方 position）" :has-output="false" :code="codes.top">
      <template #demo>
        <view class="row">
  <p-button size="mini" @click="showTop = true">顶部（top）</p-button>
  <p-button size="mini" @click="showCenter = true">居中（center）</p-button>
</view>
      </template>
    </demo-block>

    <demo-block index="03" title="无遮罩 / 下滑关闭" desc="overlay=false 无遮罩；close-on-slide-down 下滑关闭（触摸手势）" :has-output="false" :code="codes.overlay">
      <template #demo>
        <view class="row">
  <p-button size="mini" @click="showNoOverlay = true">无遮罩</p-button>
  <p-button size="mini" @click="showSlide = true">下滑关闭</p-button>
</view>
      </template>
    </demo-block>

    <p-page-container v-model:show="show" @close="onClose">
      <p-view class="panel"><p-text>底部弹出层内容（bottom）——点遮罩关闭</p-text></p-view>
    </p-page-container>
    <p-page-container v-model:show="showTop" position="top" @close="onClose">
      <p-view class="panel"><p-text>顶部弹出层内容（top，从上滑入）</p-text></p-view>
    </p-page-container>
    <p-page-container v-model:show="showCenter" position="center" @close="onClose">
      <p-view class="panel"><p-text>居中弹出层内容（center）</p-text></p-view>
    </p-page-container>
    <p-page-container v-model:show="showNoOverlay" :overlay="false" @close="onClose">
      <p-view class="panel"><p-text>无遮罩弹出层（overlay=false）</p-text></p-view>
    </p-page-container>
    <p-page-container v-model:show="showSlide" close-on-slide-down @close="onClose">
      <p-view class="panel"><p-text>下滑关闭（下滑 40px 关闭）</p-text></p-view>
    </p-page-container>


    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.row { display: flex; flex-direction: row; gap: var(--sp-3); }
.panel { padding: var(--sp-4); }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>

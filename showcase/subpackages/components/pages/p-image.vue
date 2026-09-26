<!-- showcase/subpackages/components/pages/p-image.vue —— p-image 图片 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-image.md ← gen-content.mjs ← packages/components/p-image/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PImage, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  fill: "<p-image src=\"…\" mode=\"aspectFill\" />",
  lazy: "<p-image src=\"…\" lazy-load fade-in @load=\"onLoad\" />",
  menu: "<p-image src=\"…\" show-menu-by-longpress />",
})

// ★内联 SVG 必须 **base64** data-URI：Skyline <image> 只完整渲染 base64 编码的 SVG
//   （URL-encoded 形态真机渲染为**灰色方块**——见 docs/skyline-pitfalls.md / svg-lower.ts 地基实证）。
// ★★字面量必须**直接内联进 ref()**：`ref(SOME_CONST)`（标识符初值）编译器**静态求值不出** → data.img1 = undefined
//   → MP 端图片 src 为空（真机不显示），而 Web 正常（编译期 inject 保留变量）。见 S33 / S57。
const img1 = ref('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjN2M1Y2ZmIi8+PGNpcmNsZSBjeD0iMTAwIiBjeT0iMTAwIiByPSI1MiIgZmlsbD0iI2ZmZmZmZiIgb3BhY2l0eT0iMC45Ii8+PC9zdmc+')
const img2 = ref('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMjJiNTczIi8+PHBhdGggZD0iTTEwMCAyMiBMMTUwIDc4IEw1MCA3OCBaIiBmaWxsPSIjZmZmZmZmIiBvcGFjaXR5PSIwLjkyIi8+PC9zdmc+')
const loaded = ref('等待图片 load 事件…')
function onLoad() {
  loaded.value = '✅ load 事件已触发（图片载入完成）'
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
    "src",
    "资源地址（网络/本地/临时路径）",
    "String"
  ],
  [
    "alt",
    "替代文本（图片加载失败/无障碍）",
    "String"
  ],
  [
    "mode",
    "模式/裁剪方式（各组件枚举见类型列）",
    "String"
  ],
  [
    "lazyLoad",
    "懒加载（进入视口才加载资源）",
    "Boolean"
  ],
  [
    "placeholder",
    "占位提示文本",
    "String"
  ],
  [
    "showMenuByLongpress",
    "长按图片显示菜单（发送给朋友/保存/识别二维码等）",
    "Boolean"
  ],
  [
    "fadeIn",
    "是否渐显（Web 用 CSS 淡入动画映射）",
    "Boolean"
  ],
  [
    "preload",
    "是否预加载（设置 src 时即下载解码）",
    "Boolean"
  ],
  [
    "webp",
    "是否解析 webP 格式（默认仅网络资源）",
    "Boolean"
  ],
  [
    "referrerPolicy",
    "★官方 <cover-image> referrer-policy：请求的 referrer 策略（Web 原生 img 同名属性）",
    "String"
  ]
])
const eventRows = ref([
  [
    "load",
    "加载完成",
    "e"
  ],
  [
    "error",
    "加载/执行失败",
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
    "skyline（WebView 降级） · 原生控件映射 → <image>（L1 原语） · <cover-image>（L1 原语）"
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
  <page-shell title="p-image 图片" subtitle="内容基元 · 三种裁剪模式 + 懒加载 + 渐显">
    <demo-block index="01" title="裁剪模式（mode）" desc="aspectFill=覆盖 / widthFix=宽满自适应 / scaleToFill=拉伸填充" :has-output="false" :code="codes.fill">
      <template #demo>
        <view class="row">
  <view class="frame"><p-image :src="img1" mode="aspectFill" /></view>
  <view class="frame frame--wide"><p-image :src="img2" mode="widthFix" /></view>
  <view class="frame"><p-image :src="img1" mode="scaleToFill" /></view>
</view>
      </template>
    </demo-block>

    <demo-block index="02" title="懒加载与渐显" desc="lazy-load 进入范围才加载；fade-in 加载完成淡入（★官方 lazy-load / fade-in）" :has-output="true" :code="codes.lazy">
      <template #demo>
        <view class="frame"><p-image :src="img1" lazy-load fade-in @load="onLoad" /></view>
      </template>
      <template #output>
        <p-text class="out">{{ loaded }}</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="长按菜单" desc="show-menu-by-longpress 长按显示菜单（★官方 show-menu-by-longpress）" :has-output="false" :code="codes.menu">
      <template #demo>
        <view class="frame"><p-image :src="img1" show-menu-by-longpress /></view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.row { display: flex; flex-direction: row; align-items: flex-start; gap: var(--sp-3); flex-wrap: wrap; }
.frame { width: 100px; height: 100px; overflow: hidden; border-radius: var(--sp-radius-sm); background: #f2f2f4; }
.frame--wide { width: 200px; height: auto; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>

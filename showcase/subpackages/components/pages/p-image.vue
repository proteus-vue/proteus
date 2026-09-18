<!-- showcase/subpackages/components/pages/p-image.vue —— p-image 图片演示
     覆盖：mode 裁剪三态 / lazy-load / fade-in / show-menu-by-longpress / placeholder / 长按菜单。
     ★mode 的 Web 端由 CSS 类映射（object-fit），MP 端透传原生 mode。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PImage, PText } from '@proteus-vue/components'

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

const codes = ref({
  fill: '<p-image src="…" mode="aspectFill" />',
  lazy: '<p-image src="…" lazy-load fade-in @load="onLoad" />',
  menu: '<p-image src="…" show-menu-by-longpress />',
})

const apiRows = ref([
  ['pid', '元素标识（框架扩展，用于调试/定位）', 'string'],
  ['disabled', '禁用态（框架扩展）', 'boolean'],
  ['ariaLabel', '无障碍标签', 'string'],
  ['src', '图片资源地址（★官方 src）', 'string'],
  ['alt', '替代文本（无障碍；框架扩展）', 'string'],
  ['mode', '裁剪缩放模式：aspectFill / widthFix / scaleToFill（★官方 mode）', 'string'],
  ['lazyLoad', '懒加载（★官方 lazy-load；Web 用 loading=lazy）', 'boolean'],
  ['placeholder', '占位图（框架扩展）', 'string'],
  ['showMenuByLongpress', '长按显示菜单（★官方 show-menu-by-longpress）', 'boolean'],
  ['fadeIn', '是否渐显（★官方 fade-in；Web 用 CSS 淡入映射）', 'boolean'],
  ['preload', '是否预加载解码（★官方 preload）', 'boolean'],
  ['webp', '是否解析 webP（★官方 webp）', 'boolean'],
  ['referrerPolicy', '★官方 <cover-image> referrer-policy（Web 原生 img 同名属性）', 'string'],
  ['ariaLabel', '无障碍标签', 'string'],
])
const eventRows = ref([
  ['load', '图片载入完成（★官方 bind:load）', 'event'],
  ['error', '图片载入错误（★官方 bind:error）', 'event'],
])
const slotRows = ref([['—', 'p-image 无插槽', '—']])
</script>

<template>
  <page-shell title="p-image 图片" subtitle="内容基元 · 三种裁剪模式 + 懒加载 + 渐显">
    <demo-block index="01" title="裁剪模式（mode）" desc="aspectFill=覆盖 / widthFix=宽满自适应 / scaleToFill=拉伸填充" :code="codes.fill">
      <template #demo>
        <view class="row">
          <view class="frame"><p-image :src="img1" mode="aspectFill" /></view>
          <view class="frame frame--wide"><p-image :src="img2" mode="widthFix" /></view>
          <view class="frame"><p-image :src="img1" mode="scaleToFill" /></view>
        </view>
      </template>
    </demo-block>

    <demo-block index="02" title="懒加载与渐显" :has-output="true"
      desc="lazy-load 进入范围才加载；fade-in 加载完成淡入（★官方 lazy-load / fade-in）" :code="codes.lazy">
      <template #demo>
        <view class="frame"><p-image :src="img1" lazy-load fade-in @load="onLoad" /></view>
      </template>
      <template #output><p-text class="out">{{ loaded }}</p-text></template>
    </demo-block>

    <demo-block index="03" title="长按菜单" desc="show-menu-by-longpress 长按显示菜单（★官方 show-menu-by-longpress）" :code="codes.menu">
      <template #demo>
        <view class="frame"><p-image :src="img1" show-menu-by-longpress /></view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.row { display: flex; flex-direction: row; align-items: flex-start; gap: var(--sp-3); flex-wrap: wrap; }
.frame { width: 100px; height: 100px; overflow: hidden; border-radius: var(--sp-radius-sm); background: #f2f2f4; }
.frame--wide { width: 200px; height: auto; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>

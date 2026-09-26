<!-- showcase/subpackages/components/pages/p-scroll-view.vue —— p-scroll-view 滚动容器 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-scroll-view.md ← gen-content.mjs ← packages/components/p-scroll-view/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PScrollView, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  y: "<p-scroll-view scroll-y style=\"height:200px\">…</p-scroll-view>",
  x: "<p-scroll-view scroll-x class=\"hscroll\"><view v-for=\"…\" class=\"hchip\">…</view></p-scroll-view>",
  pos: "<p-scroll-view :scroll-top=\"scrollTop\" :scroll-with-animation=\"true\" @scroll=\"onScroll\">…</p-scroll-view>",
  threshold: "<p-scroll-view :lower-threshold=\"30\" @scrolltolower=\"onLower\">…</p-scroll-view>",
})

const items = ref(Array.from({ length: 20 }, (_, i) => `列表项 ${i + 1}`))
const hItems = ref(Array.from({ length: 8 }, (_, i) => `横向 ${i + 1}`))
const scrollTop = ref(0)
const lastEvent = ref('（滚动容器观察事件）')
const lowerCount = ref(0)

// ★scroll-top 是**受控**属性：只有值**变化**时才驱动滚动（同官方语义——设同一值不重复滚动）。
//   故 onScroll 回写当前滚动位置（手动滚动 → scrollTop 跟随），这样「回到顶部」才产生 0 的**变化**。
//   ★★但**编程滚动期间必须停止回写**：否则滚动途中的中间值（480/460…）被回写成新 prop →
//     scroll-view 又被拉回中间值 → 表现为「只往上滚一点、回不到顶」（真机实测）。
//     用 **pending 目标值**（不用定时器——避免与编译器 ref/断言规则打架，S49/S33）：
//     编程滚动设 `pending = 目标`；onScroll 到达目标即清除 pending，此后恢复回写。
const pendingScroll = ref(99999)

function commandScroll(v: number) {
  pendingScroll.value = v
  scrollTop.value = v
}
function jump(v: number) {
  commandScroll(v)
  lastEvent.value = `scroll-top 设为 ${v}`
}
function reset() {
  commandScroll(0)
  lowerCount.value = 0
  lastEvent.value = '已重置滚动位置（回到顶部）'
}
function onScroll(e: any) {
  const d = e?.detail ?? e ?? {}
  const top = Math.round(d.scrollTop ?? 0)
  const commanding = pendingScroll.value < 99999
  const arrived = Math.abs(top - pendingScroll.value) <= 1
  // 编程滚动中：到达目标才解除；期间不回写（避免与滚动动画抢控制权 → 「回不到顶」）
  if (commanding && arrived) pendingScroll.value = 99999
  const shouldSync = !commanding && scrollTop.value !== top
  if (shouldSync) scrollTop.value = top
  lastEvent.value = `scroll：top=${top} left=${Math.round(d.scrollLeft ?? 0)}`
}
function onLower() {
  lowerCount.value++
  lastEvent.value = `scrolltolower 第 ${lowerCount.value} 次（lower-threshold 触发）`
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
    "scrollX",
    "允许横向滚动",
    "Boolean"
  ],
  [
    "scrollY",
    "允许纵向滚动",
    "Boolean"
  ],
  [
    "scrollTop",
    "纵向滚动位置（px）",
    "[Number, String]"
  ],
  [
    "scrollLeft",
    "横向滚动位置（px）",
    "[Number, String]"
  ],
  [
    "upperThreshold",
    "—",
    "[Number, String]"
  ],
  [
    "lowerThreshold",
    "距底部多少 px 触发 scrolltolower 事件",
    "[Number, String]"
  ],
  [
    "scrollIntoView",
    "—",
    "String"
  ],
  [
    "scrollIntoViewOffset",
    "—",
    "Number"
  ],
  [
    "scrollWithAnimation",
    "—",
    "Boolean"
  ],
  [
    "enableBackToTop",
    "—",
    "Boolean"
  ],
  [
    "enablePassive",
    "—",
    "Boolean"
  ],
  [
    "refresherEnabled",
    "启用自定义下拉刷新",
    "Boolean"
  ],
  [
    "refresherThreshold",
    "—",
    "Number"
  ],
  [
    "refresherDefaultStyle",
    "—",
    "String"
  ],
  [
    "refresherBackground",
    "—",
    "String"
  ],
  [
    "refresherTriggered",
    "—",
    "Boolean"
  ],
  [
    "bounces",
    "—",
    "Boolean"
  ],
  [
    "showScrollbar",
    "—",
    "Boolean"
  ],
  [
    "fastDeceleration",
    "—",
    "Boolean"
  ],
  [
    "scrollAnchoring",
    "—",
    "Boolean"
  ],
  [
    "type",
    "类型变体",
    "String"
  ],
  [
    "associativeContainer",
    "—",
    "String"
  ],
  [
    "reverse",
    "—",
    "Boolean"
  ],
  [
    "clip",
    "—",
    "Boolean"
  ],
  [
    "cacheExtent",
    "—",
    "Number"
  ],
  [
    "minDragDistance",
    "—",
    "Number"
  ],
  [
    "scrollIntoViewWithinExtent",
    "—",
    "Boolean"
  ],
  [
    "scrollIntoViewAlignment",
    "—",
    "String"
  ],
  [
    "padding",
    "—",
    "Array"
  ],
  [
    "refresherTwoLevelEnabled",
    "—",
    "Boolean"
  ],
  [
    "refresherTwoLevelTriggered",
    "—",
    "Boolean"
  ],
  [
    "refresherTwoLevelThreshold",
    "—",
    "Number"
  ],
  [
    "refresherTwoLevelCloseThreshold",
    "—",
    "Number"
  ],
  [
    "refresherTwoLevelScrollEnabled",
    "—",
    "Boolean"
  ],
  [
    "refresherBallisticRefreshEnabled",
    "—",
    "Boolean"
  ],
  [
    "refresherTwoLevelPinned",
    "—",
    "Boolean"
  ],
  [
    "enableFlex",
    "—",
    "Boolean"
  ],
  [
    "enhanced",
    "—",
    "Boolean"
  ],
  [
    "pagingEnabled",
    "—",
    "Boolean"
  ],
  [
    "usingSticky",
    "—",
    "Boolean"
  ]
])
const eventRows = ref([
  [
    "scroll",
    "滚动（eventScrollTop 归一：MP e.detail.scrollTop / Web e.target.scrollTop）",
    "—"
  ],
  [
    "scrolltoupper",
    "—",
    "—"
  ],
  [
    "scrolltolower",
    "滚动到底部（lowerThreshold 触发）",
    "—"
  ],
  [
    "refresherpulling",
    "—",
    "—"
  ],
  [
    "refresherrefresh",
    "自定义下拉刷新触发",
    "—"
  ],
  [
    "refresherrestore",
    "—",
    "—"
  ],
  [
    "refresherabort",
    "—",
    "—"
  ],
  [
    "refresherwillrefresh",
    "—",
    "—"
  ],
  [
    "refresherstatuschange",
    "—",
    "—"
  ],
  [
    "dragstart",
    "—",
    "—"
  ],
  [
    "dragging",
    "—",
    "—"
  ],
  [
    "dragend",
    "—",
    "—"
  ],
  [
    "scrollstart",
    "—",
    "—"
  ],
  [
    "scrollend",
    "—",
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
    "skyline（WebView 降级） · 原生控件映射 → <scroll-view>（L1 原语） · <sticky-header>（L2 兼容层） · <sticky-section>（L2 兼容层）"
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
  <page-shell title="p-scroll-view 滚动容器" subtitle="布局基元 · Skyline 页面滚动的唯一入口">
    <demo-block index="01" title="纵向滚动" desc="scroll-y 纵向滚动；@scroll 回显位置" :has-output="true" :code="codes.y">
      <template #demo>
        <p-scroll-view class="scroll-y" scroll-y @scroll="onScroll" @scrolltolower="onLower">
  <p-text v-for="it in items" :key="it" class="item">{{ it }}</p-text>
</p-scroll-view>
      </template>
      <template #output>
        <p-text class="out">{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="横向滚动" desc="scroll-x + enable-flex（Skyline 下 scroll-view 内横向排列需 enable-flex + flex row；子项用原生 view）" :has-output="false" :code="codes.x">
      <template #demo>
        <!-- ★横向子项用**原生 <view>**（不是自定义组件）——Skyline 下自定义组件宿主在 flex 容器里不可靠；
     容器加内层 flex row wrapper（scroll-view 自身是滚动宿主，横向内容放其内层 view） -->
<p-scroll-view class="scroll-x" scroll-x :scroll-y="false" enable-flex>
  <view class="scroll-x__inner">
    <view v-for="it in hItems" :key="it" class="chip">{{ it }}</view>
  </view>
</p-scroll-view>
      </template>
    </demo-block>

    <demo-block index="03" title="滚动位置控制" desc="scroll-top 受控：值变化时驱动滚动（同官方语义）" :has-output="true" :code="codes.pos">
      <template #demo>
        <view class="col">
  <p-scroll-view class="scroll-y" scroll-y :scroll-top="scrollTop" :scroll-with-animation="true" @scroll="onScroll">
    <p-text v-for="it in items" :key="it" class="item">{{ it }}</p-text>
  </p-scroll-view>
  <view class="row">
    <p-button size="mini" @click="jump(200)">滚到 200</p-button>
    <p-button size="mini" @click="reset">回到顶部</p-button>
  </view>
</view>
      </template>
      <template #output>
        <p-text class="out">{{ lastEvent }}</p-text>
      </template>
    </demo-block>

    <demo-block index="04" title="触底阈值" desc="lower-threshold 控制触底触发距离；@scrolltolower 回显" :has-output="true" :code="codes.threshold">
      <template #demo>
        <p-scroll-view class="scroll-y" scroll-y :lower-threshold="30" @scrolltolower="onLower">
  <p-text v-for="it in items" :key="it" class="item">{{ it }}</p-text>
</p-scroll-view>
      </template>
      <template #output>
        <p-text class="out">scrolltolower 触发次数：{{ lowerCount }}</p-text>
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
.row { display: flex; flex-direction: row; gap: var(--sp-3); }
.scroll-y { height: 180px; border: 1px solid var(--p-border, #e5e5e5); border-radius: var(--sp-radius-sm); background: #fff; }
/* ★横向滚动：容器**不设 flex**（scroll-view 是滚动宿主）；内层 wrapper 用 flex row 不换行承载子项；
   ★不用后代/复合选择器做布局（Skyline 剔除）——各元素单类各自声明。 */
/* ★横向 scroll-view 必须有**确定高度**（同竖向需确定宽度）：Skyline 下 scroll-view 无固定高会塌成一条线
   → 内容被裁、「看不到」（真机实测：加 height 前是细线，加后正常）。chips 40 + margin 16 = 56 */
.scroll-x { width: 100%; height: 56px; border: 1px solid var(--p-border, #e5e5e5); border-radius: var(--sp-radius-sm); background: #fff; overflow: hidden; }
.scroll-x__inner { display: inline-flex; flex-direction: row; white-space: nowrap; }
.item { display: block; padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid #f0f0f2; }
.chip { flex: none; display: flex; align-items: center; padding: var(--sp-2) var(--sp-4); margin: var(--sp-2); background: #eef2ff; border-radius: var(--sp-radius-sm); white-space: nowrap; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>

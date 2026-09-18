<!-- showcase/subpackages/components/pages/p-scroll-view.vue —— p-scroll-view 滚动容器演示
     覆盖：纵向滚动 / 横向滚动 / 滚动位置(scroll-top) / scroll-into-view / 阈值(upper/lower-threshold) /
           下拉刷新(refresher-*) / 滚动事件回显。
     ★Skyline 必备：页面禁全局滚动，滚动须用本容器。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PScrollView, PText, PButton } from '@proteus-vue/components'

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

const codes = ref({
  y: '<p-scroll-view scroll-y style="height:200px">…</p-scroll-view>',
  x: '<p-scroll-view scroll-x class="hscroll"><view v-for="…" class="hchip">…</view></p-scroll-view>',
  pos: '<p-scroll-view :scroll-top="scrollTop" :scroll-with-animation="true" @scroll="onScroll">…</p-scroll-view>',
  threshold: '<p-scroll-view :lower-threshold="30" @scrolltolower="onLower">…</p-scroll-view>',
})

const apiRows = ref([
  ['pid', '元素标识（框架扩展，用于调试/定位）', 'string'],
  ['disabled', '禁用态（框架扩展）', 'boolean'],
  ['ariaLabel', '无障碍标签', 'string'],
  ['scrollX', '允许横向滚动（★官方 scroll-x）', 'boolean'],
  ['scrollY', '允许纵向滚动（★官方 scroll-y，默认 true）', 'boolean'],
  ['scrollTop', '设置竖向滚动位置（★官方 scroll-top）', 'number | string'],
  ['scrollLeft', '设置横向滚动位置（★官方 scroll-left）', 'number | string'],
  ['upperThreshold', '距顶多远触发 scrolltoupper（★官方 upper-threshold）', 'number | string'],
  ['lowerThreshold', '距底多远触发 scrolltolower（★官方 lower-threshold）', 'number | string'],
  ['scrollIntoView', '滚动到指定 id 子元素（★官方 scroll-into-view）', 'string'],
  ['scrollIntoViewOffset', 'scroll-into-view 的额外偏移（★官方，Skyline 3.1.0+）', 'number'],
  ['scrollWithAnimation', '滚动位置变化用动画过渡（★官方 scroll-with-animation）', 'boolean'],
  ['enableBackToTop', '点击状态栏/标题栏回到顶部（★官方 enable-back-to-top）', 'boolean'],
  ['enablePassive', '开启 passive 优化滚动性能（★官方 enable-passive）', 'boolean'],
  ['refresherEnabled', '开启自定义下拉刷新（★官方 refresher-enabled）', 'boolean'],
  ['refresherThreshold', '下拉刷新阈值（★官方 refresher-threshold）', 'number'],
  ['refresherDefaultStyle', '下拉刷新默认样式：black/white/none（★官方）', 'string'],
  ['refresherBackground', '下拉刷新区域背景色（★官方）', 'string'],
  ['refresherTriggered', '当前下拉刷新状态（★官方 refresher-triggered）', 'boolean'],
  ['bounces', 'iOS 边界弹性（★官方 bounces，需 enhanced）', 'boolean'],
  ['showScrollbar', '滚动条显隐（★官方 show-scrollbar，需 enhanced）', 'boolean'],
  ['fastDeceleration', 'iOS 滑动减速速率（★官方 fast-deceleration）', 'boolean'],
  ['scrollAnchoring', '滚动锚定，位置不随内容抖动（★官方 scroll-anchoring）', 'boolean'],
  ['type', '渲染模式（★官方 type）', 'string'],
  ['associativeContainer', '关联滚动容器（★官方 associative-container）', 'string'],
  ['reverse', '反向滚动（★官方 reverse）', 'boolean'],
  ['clip', '是否裁剪溢出（★官方 clip，默认 true）', 'boolean'],
  ['cacheExtent', '视口外渲染距离（★官方 cache-extent）', 'number'],
  ['minDragDistance', '触发滚动的最小拖动距离（★官方 min-drag-distance）', 'number'],
  ['scrollIntoViewWithinExtent', '只滚到 cacheExtent 内目标（★官方）', 'boolean'],
  ['scrollIntoViewAlignment', '目标节点在视口内位置（★官方）', 'string'],
  ['padding', '内边距 [top,right,bottom,left]（★官方 padding）', 'array'],
  ['refresherTwoLevelEnabled', '下拉二级能力（★官方 refresher-two-level-enabled）', 'boolean'],
  ['refresherTwoLevelTriggered', '打开/关闭二级（★官方）', 'boolean'],
  ['refresherTwoLevelThreshold', '下拉二级阈值（★官方）', 'number'],
  ['refresherTwoLevelCloseThreshold', '关闭二级阈值（★官方）', 'number'],
  ['refresherTwoLevelScrollEnabled', '二级状态可滑动（★官方）', 'boolean'],
  ['refresherBallisticRefreshEnabled', '惯性滚动触发刷新（★官方）', 'boolean'],
  ['refresherTwoLevelPinned', '打开二级时否定住（★官方）', 'boolean'],
  ['enableFlex', '启用 flexbox 布局（★官方 enable-flex）', 'boolean'],
  ['enhanced', '启用增强特性（★官方 enhanced，配合 ScrollViewContext）', 'boolean'],
  ['pagingEnabled', '分页滑动（★官方 paging-enabled，需 enhanced）', 'boolean'],
  ['usingSticky', '使 position:sticky 生效（★官方 using-sticky）', 'boolean'],
])
const eventRows = ref([
  ['scroll', '滚动时（★原生 bind:scroll，载荷 {scrollTop,scrollLeft,scrollHeight}）', 'event'],
  ['scrolltoupper', '滚动到顶部/左边（★原生 bind:scrolltoupper）', 'event'],
  ['scrolltolower', '滚动到底部/右边（★原生 bind:scrolltolower）', 'event'],
  ['refresherpulling', '下拉刷新被下拉（★原生 bind:refresherpulling）', 'event'],
  ['refresherrefresh', '下拉刷新被触发（★原生 bind:refresherrefresh）', 'event'],
  ['refresherrestore', '下拉刷新被复位（★原生 bind:refresherrestore）', 'event'],
  ['refresherabort', '下拉刷新被中止（★原生 bind:refresherabort）', 'event'],
  ['refresherwillrefresh', '即将触发刷新（★原生 bind:refresherwillrefresh）', 'event'],
  ['refresherstatuschange', '下拉刷新状态回调（★原生 bind:refresherstatuschange）', 'event'],
  ['dragstart', '滑动开始（★原生 bind:dragstart，需 enhanced）', 'event'],
  ['dragging', '滑动中（★原生 bind:dragging，需 enhanced）', 'event'],
  ['dragend', '滑动结束（★原生 bind:dragend，需 enhanced）', 'event'],
  ['scrollstart', '滚动开始（★原生 bind:scrollstart）', 'event'],
  ['scrollend', '滚动结束（★原生 bind:scrollend）', 'event'],
])
const slotRows = ref([['default', '滚动内容', '—']])
</script>

<template>
  <page-shell title="p-scroll-view 滚动容器" subtitle="布局基元 · Skyline 页面滚动的唯一入口">
    <demo-block index="01" title="纵向滚动" :has-output="true" desc="scroll-y 纵向滚动；@scroll 回显位置" :code="codes.y">
      <template #demo>
        <p-scroll-view class="scroll-y" scroll-y @scroll="onScroll" @scrolltolower="onLower">
          <p-text v-for="it in items" :key="it" class="item">{{ it }}</p-text>
        </p-scroll-view>
      </template>
      <template #output><p-text class="out">{{ lastEvent }}</p-text></template>
    </demo-block>

    <demo-block index="02" title="横向滚动" desc="scroll-x + enable-flex（Skyline 下 scroll-view 内横向排列需 enable-flex + flex row；子项用原生 view）" :code="codes.x">
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

    <demo-block index="03" title="滚动位置控制" :has-output="true" desc="scroll-top 受控：值变化时驱动滚动（同官方语义）" :code="codes.pos">
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
      <template #output><p-text class="out">{{ lastEvent }}</p-text></template>
    </demo-block>

    <demo-block index="04" title="触底阈值" :has-output="true" desc="lower-threshold 控制触底触发距离；@scrolltolower 回显" :code="codes.threshold">
      <template #demo>
        <p-scroll-view class="scroll-y" scroll-y :lower-threshold="30" @scrolltolower="onLower">
          <p-text v-for="it in items" :key="it" class="item">{{ it }}</p-text>
        </p-scroll-view>
      </template>
      <template #output><p-text class="out">scrolltolower 触发次数：{{ lowerCount }}</p-text></template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
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

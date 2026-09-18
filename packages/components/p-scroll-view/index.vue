<!-- src/components/p-scroll-view/index.vue —— 滚动容器（组件库 B3）
     矩阵 01 §4：Skyline 必备（页面滚动禁全局滚动）；scroll-x/y、scroll-top/left、refresher、lower-threshold
     性能约束（超大数量复用场景）：薄包装 —— 不引入组件层逻辑，事件透传，无节流/无状态
     ★2026-09-14 官方属性对齐（end-alignment 批次 2）：补齐官方 <scroll-view> 全量属性（scroll-into-view/
       upper-threshold/refresher 全家桶/enhanced 增强族/padding/type 渲染模式等）——全部透传原生，
       框架不消费（薄包装原则不破）；Web 模拟层选择性映射（见 packages/built-in-components/src/components/scroll-view.ts） -->
<template>
  <scroll-view
    class="p-scroll-view"
    :scroll-x="scrollX"
    :scroll-y="scrollY"
    :upper-threshold="upperThreshold"
    :lower-threshold="lowerThreshold"
    :scroll-top="scrollTop"
    :scroll-left="scrollLeft"
    :scroll-into-view="scrollIntoView"
    :scroll-into-view-offset="scrollIntoViewOffset"
    :scroll-with-animation="scrollWithAnimation"
    :enable-back-to-top="enableBackToTop"
    :enable-passive="enablePassive"
    :refresher-enabled="refresherEnabled"
    :refresher-threshold="refresherThreshold"
    :refresher-default-style="refresherDefaultStyle"
    :refresher-background="refresherBackground"
    :refresher-triggered="refresherTriggered"
    :bounces="bounces"
    :show-scrollbar="showScrollbar"
    :fast-deceleration="fastDeceleration"
    :scroll-anchoring="scrollAnchoring"
    :type="type"
    :associative-container="associativeContainer"
    :reverse="reverse"
    :clip="clip"
    :cache-extent="cacheExtent"
    :min-drag-distance="minDragDistance"
    :scroll-into-view-within-extent="scrollIntoViewWithinExtent"
    :scroll-into-view-alignment="scrollIntoViewAlignment"
    :padding="padding"
    :refresher-two-level-enabled="refresherTwoLevelEnabled"
    :refresher-two-level-triggered="refresherTwoLevelTriggered"
    :refresher-two-level-threshold="refresherTwoLevelThreshold"
    :refresher-two-level-close-threshold="refresherTwoLevelCloseThreshold"
    :refresher-two-level-scroll-enabled="refresherTwoLevelScrollEnabled"
    :refresher-ballistic-refresh-enabled="refresherBallisticRefreshEnabled"
    :refresher-two-level-pinned="refresherTwoLevelPinned"
    :enable-flex="enableFlex"
    :enhanced="enhanced"
    :paging-enabled="pagingEnabled"
    :using-sticky="usingSticky"
    @scroll="onScroll"
    @scrolltoupper="onScrollToUpper"
    @scrolltolower="onScrollToLower"
    @refresherpulling="onRefresherPulling"
    @refresherrefresh="onRefresherRefresh"
    @refresherrestore="onRefresherRestore"
    @refresherabort="onRefresherAbort"
    @refresherwillrefresh="onRefresherWillRefresh"
    @refresherstatuschange="onRefresherStatusChange"
    @dragstart="onDragStart"
    @dragging="onDragging"
    @dragend="onDragEnd"
    @scrollstart="onScrollStart"
    @scrollend="onScrollEnd"
  >
    <slot />
  </scroll-view>
</template>

<script setup lang="ts">
defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  // ── 基础滚动方向与位置 ──
  scrollX: { type: Boolean, default: false },
  scrollY: { type: Boolean, default: true },
  scrollTop: { type: [Number, String], default: 0 },
  scrollLeft: { type: [Number, String], default: 0 },
  upperThreshold: { type: [Number, String], default: 50 },
  lowerThreshold: { type: [Number, String], default: 50 },
  // ── ★官方 <scroll-view> 属性（2026-09-14 对齐） ──
  scrollIntoView: { type: String, default: '' },
  scrollIntoViewOffset: { type: Number, default: 0 },
  scrollWithAnimation: { type: Boolean, default: false },
  enableBackToTop: { type: Boolean, default: false },
  enablePassive: { type: Boolean, default: false },
  // ── 自定义下拉刷新 ——
  refresherEnabled: { type: Boolean, default: false },
  refresherThreshold: { type: Number, default: 45 },
  refresherDefaultStyle: { type: String, default: 'black' },
  refresherBackground: { type: String, default: 'transparent' },
  refresherTriggered: { type: Boolean, default: false },
  // ── iOS 交互增强族（需同时开启 enhanced） ──
  bounces: { type: Boolean, default: true },
  showScrollbar: { type: Boolean, default: false },
  fastDeceleration: { type: Boolean, default: false },
  scrollAnchoring: { type: Boolean, default: false },
  // ── Skyline 渲染模式与高级滚动 ──
  type: { type: String, default: '' },
  associativeContainer: { type: String, default: '' },
  reverse: { type: Boolean, default: false },
  clip: { type: Boolean, default: true },
  cacheExtent: { type: Number, default: 0 },
  minDragDistance: { type: Number, default: 0 },
  scrollIntoViewWithinExtent: { type: Boolean, default: false },
  scrollIntoViewAlignment: { type: String, default: '' },
  padding: { type: Array, default: [] },
  // ── 下拉二级能力（refresher-two-level-*） ──
  refresherTwoLevelEnabled: { type: Boolean, default: false },
  refresherTwoLevelTriggered: { type: Boolean, default: false },
  refresherTwoLevelThreshold: { type: Number, default: 150 },
  refresherTwoLevelCloseThreshold: { type: Number, default: 80 },
  refresherTwoLevelScrollEnabled: { type: Boolean, default: false },
  refresherBallisticRefreshEnabled: { type: Boolean, default: false },
  refresherTwoLevelPinned: { type: Boolean, default: false },
  // ── flex / 增强 / 分页 / sticky ──
  enableFlex: { type: Boolean, default: false },
  enhanced: { type: Boolean, default: false },
  pagingEnabled: { type: Boolean, default: false },
  usingSticky: { type: Boolean, default: false },
})

// 事件名与 MP 原生 bind:<name> 对齐（跨端同名；Web 局部映射）。
// ★defineEmits 必须**单行**（编译器单行正则提取，见 02-ir-prop-binding.md §4.3）
const emit = defineEmits(['scroll', 'scrolltoupper', 'scrolltolower', 'refresherpulling', 'refresherrefresh', 'refresherrestore', 'refresherabort', 'refresherwillrefresh', 'refresherstatuschange', 'dragstart', 'dragging', 'dragend', 'scrollstart', 'scrollend'])

// ★载荷归一（跨端裸载荷约定）：MP 原生事件 e={detail:{scrollTop,…}}；Web 模拟层已发裸载荷。
//   emit 出去经 triggerEvent 会再包一层 detail → 若直接 emit(e) 则父级 e.detail.scrollTop 为 undefined
//   （真机「scroll 数字不变化」根因）。这里统一取 `e?.detail ?? e`，两端父级都读 e.detail.*。
function normalize(e: unknown): unknown {
  const p = e as { detail?: unknown }
  return p && typeof p === 'object' && 'detail' in p ? p.detail : e
}
function onScroll(e: unknown) { emit('scroll', normalize(e)) }
function onScrollToUpper(e: unknown) { emit('scrolltoupper', normalize(e)) }
function onScrollToLower(e: unknown) { emit('scrolltolower', normalize(e)) }
function onRefresherPulling(e: unknown) { emit('refresherpulling', normalize(e)) }
function onRefresherRefresh(e: unknown) { emit('refresherrefresh', normalize(e)) }
function onRefresherRestore(e: unknown) { emit('refresherrestore', normalize(e)) }
function onRefresherAbort(e: unknown) { emit('refresherabort', normalize(e)) }
function onRefresherWillRefresh(e: unknown) { emit('refresherwillrefresh', normalize(e)) }
function onRefresherStatusChange(e: unknown) { emit('refresherstatuschange', normalize(e)) }
function onDragStart(e: unknown) { emit('dragstart', normalize(e)) }
function onDragging(e: unknown) { emit('dragging', normalize(e)) }
function onDragEnd(e: unknown) { emit('dragend', normalize(e)) }
function onScrollStart(e: unknown) { emit('scrollstart', normalize(e)) }
function onScrollEnd(e: unknown) { emit('scrollend', normalize(e)) }
</script>

<style scoped>
/* ★不给根节点设 display/overflow（2026-09-14 横向滚动修复）：此前 `display:block;overflow:auto` 会与
   页面侧 `.scroll-x{display:flex}` **同特异性竞争**（apply-shared 下顺序不定）→ 横向 flex 被 block 覆盖。
   scroll-view 本身即块级、原生负责溢出滚动；Web 模拟层按 scroll-x/y 直接设 inline overflow。此处仅保证宽度。 */
.p-scroll-view {
  width: 100%;
}
</style>

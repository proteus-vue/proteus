<!--
  css-conformance/pages/position-scroll.vue —— CSS 验收 · 定位族（**滚动锚定**）

  【为什么要单独一页】fixed/sticky 的语义只在**滚动**时可见（页顶时与静态无异）——
   现有 position.vue 假设"装进视口"，无法体现。本页刻意做**高于视口**的内容：
     · case-fixed  ：`position:fixed`（视口锚定）——滚动时**屏幕位置不变**（右上角徽标）。
     · case-sticky ：`position:sticky; top:0`——滚动到阈值后**吸附顶部**；未到阈值时随流。
   【判据（Web 为基准）】页顶截图 vs **滚动后截图** 逐端比对：
     fixed 徽标两图同屏幕位置（钉住）；sticky 条滚动后吸在 top=0。
   【★诚实边界】sticky 在 MP/Skyline 引擎锁死（官方属性表无 sticky）；fixed 全端支持。
-->
<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 定位（滚动锚定）</text>
    <text class="cc-page__sub">position: fixed / sticky · 滚动后钉住（不随内容）</text>

    <!-- 固定徽标（视口锚定：滚动时屏幕位置不变） -->
    <view id="case-fixed" class="fixed-badge"><text class="badge-t">FIXED</text></view>

    <!-- 吸顶条（滚动到阈值 top:0 后吸附） -->
    <view id="case-sticky" class="sticky-bar"><text class="bar-t">STICKY 吸顶条</text></view>

    <!-- 可滚动内容（撑高页面 —— 静态行，避免依赖 v-for 的编译面） -->
    <text class="cc-sec">滚动内容（撑高页面）</text>
    <view class="cc-card">
      <view class="row"><text class="row-t">行 01</text></view>
      <view class="row"><text class="row-t">行 02</text></view>
      <view class="row"><text class="row-t">行 03</text></view>
      <view class="row"><text class="row-t">行 04</text></view>
      <view class="row"><text class="row-t">行 05</text></view>
      <view class="row"><text class="row-t">行 06</text></view>
      <view class="row"><text class="row-t">行 07</text></view>
      <view class="row"><text class="row-t">行 08</text></view>
      <view class="row"><text class="row-t">行 09</text></view>
      <view class="row"><text class="row-t">行 10</text></view>
      <view class="row"><text class="row-t">行 11</text></view>
      <view class="row"><text class="row-t">行 12</text></view>
      <view class="row"><text class="row-t">行 13</text></view>
      <view class="row"><text class="row-t">行 14</text></view>
      <view class="row"><text class="row-t">行 15</text></view>
    </view>
  </view>
</template>

<style scoped>
/* proteus-allow-profile: 本页验**滚动锚定**（fixed/sticky）。`position:fixed` 全端支持；
   `position:sticky` 是 **MP/Skyline 具名引擎边界**（官方属性表无 sticky）——本页 sticky 仅在 Web/App 端生效，
   MP 端如实不支持（与 justify-self/line-clamp 同族的「引擎锁死」豁免，非跳过端）。 */
.cc-page__title { font-size: 20px; font-weight: 700; }
.cc-page__sub { font-size: 12px; color: #6b7280; }

/* fixed 徽标：视口右上角锚定（滚动时屏幕位置不变） */
.fixed-badge { position: fixed; top: 8px; right: 8px; width: 72px; height: 28px; background-color: #d64545; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
.badge-t { color: #ffffff; font-size: 12px; font-weight: 600; }

/* sticky 吸顶条：滚动到阈值后吸附 top:0 */
.sticky-bar { position: sticky; top: 0; height: 36px; background-color: #5b5bd6; display: flex; align-items: center; padding-left: 10px; }
.bar-t { color: #ffffff; font-size: 13px; font-weight: 600; }

.row { height: 48px; display: flex; align-items: center; padding-left: 12px; border-bottom: 1px solid #e6e8f0; }
.row-t { font-size: 13px; color: #1a1c22; }
</style>

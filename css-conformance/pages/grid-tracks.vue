<!--
  css-conformance/pages/grid-tracks.vue —— CSS 验收 · 网格轨道/放置

  【验收对象】grid-template-columns · grid-template-rows · grid-column · grid-row
    （grid-auto-* / grid-template-areas / grid-auto-flow / justify-self / place-items 见各自页）
  【判据（Web 为基准）】每案例稳定 id —— 逐端按 id 定位并与 Web 并排比对。
  【案例即真实业务形态】两栏布局（1fr 2fr）/ 跨列卡片（span）/ 固定行高网格。
-->
<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 网格轨道</text>
    <text class="cc-page__sub">grid-template-columns / rows · grid-column / grid-row（span）· Web 基准</text>

    <!-- A：grid-template-columns（1fr 2fr） -->
    <text class="cc-sec">A · grid-template-columns: 1fr 2fr</text>
    <view class="cc-card">
      <view id="case-grid-tracks" class="g-cols">
        <view class="gi gi--a"><text class="t t--w">1fr</text></view>
        <view class="gi gi--b"><text class="t t--w">2fr</text></view>
      </view>
    </view>

    <!-- B：grid-template-rows（固定行高） -->
    <text class="cc-sec">B · grid-template-rows</text>
    <view class="cc-card">
      <view id="case-grid-rows" class="g-rows">
        <view class="gi gi--a"><text class="t t--w">r1</text></view>
        <view class="gi gi--c"><text class="t t--w">r2</text></view>
      </view>
    </view>

    <!-- C：grid-column span（跨列） -->
    <text class="cc-sec">C · grid-column: span 2（跨列）</text>
    <view class="cc-card">
      <view id="case-grid-column" class="g-span">
        <view class="gi gi--a"><text class="t t--w">span 2</text></view>
        <view class="gi gi--b"><text class="t t--w">a</text></view>
        <view class="gi gi--c"><text class="t t--w">b</text></view>
      </view>
    </view>

    <!-- D：grid-row span（跨行） -->
    <text class="cc-sec">D · grid-row: span 2</text>
    <view class="cc-card">
      <view id="case-grid-row" class="g-rowspan">
        <view class="gi gi--a gi--row2"><text class="t t--w">row span2</text></view>
        <view class="gi gi--b"><text class="t t--w">x</text></view>
        <view class="gi gi--c"><text class="t t--w">y</text></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.t { font-size: 12px; }
.t--w { color: #ffffff; }
.gi { height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 6px; }
.gi--a { background-color: #5b5bd6; }
.gi--b { background-color: #2e7d5b; }
.gi--c { background-color: #b8722c; }

.g-cols { display: grid; grid-template-columns: 1fr 2fr; gap: 8px; }
.g-rows { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 56px 40px; gap: 8px; }
.g-span { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.g-rowspan { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 40px; gap: 8px; }
.gi--row2 { grid-row: span 2; height: 88px; }
</style>

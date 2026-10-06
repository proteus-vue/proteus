<!--
  css-conformance/pages/effects.vue —— CSS 验收 · 视觉效果族

  【验收对象】opacity · box-shadow · transform（translate/rotate/scale）· transform-origin ·
    aspect-ratio · visibility
  【判据（Web 为基准）】每案例稳定 id —— 逐端按 id 定位并与 Web 并排比对。
  【案例即真实业务形态】半透明遮罩 / 卡片投影 / 旋转徽标 / 固定宽高比缩略图 / 隐藏占位。
-->
<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 视觉效果</text>
    <text class="cc-page__sub">opacity / box-shadow / transform / transform-origin / aspect-ratio / visibility</text>

    <!-- A：opacity -->
    <text class="cc-sec">A · opacity（不透明度）</text>
    <view class="cc-card">
      <view class="fx-row">
        <view id="case-opacity" class="op-box"><text class="t t--w">0.5</text></view>
        <view class="op-box op-solid"><text class="t t--w">1.0</text></view>
      </view>
    </view>

    <!-- B：box-shadow -->
    <text class="cc-sec">B · box-shadow（投影）</text>
    <view class="cc-card">
      <view id="case-box-shadow" class="sh-box"><text class="t">box-shadow 0 4px 12px</text></view>
    </view>

    <!-- C：transform（平移/缩放/旋转） -->
    <text class="cc-sec">C · transform（translate / scale / rotate）</text>
    <view class="cc-card">
      <view class="fx-row">
        <view id="case-transform" class="tf-box"><text class="t t--w">rotate 10°</text></view>
        <view class="tf-scaled"><text class="t t--w">scale 1.2</text></view>
      </view>
    </view>

    <!-- D：transform-origin（变换锚点） -->
    <text class="cc-sec">D · transform-origin（锚点）</text>
    <view class="cc-card">
      <view id="case-transform-origin" class="to-box"><text class="t t--w">origin 0 0</text></view>
    </view>

    <!-- E：aspect-ratio（宽高比） -->
    <text class="cc-sec">E · aspect-ratio（宽高比）</text>
    <view class="cc-card">
      <view id="case-aspect-ratio" class="ar-box"><text class="t">16 / 9</text></view>
    </view>

    <!-- F：visibility（保留占位） -->
    <text class="cc-sec">F · visibility: hidden（占位但不可见）</text>
    <view class="cc-card">
      <view id="case-visibility" class="vis-box"><text class="t">hidden（仍占位）</text></view>
      <view class="vis-after"><text class="t">（下方内容未被挤走）</text></view>
    </view>
  </view>
</template>

<style scoped>
.t { font-size: 12px; color: #1a1c22; }
.t--w { color: #ffffff; }
.fx-row { display: flex; flex-direction: row; gap: 16px; }

.op-box { width: 72px; height: 44px; background-color: #5b5bd6; display: flex; align-items: center; justify-content: center; opacity: 0.5; }
.op-solid { opacity: 1; }
.sh-box { width: 160px; height: 48px; border-radius: 8px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18); display: flex; align-items: center; justify-content: center; }
.tf-box { width: 84px; height: 44px; background-color: #4b78c8; display: flex; align-items: center; justify-content: center; transform: rotate(10deg); }
.tf-scaled { width: 84px; height: 44px; background-color: #2e7d5b; display: flex; align-items: center; justify-content: center; transform: scale(1.2); }
.to-box { width: 90px; height: 44px; background-color: #b8722c; display: flex; align-items: center; justify-content: center; transform-origin: 0 0; transform: rotate(12deg); }
.ar-box { width: 160px; aspect-ratio: 16 / 9; background-color: #eef0f6; display: flex; align-items: center; justify-content: center; }
.vis-box { height: 36px; background-color: #cdd3ef; display: flex; align-items: center; visibility: hidden; }
.vis-after { height: 36px; background-color: #e6e8f4; display: flex; align-items: center; }
</style>

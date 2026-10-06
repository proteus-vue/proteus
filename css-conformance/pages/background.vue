<!--
  css-conformance/pages/background.vue —— CSS 验收 · 背景族

  【验收对象】background-color · background-image（线性/径向渐变子集）· background-size ·
    background-repeat · background（简写）
  【判据（Web 为基准）】每案例稳定 id —— 逐端按 id 定位并与 Web 并排比对。
  【案例即真实业务形态】纯色底 / 品牌渐变头图 / 平铺图案 / 简写声明。
-->
<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 背景</text>
    <text class="cc-page__sub">background color / image（渐变）/ size / repeat / shorthand · Web 基准</text>

    <!-- A：background-color -->
    <text class="cc-sec">A · background-color（纯色）</text>
    <view class="cc-card">
      <view id="case-bg-color" class="bg-color"><text class="t t--w">#5b5bd6</text></view>
    </view>

    <!-- B：background-image linear-gradient（品牌渐变） -->
    <text class="cc-sec">B · background-image: linear-gradient（线性渐变）</text>
    <view class="cc-card">
      <view id="case-bg-image" class="bg-image"><text class="t t--w">linear-gradient</text></view>
    </view>

    <!-- C：background-size + repeat（平铺） -->
    <text class="cc-sec">C · background-size / background-repeat（平铺）</text>
    <view class="cc-card">
      <view id="case-bg-repeat" class="bg-repeat"></view>
    </view>

    <!-- D：background 简写 -->
    <text class="cc-sec">D · background（简写：color + image）</text>
    <view class="cc-card">
      <view id="case-bg-shorthand" class="bg-shorthand"><text class="t">shorthand</text></view>
    </view>
  </view>
</template>

<style scoped>
.t { font-size: 12px; color: #1a1c22; }
.t--w { color: #ffffff; }

.bg-color { height: 56px; background-color: #5b5bd6; display: flex; align-items: center; padding-left: 12px; }
.bg-image { height: 56px; background-image: linear-gradient(to right, #5b5bd6, #2e7d5b); display: flex; align-items: center; padding-left: 12px; }
.bg-repeat {
  height: 56px;
  background-color: #eef0f6;
  background-image: linear-gradient(45deg, #cdd3ef 25%, transparent 25%, transparent 75%, #cdd3ef 75%);
  background-size: 16px 16px;
  background-repeat: repeat;
}
.bg-shorthand { height: 56px; background: #eef0f6; display: flex; align-items: center; padding-left: 12px; }
</style>

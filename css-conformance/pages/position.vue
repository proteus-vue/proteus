<!--
  css-conformance/pages/position.vue —— CSS 验收 · 定位族

  【验收对象】position（relative / absolute）· top / right / bottom / left · inset（简写）· z-index
  【判据（Web 为基准）】每案例稳定 id —— 逐端按 id 定位并与 Web 并排比对。
  【案例即真实业务形态】相对偏移的徽标 / 绝对定位角标 / 覆盖层 / 叠放次序。
-->
<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 定位</text>
    <text class="cc-page__sub">position / top·right·bottom·left / inset / z-index · Web 基准</text>

    <!-- A：position relative + 偏移（原地占位，视觉位移） -->
    <text class="cc-sec">A · position: relative + top/left</text>
    <view class="cc-card">
      <view id="case-relative" class="rel-host">
        <view class="rel-box"><text class="t">relative 未偏移</text></view>
        <view class="rel-box rel-shift"><text class="t">relative top:6 left:20</text></view>
      </view>
    </view>

    <!-- B：position absolute + right/bottom（相对定位祖先） -->
    <text class="cc-sec">B · position: absolute + right/bottom（角标）</text>
    <view class="cc-card">
      <view id="case-absolute" class="abs-host">
        <text class="t">容器（position:relative 祖先）</text>
        <view class="abs-badge"><text class="t t--w">badge</text></view>
      </view>
    </view>

    <!-- C：inset 简写（四边同时归零 ⇒ 铺满容器） -->
    <text class="cc-sec">C · inset: 0（四边铺满）</text>
    <view class="cc-card">
      <view id="case-inset" class="inset-host">
        <view class="inset-overlay"><text class="t t--w">inset: 0 overlay</text></view>
      </view>
    </view>

    <!-- D：z-index 叠放（数值大者在上） -->
    <text class="cc-sec">D · z-index（叠放次序）</text>
    <view class="cc-card">
      <view id="case-zindex" class="z-host">
        <view class="z-low"><text class="t t--w">z:1</text></view>
        <view class="z-high"><text class="t t--w">z:2</text></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.t { font-size: 12px; color: #1a1c22; }
.t--w { color: #ffffff; }

.rel-host { height: 84px; }
.rel-box { width: 160px; height: 30px; background-color: #e6e8f4; display: flex; align-items: center; padding-left: 8px; }
.rel-shift { position: relative; top: 6px; left: 20px; background-color: #cdd3ef; }

.abs-host { position: relative; height: 72px; background-color: #eef0f6; display: flex; align-items: center; padding-left: 10px; }
.abs-badge { position: absolute; right: 6px; bottom: 6px; padding: 3px 8px; background-color: #d64545; border-radius: 8px; }

.inset-host { position: relative; height: 64px; background-color: #eef0f6; }
.inset-overlay { position: absolute; inset: 0; background-color: rgba(91, 91, 214, 0.55); display: flex; align-items: center; justify-content: center; }

.z-host { position: relative; height: 64px; }
.z-low { position: absolute; left: 8px; top: 8px; width: 120px; height: 40px; background-color: #4b78c8; z-index: 1; display: flex; align-items: center; justify-content: center; }
.z-high { position: absolute; left: 60px; top: 20px; width: 120px; height: 40px; background-color: #2e7d5b; z-index: 2; display: flex; align-items: center; justify-content: center; }
</style>

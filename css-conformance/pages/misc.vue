<!--
  css-conformance/pages/misc.vue —— CSS 验收 · 杂项能力

  【验收对象】pointer-events · object-fit · mask（覆盖尚未有专页的已实现、非 L3 能力）
  【判据（Web 为基准）】每案例稳定 id —— 逐端按 id 定位并与 Web 并排比对。
  【★诚实边界】`filter` / `backdrop-filter` 属 **L3（opt-in，各占一块 backing store）**——本工程未 opt-in
    （E-CSS-002）⇒ **不设案例**；`container-type` 是 @container 的**使能器**（单独折叠 = no-op，无渲染输出）
    ⇒ 不设案例。二者见清单 `filter-backdrop` / `container-type` 行。
  【案例即真实业务形态】禁用态穿透（pointer-events）/ 头像裁剪（object-fit）/ 渐隐遮罩（mask）。
-->
<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 杂项</text>
    <text class="cc-page__sub">pointer-events / object-fit / mask</text>

    <!-- A：pointer-events: none（禁用但可见） -->
    <text class="cc-sec">A · pointer-events: none（禁用穿透）</text>
    <view class="cc-card">
      <view id="case-pointer-events" class="pe-box"><text class="t t--w">不可点击</text></view>
    </view>

    <!-- B：object-fit（图片填充模式——组件通道） -->
    <text class="cc-sec">B · object-fit（组件通道 · image mode）</text>
    <view class="cc-card">
      <view id="case-object-fit" class="of-box"><text class="t">object-fit（图片通道）</text></view>
    </view>

    <!-- C：mask（渐变遮罩） -->
    <text class="cc-sec">C · mask（渐变遮罩）</text>
    <view class="cc-card">
      <view id="case-mask" class="mask-box"><text class="t t--w">渐隐</text></view>
    </view>
  </view>
</template>

<style scoped>
.t { font-size: 12px; color: #1a1c22; }
.t--w { color: #ffffff; }

.pe-box { width: 120px; height: 40px; background-color: #5b5bd6; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.of-box { width: 140px; height: 48px; background-color: #eef0f6; display: flex; align-items: center; justify-content: center; }
.mask-box { width: 160px; height: 48px; background-color: #2e7d5b; display: flex; align-items: center; justify-content: center; mask-image: linear-gradient(to right, #000 40%, transparent 100%); }
</style>

<!--
  css-conformance/pages/background-position.vue —— CSS 验收 · 背景定位（size / position / repeat）

  【验收对象】「背景定位」家族·静态单层（决策 #567）：
    `background-size` + `background-position` + `background-repeat`（作用于**背景图/渐变的图像盒**）。
  【Web 真值（真 Chromium 已取证，2026-10-07）】
     · `size`：长度/百分比（%=相对盒）；auto（渐变无固有尺寸 ⇒ = 定位区）。
     · `position`：关键字（left/top=0 · right/bottom=100% · center=50%）；px 直接；
       **%= pct×(盒−图)（★减图尺寸）**。
     · `repeat`：no-repeat 只画一次（在偏移处）；repeat 以**图像尺寸为砖**平铺，相位=偏移。
     · 渐变方向相对**图像盒**（不是元素盒）。
  【案例即真实业务形态】定尺寸盒内的品牌渐变块 / 偏移 / 平铺 / 百分比定位。
  【★诚实边界（页面具名）】
   ① **动画定位**（@keyframes 移动 background-position，语料 p-progress/p-skeleton）留下一批；
      本页只验**静态**声明。
   ② **多层渐变逐层定位**（语料 built-in-components）留下一批。
   ③ iOS `CAGradientLayer` **无法平铺**（无 tile 模式）⇒ 案例 C（repeat）iOS 端呈 no-repeat（具名边界；
      Android 用 TileMode.REPEAT / 鸿蒙用 CanvasDrawRect + REPEAT / Web 原生）。
-->
<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 背景定位</text>
    <text class="cc-page__sub">background-size / -position / -repeat · Web 基准 · 稳定 id 供逐端寻址</text>

    <!-- A · size 50px 50px · no-repeat · 0 0（图像盒在左上） -->
    <text class="cc-sec">A · size 50px 50px · no-repeat · 0 0</text>
    <view class="cc-card">
      <view id="case-a-size" class="bg-box bg-a"></view>
    </view>

    <!-- B · size 50px 50px · no-repeat · 25px 10px（偏移） -->
    <text class="cc-sec">B · size 50px 50px · no-repeat · 25px 10px</text>
    <view class="cc-card">
      <view id="case-b-offset" class="bg-box bg-b"></view>
    </view>

    <!-- C · size 50px 50px · repeat · 10px 10px（平铺） -->
    <text class="cc-sec">C · size 50px 50px · repeat · 10px 10px</text>
    <view class="cc-card">
      <view id="case-c-repeat" class="bg-box bg-c"></view>
    </view>

    <!-- D · size 50% 50% · no-repeat · 100% 100%（右下，%减图尺寸） -->
    <text class="cc-sec">D · size 50% 50% · no-repeat · 100% 100%</text>
    <view class="cc-card">
      <view id="case-d-pct" class="bg-box bg-d"></view>
    </view>

    <!-- E · size 400% 100% · no-repeat · 100% 50%（shimmer 静态几何：图远宽于盒） -->
    <text class="cc-sec">E · size 400% 100% · no-repeat · 100% 50%</text>
    <view class="cc-card">
      <view id="case-e-wide" class="bg-box bg-e"></view>
    </view>
  </view>
</template>

<style scoped>
/* 定位宿主盒：定尺寸 160×80（图像盒相对它定位——差异一眼可辨） */
.bg-box {
  width: 160px;
  height: 80px;
  background-color: #f2f4f8;
  box-sizing: border-box;
}
/* 渐变统一用红→蓝（90deg，相对图像盒左→右）——便于判读图像盒的边界 */
.bg-a {
  background-image: linear-gradient(90deg, #e23b3b, #2f5fd0);
  background-size: 50px 50px;
  background-repeat: no-repeat;
  background-position: 0 0;
}
.bg-b {
  background-image: linear-gradient(90deg, #e23b3b, #2f5fd0);
  background-size: 50px 50px;
  background-repeat: no-repeat;
  background-position: 25px 10px;
}
.bg-c {
  background-image: linear-gradient(90deg, #e23b3b, #2f5fd0);
  background-size: 50px 50px;
  background-repeat: repeat;
  background-position: 10px 10px;
}
.bg-d {
  background-image: linear-gradient(90deg, #e23b3b, #2f5fd0);
  background-size: 50% 50%;
  background-repeat: no-repeat;
  background-position: 100% 100%;
}
.bg-e {
  background-image: linear-gradient(90deg, #e23b3b, #2f5fd0);
  background-size: 400% 100%;
  background-repeat: no-repeat;
  background-position: 100% 50%;
}
</style>

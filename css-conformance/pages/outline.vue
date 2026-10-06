<!--
  css-conformance/pages/outline.vue —— CSS 验收 · 轮廓（outline / outline-offset）

  【验收对象】`outline` + `outline-offset`（P0 · 语料 3×）。
  【Web 真值（真 Chromium 已取证，2026-10-08）】outline = 盒**外**(offset>0)或盒**内**(offset<0)的环，
  `outline-offset` 为环与盒边的间距（正=外扩 / 负=内缩），**不占布局**（不影响盒几何）。
  【案例即真实业务形态】焦点环（键盘/遥控可达性）的三种形态 + 内缩环（被 overflow 裁场景）。
  【★诚实边界（页面具名，不隐藏）】
   ① **语料 3× 全在 `:focus-visible` 下**（焦点环）——App **不支持状态伪类** ⇒ 那些规则到不了 App
      （**具名依赖**：「交互状态伪类/focus 通道」是独立能力）。本页验**静态** outline（属性本身）。
   ② **Skyline（MP）官方属性表 110 项无 `outline`** ⇒ 引擎锁死，MP 端不画轮廓（具名边界）。
-->
<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 轮廓</text>
    <text class="cc-page__sub">outline / outline-offset · Web 基准 · 稳定 id 供逐端寻址</text>

    <!-- A · 实线环 + offset 2（盒外） -->
    <text class="cc-sec">A · solid · offset 2px（盒外）</text>
    <view class="cc-card">
      <view id="case-solid-out" class="ol-box ol-a"><text class="ol-t">A</text></view>
    </view>

    <!-- B · 虚线环 + offset 2（盒外） -->
    <text class="cc-sec">B · dashed · offset 2px（盒外）</text>
    <view class="cc-card">
      <view id="case-dashed" class="ol-box ol-b"><text class="ol-t">B</text></view>
    </view>

    <!-- C · 点线环 + offset 2（盒外） -->
    <text class="cc-sec">C · dotted · offset 2px（盒外）</text>
    <view class="cc-card">
      <view id="case-dotted" class="ol-box ol-c"><text class="ol-t">C</text></view>
    </view>

    <!-- D · 实线环 + offset -3（盒内——焦点环被 overflow 裁场景） -->
    <text class="cc-sec">D · solid · offset -3px（盒内）</text>
    <view class="cc-card">
      <view id="case-solid-in" class="ol-box ol-d"><text class="ol-t">D</text></view>
    </view>
  </view>
</template>

<style scoped>
/* 轮廓宿主盒：定尺寸 + 底色（环的形态/位置一眼可辨；flex-shrink:0 防压缩） */
.ol-box {
  width: 140px;
  height: 48px;
  background: #eef1f6;
  border-radius: 6px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.ol-t { font-size: 15px; font-weight: 700; color: #3a4052; }
.ol-a { outline: 3px solid #6f4ae8; outline-offset: 2px; }
.ol-b { outline: 3px dashed #d64545; outline-offset: 2px; }
.ol-c { outline: 3px dotted #2e9e6b; outline-offset: 2px; }
.ol-d { outline: 3px solid #ffb13d; outline-offset: -3px; }
</style>

<!--
  css-conformance/pages/box-model.vue —— CSS 验收 · 盒模型族

  【验收对象】width / height / min-width / max-width / min-height / max-height ·
    margin(-top/right/bottom/left) · padding(-top/right/bottom/left) · box-sizing
  【判据（Web 为基准）】每案例稳定 id —— 逐端按 id 定位并与 Web 并排比对。
  【案例即真实业务形态】固定卡片 / 最小宽按钮 / 间距（margin）/ 内边距（padding）/ 边框盒。
-->
<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 盒模型</text>
    <text class="cc-page__sub">width / height / min-max / margin / padding / box-sizing · Web 基准</text>

    <!-- A：width / height -->
    <text class="cc-sec">A · width / height（固定尺寸）</text>
    <view class="cc-card">
      <view id="case-width-height" class="box-fixed"><text class="t">120 × 60</text></view>
    </view>

    <!-- B：min-width / max-width -->
    <text class="cc-sec">B · min/max-width（夹紧）</text>
    <view class="cc-card">
      <view id="case-min-width" class="box-minw"><text class="t">min-width: 160px</text></view>
      <view id="case-max-width" class="box-maxw"><text class="t">max-width: 200px</text></view>
    </view>

    <!-- C：margin（逐边） -->
    <text class="cc-sec">C · margin（逐边外边距）</text>
    <view class="cc-card">
      <view id="case-margin" class="box-fixed box-margin"><text class="t">margin 8/12/4/16</text></view>
    </view>

    <!-- D：padding（逐边，含背景色可见） -->
    <text class="cc-sec">D · padding（逐边内边距）</text>
    <view class="cc-card">
      <view id="case-padding" class="box-pad"><text class="t">padding: 10px 16px 6px 14px</text></view>
    </view>

    <!-- E：box-sizing content-box vs border-box（同宽同边框 ⇒ 视觉宽度不同） -->
    <text class="cc-sec">E · box-sizing（边框盒 vs 内容盒）</text>
    <view class="cc-card">
      <view id="case-box-sizing-content" class="bs-content"><text class="t">content-box</text></view>
      <view id="case-box-sizing-border" class="bs-border"><text class="t">border-box</text></view>
    </view>
  </view>
</template>

<style scoped>
.t { font-size: 12px; color: #1a1c22; }

.box-fixed { width: 120px; height: 60px; background-color: #e6e8f4; display: flex; align-items: center; justify-content: center; }
.box-minw { min-width: 160px; height: 32px; background-color: #dfeee7; display: flex; align-items: center; }
.box-maxw { max-width: 200px; height: 32px; margin-top: 6px; background-color: #f3ead9; display: flex; align-items: center; }
.box-margin { margin: 8px 12px 4px 16px; }
.box-pad { padding: 10px 16px 6px 14px; background-color: #e6e8f4; }
.bs-content { box-sizing: content-box; width: 120px; height: 40px; border: 4px solid #5b5bd6; background-color: #eceefb; display: flex; align-items: center; }
.bs-border { box-sizing: border-box; width: 120px; height: 40px; margin-top: 8px; border: 4px solid #2e7d5b; background-color: #e3f0ea; display: flex; align-items: center; }
</style>

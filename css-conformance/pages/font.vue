<!--
  css-conformance/pages/font.vue —— CSS 验收 · 文本样式族

  【验收对象】font-size · font-weight · font-family · line-height · letter-spacing ·
    text-align · text-decoration · color
  【判据（Web 为基准）】每案例稳定 id —— 逐端按 id 定位并与 Web 并排比对。
  【案例即真实业务形态】标题层级 / 正文行距 / 字距 / 对齐 / 下划线链接 / 删除线价格。
-->
<script setup lang="ts">
// line-height 案例需真实换行（Vue 模板会压缩文本节点空白）⇒ 走 script 常量插值
const lhText = '第一行文本\n第二行文本（行高 28px）'
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 文本样式</text>
    <text class="cc-page__sub">font-size/weight/family · line-height · letter-spacing · text-align · decoration · color</text>

    <!-- A：font-size / font-weight -->
    <text class="cc-sec">A · font-size / font-weight（字号层级）</text>
    <view class="cc-card">
      <text id="case-font-size" class="s20">20px 常规</text>
      <text id="case-font-weight" class="s16-bold">16px 加粗（700）</text>
      <text id="case-font-normal" class="s14">14px 常规（400）</text>
    </view>

    <!-- B：font-family（角色映射） -->
    <text class="cc-sec">B · font-family（字体族角色）</text>
    <view class="cc-card">
      <text id="case-font-family" class="ff-mono">monospace 0123456789</text>
    </view>

    <!-- C：line-height（行高） -->
    <text class="cc-sec">C · line-height（行盒高）</text>
    <view class="cc-card">
      <text id="case-line-height" class="lh">{{ lhText }}</text>
    </view>

    <!-- D：letter-spacing（字距） -->
    <text class="cc-sec">D · letter-spacing（字距）</text>
    <view class="cc-card">
      <text id="case-letter-spacing" class="ls">字距加宽 ABCDEF</text>
    </view>

    <!-- E：text-align（对齐） -->
    <text class="cc-sec">E · text-align（left / center / right）</text>
    <view class="cc-card">
      <view id="case-text-align" class="ta-host">
        <text class="ta-l">左对齐 left</text>
        <text class="ta-c">居中 center</text>
        <text class="ta-r">右对齐 right</text>
      </view>
    </view>

    <!-- F：text-decoration + color -->
    <text class="cc-sec">F · text-decoration / color</text>
    <view class="cc-card">
      <text id="case-decoration" class="deco-underline">下划线链接</text>
      <text id="case-color" class="col-brand">品牌色文本</text>
    </view>
  </view>
</template>

<style scoped>
.cc-card { display: flex; flex-direction: column; }
.s20 { display: block; font-size: 20px; font-weight: 400; line-height: 28px; color: #1a1c22; }
.s16-bold { display: block; font-size: 16px; font-weight: 700; line-height: 24px; color: #1a1c22; }
.s14 { display: block; font-size: 14px; font-weight: 400; line-height: 22px; color: #1a1c22; }
.ff-mono { display: block; font-family: monospace; font-size: 14px; line-height: 22px; color: #4b5058; }
.lh { display: block; font-size: 14px; line-height: 28px; color: #4b5058; }
.ls { display: block; font-size: 15px; letter-spacing: 2px; color: #1a1c22; }
.ta-host { display: flex; flex-direction: column; width: 100%; }
.ta-l { display: block; font-size: 14px; text-align: left; color: #1a1c22; }
.ta-c { display: block; font-size: 14px; text-align: center; color: #1a1c22; }
.ta-r { display: block; font-size: 14px; text-align: right; color: #1a1c22; }
.deco-underline { display: block; font-size: 14px; text-decoration: underline; color: #5b5bd6; }
.col-brand { display: block; font-size: 14px; color: #d64545; }
</style>

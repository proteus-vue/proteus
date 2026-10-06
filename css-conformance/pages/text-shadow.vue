<!--
  css-conformance/pages/text-shadow.vue —— CSS 验收 · 文本阴影（text-shadow）

  【验收对象】`text-shadow`（P0 · 语料 2×——glass-demo 玻璃卡文字、p-formfactor 车机封面标题）。
  【Web 真值（真 Chromium，2026-10-08）】`text-shadow: <dx> <dy> [blur] <color>`：
     · 在**字形**后方按 offset 投影、按 blur 高斯模糊（与 box-shadow 不同：作用于**文本内容**，不是盒）；
     · 无 spread；blur 缺省 = 0（硬边投影）；可多层（本批单层）。
  【案例即真实业务形态】深色底上的浅色标题（可读性投影）+ 光晕式大模糊标题。
  【★诚实边界（页面具名，不隐藏）】
   · MP/Skyline：官方表支持 `text-shadow`，但本页验收以 App（Android/iOS/鸿蒙自绘宿主）为主承载端。
   · 多重阴影取首个（v1 单层，编译器诊断）。
-->
<script setup lang="ts">
// 纯静态页（验收只看真实渲染结果）
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 文本阴影</text>
    <text class="cc-page__sub">text-shadow · Web 基准 · 稳定 id 供逐端寻址</text>

    <!-- A · 可读性投影（小偏移 + 小模糊；深底浅字） -->
    <text class="cc-sec">A · 可读性投影（0 1px 2px）</text>
    <view class="cc-card">
      <view id="case-readability" class="ts-dark">
        <text class="ts-h ts-a">深色底标题</text>
      </view>
    </view>

    <!-- B · 光晕式（大模糊 + 无偏移；发光标题） -->
    <text class="cc-sec">B · 光晕（0 0 8px）</text>
    <view class="cc-card">
      <view id="case-glow" class="ts-dark">
        <text class="ts-h ts-b">发光标题</text>
      </view>
    </view>

    <!-- C · 硬边投影（blur 缺省 0；斜向偏移） -->
    <text class="cc-sec">C · 硬边投影（2px 2px 无模糊）</text>
    <view class="cc-card">
      <view id="case-hard" class="ts-light">
        <text class="ts-h ts-c">硬边投影</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.cc-page { background: #f4f5f7; }
.cc-card { background: #ffffff; }
.ts-dark { background: #2a2d3a; border-radius: 10px; padding: 18px 14px; display: flex; justify-content: center; }
.ts-light { background: #eef1f6; border-radius: 10px; padding: 18px 14px; display: flex; justify-content: center; }
.ts-h { font-size: 22px; font-weight: 700; color: #ffffff; }
/* A：字形后 1px 下、2px 模糊的黑投影（提升深底可读性） */
.ts-a { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
/* B：无偏移、8px 模糊的紫色光晕 */
.ts-b { color: #cfd4ff; text-shadow: 0 0 8px rgba(124, 92, 255, 0.95); }
/* C：浅底黑字 + 2px 斜向硬边投影（无模糊） */
.ts-c { color: #1a1c22; text-shadow: 2px 2px 0px rgba(90, 100, 130, 0.85); }
</style>

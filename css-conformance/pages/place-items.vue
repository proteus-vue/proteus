<!--
  css-conformance/pages/place-items.vue —— CSS 验收 · 网格容器内子项对齐（place-items / justify-items）

  【验收对象】`place-items: <align-items> <justify-items>`（简写）+ `justify-items`（长手）——**网格容器内所有子项**
  的「行内轴」对齐（CSS Box Alignment 3）。
  【Web 真值（真 Chromium）】单列 300px 网格、子项 60px 宽：
    · A `place-items: center end`  ⇒ 子项靠**右**（x=240）、垂直居中；
    · B `place-items: center`      ⇒ 子项水平居中（x=120）、垂直居中；
    · C `place-items: center start`⇒ 子项靠**左**（x=0）、垂直居中。
  【案例即真实业务形态】车机 hero 媒体构图 `place-items: center end`（媒体右中，与左文本列互不侵占）。
  【★诚实边界（页面具名，不隐藏）】
   · MP/Skyline：官方属性表**无 grid 族**，该端**无 Grid 容器** ⇒ 本页在 MP 端退化（引擎锁死，具名边界）；
     主承载端 = App（自研内核，taffy `justify_items` 原生）。
-->
<script setup lang="ts">
// 纯静态页（验收只看真实渲染结果）
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 网格子项对齐</text>
    <text class="cc-page__sub">place-items / justify-items · Web 基准 · 稳定 id 供逐端寻址</text>

    <!-- A · place-items: center end（align center / justify end ⇒ 右中） -->
    <text class="cc-sec">A · place-items: center end（右中）</text>
    <view class="cc-card">
      <view id="case-end" class="pi-box">
        <view class="pi-item"></view>
      </view>
    </view>

    <!-- B · place-items: center（两轴 center ⇒ 居中） -->
    <text class="cc-sec">B · place-items: center（居中）</text>
    <view class="cc-card">
      <view id="case-center" class="pi-box pi-center">
        <view class="pi-item"></view>
      </view>
    </view>

    <!-- C · place-items: center start（左中） -->
    <text class="cc-sec">C · place-items: center start（左中）</text>
    <view class="cc-card">
      <view id="case-start" class="pi-box pi-start">
        <view class="pi-item"></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 单列网格（显式 1 列 300px）；子项定宽 60 ⇒ 行内轴有对齐空间 */
.pi-box { display: grid; width: 300px; height: 60px; grid-template-columns: 300px; place-items: center end; }
.pi-center { place-items: center; }
.pi-start { place-items: center start; }
.pi-item { width: 60px; height: 30px; background: #5b5bd6; border-radius: 6px; }
</style>

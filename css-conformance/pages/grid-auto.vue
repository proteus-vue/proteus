<!--
  css-conformance/pages/grid-auto.vue —— CSS 验收 · 网格隐式轨道 + minmax 轨迹

  【验收对象（grid 轨迹解析升级 · 2026-10-08）】
    · `grid-auto-columns` / `grid-auto-rows`（**隐式轨道尺寸**——容器/项数超出显式模板时，自动轨道按此定尺寸）；
    · `minmax()` 轨迹（`grid-template-columns: minmax(0, 1fr) …`——语料最高频写法）。
  【Web 真值（真 Chromium）】
    · A `grid-template-columns:60px` + `grid-auto-columns:60px` + `grid-auto-flow:column`，3 项 ⇒ **3 列各 60px 并排**；
    · B `grid-template-columns:80px 80px` + `grid-auto-rows:30px`，5 项 ⇒ **3 行**（隐式行 = 30px）；
    · C `grid-template-columns:minmax(0,1fr) minmax(0,2fr)` ⇒ 两列 **1:2** 比例。
  【案例即真实业务形态】车机仪表盘瓦片（`grid-auto-flow:column` + `grid-auto-columns`）/ 紧凑列表（隐式行）。
  【★诚实边界（页面具名，不隐藏）】
   · MP/Skyline：官方属性表**无** grid 族，该端**无 Grid 容器** ⇒ 本页在 MP 端退化为堆叠（引擎锁死，具名边界，
     与 grid-auto-flow/grid-template-areas 同款）；主承载端 = App（自研内核，taffy 原生）。
-->
<script setup lang="ts">
// 纯静态页（验收只看真实渲染结果）
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 网格隐式轨道</text>
    <text class="cc-page__sub">grid-auto-columns / -rows / minmax · Web 基准 · 稳定 id 供逐端寻址</text>

    <!-- A · grid-auto-columns：显式 1 列 60px + column 流 ⇒ 隐式第 2/3 列各 60px（三列并排） -->
    <text class="cc-sec">A · grid-auto-columns（column 流 → 3 列各 60px）</text>
    <view class="cc-card">
      <view id="case-auto-cols" class="ga ga--cols">
        <view class="ga-i ga-i--1"><text class="ga-t">1</text></view>
        <view class="ga-i ga-i--2"><text class="ga-t">2</text></view>
        <view class="ga-i ga-i--3"><text class="ga-t">3</text></view>
      </view>
    </view>

    <!-- B · grid-auto-rows：2 列模板 + 隐式行高 30px ⇒ 5 项排 3 行 -->
    <text class="cc-sec">B · grid-auto-rows（5 项 → 3 行 · 隐式行 30px）</text>
    <view class="cc-card">
      <view id="case-auto-rows" class="ga ga--rows">
        <view class="ga-i ga-i--1"><text class="ga-t">1</text></view>
        <view class="ga-i ga-i--2"><text class="ga-t">2</text></view>
        <view class="ga-i ga-i--3"><text class="ga-t">3</text></view>
        <view class="ga-i ga-i--4"><text class="ga-t">4</text></view>
        <view class="ga-i ga-i--5"><text class="ga-t">5</text></view>
      </view>
    </view>

    <!-- C · minmax 轨迹：两列 1:2 比例 -->
    <text class="cc-sec">C · minmax 轨迹（两列 1fr : 2fr）</text>
    <view class="cc-card">
      <view id="case-minmax" class="ga ga--minmax">
        <view class="ga-i ga-i--1"><text class="ga-t">1fr</text></view>
        <view class="ga-i ga-i--2"><text class="ga-t">2fr</text></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.ga { display: grid; gap: 4px; }
/* A：显式 1 列 60px；column 流下隐式列由 grid-auto-columns 定尺寸 */
.ga--cols { grid-template-columns: 60px; grid-auto-columns: 60px; grid-auto-flow: column; }
/* B：2 列模板；隐式行由 grid-auto-rows 定高 */
.ga--rows { grid-template-columns: 80px 80px; grid-auto-rows: 30px; }
/* C：minmax 轨迹 1:2 */
.ga--minmax { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); }

.ga-i { height: 30px; border-radius: 6px; display: flex; flex-direction: row; align-items: center; justify-content: center; }
.ga-t { font-size: 12px; font-weight: 700; color: #fff; }
.ga-i--1 { background: #5b5bd6; }
.ga-i--2 { background: #2e9e6b; }
.ga-i--3 { background: #d64545; }
.ga-i--4 { background: #e08b1a; }
.ga-i--5 { background: #7a5bd6; }
</style>

<!--
  css-conformance/pages/grid-auto-flow.vue —— CSS 验收 · 网格自动放置（grid-auto-flow）

  【验收对象】`grid-auto-flow`（P0 · 语料 3×——p-formfactor 仪表盘 `grid-auto-flow: column`；
  多列形态 `dense`）。
  【Web 真值（真 Chromium 已取证，2026-10-08）】2 列网格放 3 个自动项：
   · `row`（初值）⇒ 第 3 项**折到第 2 行**（x 回 0）；
   · `column` ⇒ 第 3 项**进隐式第 3 列**（x 右移）；
   · `dense`（稀疏填充）⇒ 显式落位留出的**空洞被后续自动项回填**（与 `row` 的"顺序不回头"不同）。
  【案例即真实业务形态】仪表盘瓦片（`column` 单行不折）+ 多列并排（`dense` 紧凑回填）。
  【★诚实边界（页面具名，不隐藏）】
   · MP/Skyline：官方属性表**无** grid 族，该端**无 Grid 容器**（display:grid 退化为 block/degrade）
     ⇒ 本页三案在 MP 端不呈现网格放置差异（引擎锁死，具名边界，与 justify-self 同款）；
     主承载端 = App（自研内核，taffy `GridAutoFlow` 原生）。
-->
<script setup lang="ts">
// 纯静态页（验收只看真实渲染结果）
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 网格自动放置</text>
    <text class="cc-page__sub">grid-auto-flow · Web 基准（浏览器真值）· 稳定 id 供逐端寻址</text>

    <!-- A · row（初值）：2 列 3 项 ⇒ 第 3 项折到第 2 行（左下） -->
    <text class="cc-sec">A · row（第 3 项折行 → 左下）</text>
    <view class="cc-card">
      <view id="case-row" class="gaf gaf--2col gaf--row">
        <view class="gaf-i gaf-i--1"><text class="gaf-i__t">1</text></view>
        <view class="gaf-i gaf-i--2"><text class="gaf-i__t">2</text></view>
        <view class="gaf-i gaf-i--3"><text class="gaf-i__t">3</text></view>
      </view>
    </view>

    <!-- B · column：2 列 3 项 ⇒ 第 3 项进隐式第 3 列（右上，不折行） -->
    <text class="cc-sec">B · column（第 3 项进第 3 列 → 右上）</text>
    <view class="cc-card">
      <view id="case-column" class="gaf gaf--2col gaf--column">
        <view class="gaf-i gaf-i--1"><text class="gaf-i__t">1</text></view>
        <view class="gaf-i gaf-i--2"><text class="gaf-i__t">2</text></view>
        <view class="gaf-i gaf-i--3"><text class="gaf-i__t">3</text></view>
      </view>
    </view>

    <!-- C · dense：3 列；项1 显式落第 2 列（留出第 1 列空洞）⇒ dense 让项2**回填空洞** -->
    <text class="cc-sec">C · dense（项2 回填空洞 → 居左上）</text>
    <view class="cc-card">
      <view id="case-dense" class="gaf gaf--3col gaf--dense">
        <view class="gaf-i gaf-i--1 gaf-i--col2"><text class="gaf-i__t">1</text></view>
        <view class="gaf-i gaf-i--2"><text class="gaf-i__t">2</text></view>
        <view class="gaf-i gaf-i--3"><text class="gaf-i__t">3</text></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* ★网格容器：显式列（App 内核只支持显式轨迹 1fr/px；repeat 由编译器展开）。
   ★显式 display:grid + 固定高（App/Skyline 的 view 默认 flex——必须显式 grid）。 */
.gaf { display: grid; gap: 4px; }
.gaf--2col { grid-template-columns: 1fr 1fr; }
.gaf--3col { grid-template-columns: 1fr 1fr 1fr; }
.gaf--row { grid-auto-flow: row; }
.gaf--column { grid-auto-flow: column; }
.gaf--dense { grid-auto-flow: dense; }
/* 项 1 显式落第 2 列（grid-column 线号；留出第 1 列空洞供 dense 回填） */
.gaf-i--col2 { grid-column: 2; }

/* 网格项：定高 + 明显底色（放置差异一眼可辨；flex-shrink:0 防被压缩） */
.gaf-i { height: 40px; min-width: 48px; flex-shrink: 0; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
.gaf-i__t { font-size: 14px; font-weight: 700; color: #fff; }
.gaf-i--1 { background: #5b5bd6; }
.gaf-i--2 { background: #2e9e6b; }
.gaf-i--3 { background: #d64545; }
</style>

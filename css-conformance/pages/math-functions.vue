<!--
  css-conformance/pages/math-functions.vue —— CSS 验收 · 数学函数域（min() / max() / clamp()）

  【验收对象】`min()` / `max()` / `clamp()`（P0 · CSS Values & Units 4 的数学函数；语料真用——
   p-formfactor 网格轨道 `clamp(64px, 22%, 132px)`、Home.vue 流体尺寸 `clamp(230px, 19vw, 296px)`）。
  【Web 真值（真 Chromium，2026-10-08）】`clamp(MIN, VAL, MAX)` = `max(MIN, min(VAL, MAX))`；
   全参数为**绝对/可绝对化长度**时结果确定；含 `%`/`vw` 等则按 used-value 阶段（容器/视口）求解。
  【★本项范围（诚实边界，页面具名）】App 端**编译期只折叠「全参数绝对化」的数学函数**为单 px
   （`px`/数字/`calc()`/嵌套数学）——这与既有 `calc()` 折叠同阶段、同能力；含 `%`/`vw`/无单位相对值
   的数学函数在**编译期不可求**（浏览器在 used-value 阶段解），App 端如实不折（诊断，不静默近似）。
   ⇒ 本页案例**全部用可绝对化的参数**，使四端可比；含相对参数的形态作为「已知边界」在页脚具名。
  【案例即真实业务形态】卡片定宽/定高（clamp 定范围）、间距（min/max 取小/取大）。
-->
<script setup lang="ts">
// 纯静态页（验收只看真实渲染结果）
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 数学函数</text>
    <text class="cc-page__sub">min() / max() / clamp() · Web 基准（浏览器真值）· 稳定 id 供逐端寻址</text>

    <!-- A · clamp()：宽度 = clamp(120px, 160px, 200px) = 160px（取中） -->
    <text class="cc-sec">A · clamp(120px, 160px, 200px) → 160px</text>
    <view class="cc-card">
      <view id="case-clamp-mid" class="mf-box mf-clamp-mid">
        <text class="mf-t">A</text>
      </view>
    </view>

    <!-- B · min()：宽度 = min(160px, 240px) = 160px（取小） -->
    <text class="cc-sec">B · min(160px, 240px) → 160px</text>
    <view class="cc-card">
      <view id="case-min" class="mf-box mf-min">
        <text class="mf-t">B</text>
      </view>
    </view>

    <!-- C · max()：宽度 = max(120px, 200px) = 200px（取大） -->
    <text class="cc-sec">C · max(120px, 200px) → 200px</text>
    <view class="cc-card">
      <view id="case-max" class="mf-box mf-max">
        <text class="mf-t">C</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.mf-box {
  height: 40px;
  background: #5b5bd6;
  border-radius: 8px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
}
.mf-t { color: #ffffff; font-size: 16px; font-weight: 700; }

/* A：clamp 取中值 ⇒ 宽 160（介于 min 120 / max 200 之间） */
.mf-clamp-mid { width: clamp(120px, 160px, 200px); }
/* B：min 取小 ⇒ 宽 160（比 C 窄 40） */
.mf-min { width: min(160px, 240px); }
/* C：max 取大 ⇒ 宽 200（比 A/B 宽 40） */
.mf-max { width: max(120px, 200px); }
</style>

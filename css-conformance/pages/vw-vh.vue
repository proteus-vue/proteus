<!--
  css-conformance/pages/vw-vh.vue —— CSS 验收 · 视口单位（vw / vh）

  【验收对象】`vw` / `vh`（CSS 视口相对单位；P0 · 语料真用——svg-skeleton-demo 的 `width:19vw`、多处 `min-height:100vh`）。
  【Web 真值（浏览器原生）】`1vw` = 视口宽/100、`1vh` = 视口高/100；随视口变化。
  【App 端（自绘）】编译期折为内置视口变量 `--pf-vw` / `--pf-vh`（宿主采集的**真实视口逻辑尺寸**）——
    与 Web 同语义；此前 App **整条丢弃** `vw`/`vh`（页面不铺满/宽度丢失）。
  【案例即真实业务形态】按视口宽的比例分栏（`width: 30vw`）、页头按视口高（`min-height: 100vh` 铺满）。
  【★诚实边界】MP/Skyline 的 `vw`/`vh` 由引擎原生处理（不在本页验收范围）；Web 桌面 vw/vh 随窗口。
-->
<script setup lang="ts">
// 纯静态页
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 视口单位</text>
    <text class="cc-page__sub">vw / vh · Web 基准（浏览器原生）· App 折 --pf-vw/--pf-vh</text>

    <!-- A · width: 30vw（盒宽 = 视口宽 30%） -->
    <text class="cc-sec">A · width: 30vw（视口宽 30%）</text>
    <view class="cc-card">
      <view id="case-vw" class="v-box v-box--vw">
        <text class="v-t">30vw</text>
      </view>
    </view>

    <!-- B · height: 20vh（盒高 = 视口高 20%） -->
    <text class="cc-sec">B · height: 20vh（视口高 20%）</text>
    <view class="cc-card">
      <view id="case-vh" class="v-box v-box--vh">
        <text class="v-t">20vh</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.v-box { background: #5b5bd6; border-radius: 8px; display: flex; flex-direction: row; align-items: center; }
/* A：宽 = 视口宽 30%（随视口横向变化） */
.v-box--vw { width: 30vw; height: 44px; }
/* B：高 = 视口高 20%（随视口纵向变化） */
.v-box--vh { width: 120px; height: 20vh; }
.v-t { color: #ffffff; font-size: 16px; font-weight: 700; padding-left: 10px; }
</style>

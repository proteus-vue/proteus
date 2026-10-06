<!--
  css-conformance/pages/line-clamp.vue —— CSS 验收 · 多行截断域（-webkit-line-clamp）

  【验收对象】`-webkit-line-clamp`（P0 · 语料 4×——列表项/简介的多行截断）。
  【Web 真值（真 Chromium 已取证，2026-10-08）】WebKit 三件套
    `display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:<n>`：
     · 文本折行超过 n 行 ⇒ **只保留前 n 行**、末行尾加 **…**；
     · 盒高 = n × lineHeight（**与 overflow 声明无关**——浏览器 computed display 变 flow-root）。
  【案例即真实业务形态】卡片简介的两行/三行截断（差异一眼可辨：可见行数 + 尾省略号 + 盒高）。
  【★诚实边界（页面具名，不隐藏）】
   ① 仅**尾部省略号**（WebKit 事实标准）；fade 渐隐未支持（编译器无对应）。
   ② 仅在文本确需折行（white-space 非 nowrap/pre）时生效——与 Web `display:-webkit-box` 的块级折行同语义。
   ③ Skyline：官方表未收录 `-webkit-line-clamp` ⇒ 见页面顶部具名的引擎边界（按 justify-self 先例钉住）。
-->
<script setup lang="ts">
// ★长文本用脚本常量插值（模板会压缩空白；截断需精确控制字数）
const TEXT =
  '普罗透斯是一套面向多端的 Vue 框架，把同一份组件代码编译到 Web、微信小程序与原生自绘的三类宿主机上运行，让开发者不必为不同平台改写布局与样式。'
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 多行截断</text>
    <text class="cc-page__sub">-webkit-line-clamp · Web 基准（浏览器真值）· 稳定 id 供逐端寻址</text>

    <!-- 案例 A：-webkit-line-clamp:2 —— 只保留 2 行 + 末行尾 …（盒高 = 2 × 行高） -->
    <text class="cc-sec">A · line-clamp: 2（保留两行 + …）</text>
    <view class="cc-card">
      <view id="case-clamp-2" class="lc-box">
        <text class="lc-txt lc-2">{{ TEXT }}</text>
      </view>
    </view>

    <!-- 案例 B：-webkit-line-clamp:3 —— 只保留 3 行 + 末行尾 …（盒高 = 3 × 行高，比 A 高一档） -->
    <text class="cc-sec">B · line-clamp: 3（保留三行 + …）</text>
    <view class="cc-card">
      <view id="case-clamp-3" class="lc-box">
        <text class="lc-txt lc-3">{{ TEXT }}</text>
      </view>
    </view>

    <!-- 案例 C：对照——不截断（整段折行；盒高 = 自然行数，明显高于 A/B） -->
    <text class="cc-sec">C · 对照：无截断（整段）</text>
    <view class="cc-card">
      <view id="case-clamp-none" class="lc-box">
        <text class="lc-txt">{{ TEXT }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 截断宿主盒：定宽 + **高度自适应**（关键——盒高由行数决定，正是 line-clamp 的证据） */
.lc-box {
  width: 220px;
  background: #eef1f6;
  padding: 8px;
  box-sizing: border-box;
  /* 显式 column flex + **缺省 align-items（stretch）**：文本子项拉伸到容器宽 ⇒ 正确折行
     （★不能写 align-items:flex-start —— column 方向下那会让文本子项取 max-content 宽 = 单行不折行，
      与 Web 的「块级子项按容器宽折行」不符；App 内核会如实按该宽度量）。 */
  display: flex;
  flex-direction: column;
}

/* 文本基样式：定行高（盒高 = 行数 × 20px 便于逐行判读） */
.lc-txt {
  font-size: 14px;
  line-height: 20px;
  color: #1a1c22;
}
/* A/B：WebKit 三件套（Web/MP 端由浏览器/Skyline 原生消费；App 端编译期折叠为 lineClamp） */
.lc-2 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.lc-3 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
</style>

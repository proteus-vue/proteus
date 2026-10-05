<!--
  css-conformance/pages/border.vue —— CSS 验收 · 边框域（逐边 border 族）

  【验收对象】`border-<side>` 族（P0：border-bottom 13× / border-top 8× / border-right 2× / border-left 1×，
  语料共 21 处真实用法——列表分隔线 / 卡片顶线 / 侧边强调）。
  【判据（Web 为基准）】稳定 id 供逐端寻址；每案例即真实业务形态。
  【★诚实边界】App 端仅 **solid** 实线（非 solid 线型在编译期诊断跳过，属独立项）。
-->
<script setup lang="ts">
// 纯静态页（验收只看真实渲染结果）
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 边框</text>
    <text class="cc-page__sub">border-&lt;side&gt; 族 · Web 基准 · 稳定 id 供逐端寻址</text>

    <!-- 案例 A：列表分隔线（border-bottom——语料最高频） -->
    <text class="cc-sec">A · border-bottom（列表分隔线）</text>
    <view class="cc-card">
      <view id="case-bottom" class="br-rows">
        <view class="br-row"><text class="br-row__t">第一行</text></view>
        <view class="br-row"><text class="br-row__t">第二行</text></view>
        <view class="br-row br-row--last"><text class="br-row__t">末行（无分隔线）</text></view>
      </view>
    </view>

    <!-- 案例 B：卡片顶线（border-top） -->
    <text class="cc-sec">B · border-top（分区顶线）</text>
    <view class="cc-card">
      <view id="case-top" class="br-topline">
        <text class="br-topline__t">分区标题</text>
      </view>
    </view>

    <!-- 案例 C：左侧强调条（border-left） -->
    <text class="cc-sec">C · border-left（强调条）</text>
    <view class="cc-card">
      <view id="case-left" class="br-accent">
        <text class="br-accent__t">重点提示文本</text>
      </view>
    </view>

    <!-- 案例 D：右侧竖线（border-right） -->
    <text class="cc-sec">D · border-right（表格竖线）</text>
    <view class="cc-card">
      <view id="case-right" class="br-cell">
        <text class="br-cell__t">单元格</text>
      </view>
    </view>

    <!-- 案例 E：四边各自不同（逐边独立性的最强判据） -->
    <text class="cc-sec">E · 四边各异（独立性）</text>
    <view class="cc-card">
      <view id="case-all-sides" class="br-box">
        <text class="br-box__t">四边</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* ── 案例 A：border-bottom 列表分隔线 ── */
.br-rows {
  width: 100%;
}
.br-row {
  border-bottom: 1px solid #e8eaee;
  padding: 8px 0;
}
.br-row--last {
  border-bottom: none;
}
.br-row__t {
  font-size: 14px;
  color: var(--cc-text);
}

/* ── 案例 B：border-top 分区顶线 ── */
.br-topline {
  border-top: 2px solid #5b5bd6;
  padding-top: 6px;
}
.br-topline__t {
  font-size: 14px;
  font-weight: 600;
  color: var(--cc-text);
}

/* ── 案例 C：border-left 强调条（真实形态：提示框） ── */
.br-accent {
  border-left: 3px solid #d64545;
  padding-left: 10px;
}
.br-accent__t {
  font-size: 13px;
  color: var(--cc-text-2);
}

/* ── 案例 D：border-right 表格竖线 ── */
.br-cell {
  width: 120px;
  border-right: 1px solid #dcdfe5;
  padding-right: 8px;
}
.br-cell__t {
  font-size: 13px;
  color: var(--cc-text-2);
}

/* ── 案例 E：四边各异 ── */
.br-box {
  border-top: 2px solid #5b5bd6;
  border-right: 3px solid #2f9e44;
  border-bottom: 4px solid #d64545;
  border-left: 1px solid #f08c00;
  padding: 8px 12px;
}
.br-box__t {
  font-size: 13px;
  color: var(--cc-text);
}
</style>

<!--
  css-conformance/pages/grid-template-areas.vue —— CSS 验收 · 网格命名区域（grid-template-areas）

  【验收对象】`grid-template-areas`（P0 · 语料 2×——p-formfactor 车机仪表盘 `media info` / `rec rec`
  与 `media t t / ...`）+ 子项 `grid-area: <name>`（命名区放置）。
  【Web 真值（真 Chromium 已取证，2026-10-08）】模板 `"media info" "media rec"`（2×2，media 跨 2 行）：
   · media → (0,0) 跨 2 行（100×204，含 gap）；· info → 右上 (104,0) 200×100；· rec → 右下 (104,104)。
  【案例即真实业务形态】车机仪表盘（媒体跨行 + 信息/推荐分列）+ 移动卡片（头图跨行 + 标题/正文）。
  【★诚实边界（页面具名，不隐藏）】
   · MP/Skyline：官方属性表**无** grid 族，该端**无 Grid 容器**（display:grid 退化）
     ⇒ 本页在 MP 端不呈现命名区放置差异（引擎锁死，具名边界，与 justify-self/grid-auto-flow 同款）；
     主承载端 = App（自研内核，taffy `GridTemplateAreas`/`NamedLine` 原生）。
   · 空单元（`.`）/ 命名线（`[name]`）/ `span` 未支持（编译器诊断跳过，v1 边界）。
-->
<script setup lang="ts">
// 纯静态页（验收只看真实渲染结果）
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 网格命名区域</text>
    <text class="cc-page__sub">grid-template-areas / grid-area · Web 基准 · 稳定 id 供逐端寻址</text>

    <!-- A · 车机仪表盘：media 跨 2 行（左列），info 右上，rec 右下 -->
    <text class="cc-sec">A · 命名区域（media 跨 2 行 · info 右上 · rec 右下）</text>
    <view class="cc-card">
      <view id="case-dashboard" class="gta gta--dash">
        <view class="gta-cell gta-media"><text class="gta-t">媒体</text></view>
        <view class="gta-cell gta-info"><text class="gta-t">信息</text></view>
        <view class="gta-cell gta-rec"><text class="gta-t">推荐</text></view>
      </view>
    </view>

    <!-- B · 移动卡片：头图跨底 2 列（顶行），标题/正文各占一列 -->
    <text class="cc-sec">B · 命名区域（头图跨 2 列 · 标题左 · 正文右）</text>
    <view class="cc-card">
      <view id="case-card" class="gta gta--card">
        <view class="gta-cell gta-hero"><text class="gta-t">头图</text></view>
        <view class="gta-cell gta-title"><text class="gta-t">标题</text></view>
        <view class="gta-cell gta-body"><text class="gta-t">正文</text></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* ★网格容器：显式列/行（App 内核只支持显式轨迹 fr/px）+ 显式 display:grid（view 默认 flex）。 */
.gta { display: grid; gap: 4px; }

/* A · 车机仪表盘：100px | 1fr 两列；两行等高。media 跨 2 行。 */
.gta--dash {
  grid-template-columns: 100px 1fr;
  grid-template-rows: 60px 60px;
  grid-template-areas: "media info" "media rec";
}
.gta-media { grid-area: media; }
.gta-info { grid-area: info; }
.gta-rec { grid-area: rec; }

/* B · 移动卡片：两列；顶行头图跨 2 列。 */
.gta--card {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 40px 40px 40px;
  grid-template-areas: "hero hero" "title body" "title body";
}
.gta-hero { grid-area: hero; }
.gta-title { grid-area: title; }
.gta-body { grid-area: body; }

/* 区域单元：明显底色（放置差异一眼可辨）。 */
.gta-cell { border-radius: 6px; display: flex; align-items: center; justify-content: center; min-width: 0; }
.gta-t { font-size: 13px; font-weight: 700; color: #fff; }
.gta-media { background: #5b5bd6; }
.gta-info { background: #2e9e6b; }
.gta-rec { background: #d64545; }
.gta-hero { background: #e08b1a; }
.gta-title { background: #3f7fd0; }
.gta-body { background: #7a5bd6; }
</style>

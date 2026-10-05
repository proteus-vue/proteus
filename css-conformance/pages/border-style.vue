<!--
  css-conformance/pages/border-style.vue —— CSS 验收 · 边框样式域（线型 / 逐角 / uniform）

  【验收对象（边框族收口批 · 2026-10-05）】
    · G 线型（`border-style`/`border: <w> <style> <c>` 的 dashed/dotted——三端宿主按线型绘制）
    · H 逐角圆角（`border-<corner>-radius` 长手——语义 = border-radius 四值；缺省 0）
  【为什么独立成页】案例增多后单页超出视口（844 CSS px）⇒ 真机截图看不全（滚动体验差异掩盖缺陷）。
  拆页让每页装进视口，与真机截图**同坐标系**可比（probe 的前提）。
-->
<script setup lang="ts">
// 纯静态页（验收只看真实渲染结果）
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 边框样式</text>
    <text class="cc-page__sub">线型 / 逐角圆角 · 稳定 id 供逐端寻址</text>

    <!-- 案例 G：线型（dashed/dotted——边框族收口批） -->
    <text class="cc-sec">G · border-style 线型</text>
    <view class="cc-card">
      <view id="case-dashed" class="br-dashed">
        <text class="br-dashed__t">虚线边框</text>
      </view>
      <view id="case-dotted" class="br-dotted">
        <text class="br-dotted__t">点线边框</text>
      </view>
    </view>

    <!-- 案例 H：逐角半径（border-<corner>-radius 长手——边框族收口批） -->
    <text class="cc-sec">H · 逐角圆角</text>
    <view class="cc-card">
      <view id="case-corner-radius" class="br-corner-radius">
        <text class="br-corner-radius__t">左上右下圆角</text>
      </view>
    </view>

  </view>
</template>

<style scoped>
/* ── 案例 G：线型（dashed/dotted） ── */
.br-dashed {
  border: 2px dashed #5b5bd6;
  padding: 8px 12px;
  margin-bottom: 8px;
}
.br-dashed__t {
  font-size: 13px;
  color: var(--cc-text);
}
.br-dotted {
  border: 3px dotted #d64545;
  padding: 8px 12px;
}
.br-dotted__t {
  font-size: 13px;
  color: var(--cc-text);
}

/* ── 案例 H：逐角半径 ── */
.br-corner-radius {
  border-top-left-radius: 12px;
  border-bottom-right-radius: 12px;
  border: 1px solid #dcdfe5;
  padding: 8px 12px;
}
.br-corner-radius__t {
  font-size: 13px;
  color: var(--cc-text);
}

</style>

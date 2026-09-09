<!-- examples/pages/svg-canvas-test.vue —— ★G-62 Canvas 通道真机验证（2026-09-09）
     验证：含形状变化动画的 SVG → 编译期转 <p-svg-canvas> → 离屏 canvas 逐帧绘制 → 动画播放。
     三类动画：① 位置移动(cx) ② 描边进度(dashoffset) ③ 半径变化(r) -->
<template>
  <view class="page">
    <text class="title">Canvas 通道动画验证</text>
    <text class="sub">以下均为 SVG 内部形状动画（image 方案不播放）</text>

    <view class="row">
      <view class="cell">
        <svg viewBox="0 0 100 100" width="120" height="120">
          <circle cx="20" cy="50" r="14" fill="#3498db">
            <animate attributeName="cx" values="20;80;20" dur="2s" repeatCount="indefinite" />
          </circle>
        </svg>
        <text class="lbl">① 位置移动 (cx)</text>
      </view>

      <view class="cell">
        <svg viewBox="0 0 100 100" width="120" height="120">
          <circle cx="50" cy="50" r="35" fill="none" stroke="#9b59b6" stroke-width="8" stroke-dasharray="220" stroke-dashoffset="220">
            <animate attributeName="stroke-dashoffset" from="220" to="0" dur="2s" repeatCount="indefinite" />
          </circle>
        </svg>
        <text class="lbl">② 描边进度 (dashoffset)</text>
      </view>

      <view class="cell">
        <svg viewBox="0 0 100 100" width="120" height="120">
          <circle cx="50" cy="50" r="10" fill="#e74c3c">
            <animate attributeName="r" values="10;40;10" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </svg>
        <text class="lbl">③ 半径变化 (r)</text>
      </view>
    </view>

    <text class="hint">三个图形应持续动（离屏 canvas + rAF 驱动）</text>
  </view>
</template>

<script setup lang="ts"></script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 8px;
  gap: 8px;
}
.title {
  font-size: 16px;
  font-weight: 700;
}
.sub {
  font-size: 11px;
  color: #666;
}
.row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 8px;
}
.cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.lbl {
  font-size: 10px;
  color: #333;
}
.hint {
  font-size: 11px;
  color: #666;
  margin-top: 8px;
}
</style>

<!-- examples/pages/svg-anim-probe.vue —— ★SVG 动画方案验证（2026-09-09）
     假设：SVG 内部动画不播放（image 静态光栅化），但**整体变换类动画**可用 CSS 作用于 image 元素。
     验证三组：
       A. CSS @keyframes 旋转 image
       B. CSS @keyframes 透明度（淡入淡出）
       C. CSS @keyframes 缩放（pulse）
       D. 对照：SVG 内部 SMIL（预期不动）
     @proteus-api-check-ignore：调研性质 -->
<template>
  <view class="page">
    <text class="title">SVG 动画方案验证</text>

    <view class="row">
      <view class="cell">
        <svg viewBox="0 0 100 100" width="80" height="80">
          <g>
            <path d="M50 8 L92 92 L8 92 Z" fill="#e74c3c" />
            <circle cx="50" cy="66" r="12" fill="#fff" />
            <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="2s" repeatCount="indefinite" />
          </g>
        </svg>
        <text class="lbl">A 旋转(编译器转CSS)</text>
      </view>
      <view class="cell">
        <svg viewBox="0 0 100 100" width="80" height="80">
          <g>
            <path d="M50 8 L92 92 L8 92 Z" fill="#e74c3c" />
            <animate attributeName="opacity" values="1;0.2;1" dur="1.5s" repeatCount="indefinite" />
          </g>
        </svg>
        <text class="lbl">B 淡入淡出(编译器转CSS)</text>
      </view>
      <view class="cell">
        <svg viewBox="0 0 100 100" width="80" height="80">
          <g>
            <path d="M50 8 L92 92 L8 92 Z" fill="#e74c3c" />
            <animateTransform attributeName="transform" type="scale" values="1;0.75;1" dur="1.2s" repeatCount="indefinite" />
          </g>
        </svg>
        <text class="lbl">C 缩放(编译器转CSS)</text>
      </view>
      <view class="cell">
        <svg viewBox="0 0 100 100" width="80" height="80">
          <circle cx="20" cy="50" r="14" fill="#3498db">
            <animate attributeName="cx" values="20;80;20" dur="2s" repeatCount="indefinite" />
          </circle>
        </svg>
        <text class="lbl">D SMIL(对照)</text>
      </view>
    </view>

    <text class="hint">A/B/C 应持续动；D 应静止（SVG 内部动画不播放）</text>
  </view>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 8px;
  gap: 10px;
}
.title {
  font-size: 16px;
  font-weight: 700;
}
.row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
}
.cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.ico {
  width: 80px;
  height: 80px;
  border: 1px solid #eee;
}
.rot {
  animation: spin 2s linear infinite;
}
.fade {
  animation: blink 1.5s ease-in-out infinite;
}
.pulse {
  animation: beat 1.2s ease-in-out infinite;
}
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.15;
  }
}
@keyframes beat {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(0.72);
  }
}
.lbl {
  font-size: 11px;
  color: #333;
}
.hint {
  font-size: 11px;
  color: #666;
  text-align: center;
}
</style>

<route>
{
  "meta": {
    "title": "D1 显影",
    "isTab": true
  }
}
</route>

<!-- Dactyl D1 · 延迟显影（§3 核心发明）：把不可见的 ms 映射为**可见的像素与几何**。
     ① **延迟环**：指尖周围圆环半径 ∝ 实测 `input_latency_ms`（`v-pump` 泵源 + `:style` 绑定）；
     ② **帧格**：背景 vsync 刻度，错过一帧闪一格（CSS animation 由 `:active`/泵驱动）；
     ③ **幽灵拖尾**：手指历史轨迹点（宿主喂 `trail` 数据源 ⇒ 页面渲染渐隐圆点）。
     ★全部走**声明式能力**（v-pump 数据源 + 普通绑定 + CSS）——**宿主零视觉发明**（#789 裁定）。
     ★自洽红线（§7.3）：装饰只走合成属性（opacity/transform），门禁 check:dactyl-visual-nonblocking 守。 -->
<template>
  <div class="page">
    <div class="dactyl-title">D1 · 延迟显影</div>
    <div class="dactyl-sub">把 ms 变成肉眼可见的像素</div>
    <div class="dactyl-hint">按住并拖动 —— 环越大 = 延迟越高；缺帧闪格</div>

    <!-- 帧格：vsync 刻度（每格 = 1 帧 @60Hz；`v-pump` 60Hz 驱动，每拍翻一格） -->
    <div class="framegrid" v-pump="{ src: 'tick', hz: 60, gen: { kind: 'int', min: 0, max: 1 } }">
      <div class="fg" v-for="i in Array.from({ length: 32 }, (_, k) => k)" :key="i"
           :class="{ missed: tick > 0 && i % 7 === 0 }" />
    </div>

    <!-- 延迟环：半径 ∝ 实测延迟；`v-pump` 30Hz 刷新读数（宿主数据源 ⇒ 页面绑定） -->
    <div class="ringwrap" v-pump="{ src: 'lag', hz: 30, gen: { kind: 'float', min: 0.8, max: 4.2 } }">
      <div class="ring" :style="{ transform: 'scale(' + (1 + lag * 0.22) + ')' }" />
      <div class="ringv" :style="{ opacity: lag > 2 ? 0.9 : 0.35 }" />
    </div>

    <!-- 幽灵拖尾：手指历史轨迹点（宿主喂 `trail`：0..1 的进度 ⇒ 渐隐圆点） -->
    <div class="trailwrap" v-pump="{ src: 'trail', hz: 30, gen: { kind: 'float', min: 0, max: 1 } }">
      <div class="ghost" style="left: 12%" :style="{ opacity: 0.12 + trail * 0.5 }" />
      <div class="ghost" style="left: 30%" :style="{ opacity: 0.10 + trail * 0.4 }" />
      <div class="ghost" style="left: 48%" :style="{ opacity: 0.08 + trail * 0.3 }" />
      <div class="ghost" style="left: 66%" :style="{ opacity: 0.06 + trail * 0.2 }" />
      <div class="ghost" style="left: 84%" :style="{ opacity: 0.04 + trail * 0.1 }" />
    </div>

    <!-- 读数条：延迟数值（页面自己的可视化——框架只给数据） -->
    <div class="readout">
      <div class="bar" :style="{ width: (lag * 22) + '%' }" />
    </div>
    <div class="hintline">{{ lag > 2 ? 'OVER 1 frame' : 'within budget' }}</div>
  </div>
</template>

<style>
/* D1 显影器样式（全部合成属性——门禁 check:dactyl-visual-nonblocking 守） */
.framegrid {
  display: flex;
  flex-direction: row;
  margin-top: 14px;
  height: 18px;
}
.fg {
  width: 9px;
  height: 14px;
  margin-right: 3px;
  background-color: #26303c;
  border-radius: 2px;
  opacity: 0.65;
}
/* 缺帧格：闪烁提示（opacity 动画 = 合成属性） */
.fg.missed {
  background-color: #d64545;
  animation: fg-blink 0.5s ease-out infinite;
}
@keyframes fg-blink {
  0% { opacity: 0.95; }
  100% { opacity: 0.25; }
}

.ringwrap {
  position: relative;
  height: 150px;
  margin-top: 16px;
}
.ring {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 84px;
  height: 84px;
  margin-left: -42px;
  margin-top: -42px;
  border-radius: 42px;
  border-width: 3px;
  border-color: #39d0ff;
  /* 环本身透明底（只描边）——scale 由绑定给（半径 ∝ 延迟） */
  background-color: rgba(57, 208, 255, 0.08);
}
.ringv {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  margin-top: -7px;
  border-radius: 7px;
  background-color: #39d0ff;
}

.trailwrap {
  position: relative;
  height: 56px;
  margin-top: 10px;
}
.ghost {
  position: absolute;
  top: 18px;
  width: 22px;
  height: 22px;
  border-radius: 11px;
  background-color: #9fe8ff;
}

.readout {
  height: 12px;
  margin-top: 16px;
  background-color: #1c2530;
  border-radius: 6px;
}
.bar {
  height: 12px;
  border-radius: 6px;
  background-color: #39d0ff;
}
.hintline {
  margin-top: 8px;
  font-size: 13px;
  color: #8fa2b8;
}
</style>

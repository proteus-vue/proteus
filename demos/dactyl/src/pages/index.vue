<route>
{
  "meta": {
    "title": "L1 触即应",
    "isTab": true
  }
}
</route>

<!-- Dactyl L1 · 触即应（§4.2）：磁块按下即凹陷发光 —— `.pad:active` ⇒ 编译期折 press* 字段
     ⇒ App 宿主 DOWN 原生即时改绘制（零 JS 跨界）。显影器/HUD 由宿主叠加绘制（§3）。 -->
<template>
  <div class="page">
    <div class="dactyl-title">L1 · 触即应</div>
    <div class="dactyl-sub">按下即响应（零 JS 往返）</div>
    <div class="dactyl-hint">按下任意磁块 —— 反馈不经过逻辑层</div>
    <div class="pads">
      <div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" />
      <div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" />
      <div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" />
      <div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" />
      <div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" />
      <div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" />
      <div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" />
      <div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" /><div class="pad" />
    </div>
  </div>
</template>

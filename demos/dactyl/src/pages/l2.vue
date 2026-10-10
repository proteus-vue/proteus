<route>
{
  "meta": {
    "title": "L2 跟手",
    "isTab": true
  }
}
</route>

<!-- Dactyl L2 · 跟手（§4.3）：**一屏内密集针林**（N 根铁磁流体尖峰，填满视口、**不滚动**）——
     每根尖峰的**高度与朝向由手指距离决定**（近则高、倾角朝指）。手势焦点走 `v-follow={field:…}`
     （编译期折 followField* ⇒ 宿主焦点直喂内核 `follow_field`，一片尖峰**一次求值**，零 JS）。
     ★场换算唯一实现在内核（宿主零数学）。尖峰 = 场容器**直接叶**（内核按容器子树取叶，逐个求 scale/rotate）。
     ★App 路径不展开 `v-for` ⇒ 针林**静态手写**；容器高度 = 视口 − 头部 ⇒ 不溢出 ⇒ **不滚动**。 -->
<template>
  <div class="page">
    <div class="dactyl-title">L2 · 跟手</div>
    <div class="dactyl-hint">在针林里拖动 —— 针随指立起（尖峰贴上指尖）</div>
    <div class="needle-field" v-follow="{ field: { falloff: 240, minScale: 0.1, maxScale: 1.0, rotate: 26 } }">
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
    </div>
  </div>
</template>

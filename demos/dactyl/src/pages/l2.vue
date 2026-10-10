<route>
{
  "meta": {
    "title": "L2 跟手",
    "isTab": true
  }
}
</route>

<!-- Dactyl L2 · 跟手（§4.3）：**N 根铁磁流体尖峰的穹顶**——每根尖峰的**高度与朝向由手指距离决定**
     （近则高、倾角朝指）。手势焦点走 `v-follow={field:…}`（编译期折 followField* ⇒ 宿主焦点直喂内核
     `follow_field`，一片尖峰**一次求值**，零 JS）。★场换算唯一实现在内核（宿主零数学）。
     ★尖峰是场容器的**直接叶**（内核按容器子树取叶，逐个按距焦点求 scale/rotate）。 -->
<template>
  <div class="page">
    <div class="dactyl-title">L2 · 跟手</div>
    <div class="dactyl-sub">针林如影随形（尖峰贴上指尖）</div>
    <div class="dactyl-hint">在穹顶里拖动手指 —— 针林随指立起</div>
    <div class="needle-field" v-follow="{ field: { falloff: 320, minScale: 0.18, maxScale: 1.0, rotate: 22 } }">
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
      <div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" /><div class="needle" />
    </div>
  </div>
</template>

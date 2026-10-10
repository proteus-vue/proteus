<route>
{
  "meta": {
    "title": "L2 跟手",
    "isTab": true
  }
}
</route>

<script setup lang="ts">
// L2 无业务逻辑：针林由 `v-for`（内联 `Array.from`）在**构建期静态展开**；跟手走 `v-follow={field:…}`。
</script>

<!-- Dactyl L2 · 跟手（§4.3）：一屏内**密集针林**（N=4000 根尖峰，填满视口、**不滚动**）——
     每根尖峰的**高度与朝向由手指距离决定**（近则高、倾角朝指）。手势焦点走 `v-follow={field:…}`
     （编译期折 followField* ⇒ 宿主焦点直喂内核 `follow_field`，一片尖峰**一次求值**，零 JS）。
     ★场换算唯一实现在内核（宿主零数学）。尖峰 = 场容器**直接叶**（内核按容器子树取叶，逐个求 scale/rotate）。
     ★`v-for` 在**构建期**静态展开（App 无运行时；内联 `Array.from({length:N})` 可静态求值）。 -->
<template>
  <div class="page">
    <div class="dactyl-title">L2 · 跟手</div>
    <div class="dactyl-hint">在针林里拖动 —— 针随指立起（尖峰贴上指尖）</div>
    <div class="needle-field" v-follow="{ field: { falloff: 260, minScale: 0.08, maxScale: 1.0, rotate: 22 } }">
      <div v-for="i in Array.from({ length: 4000 }, (_, k) => k)" :key="i" class="needle" />
    </div>
  </div>
</template>

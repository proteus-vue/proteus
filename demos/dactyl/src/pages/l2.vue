<route>
{
  "meta": {
    "title": "L2 跟手",
    "isTab": true
  }
}
</route>

<!-- Dactyl L2 · 跟手（§4.3）：拖动穹顶平台 —— `v-follow` ⇒ 编译期折 follow* 规格
     ⇒ App 宿主 MOVE 直接喂内核（换算在内核，零 JS 跨界）。尖峰场随指迁移（纯合成平移）。 -->
<template>
  <div class="page">
    <div class="dactyl-title">L2 · 跟手</div>
    <div class="dactyl-sub">拖动穹顶平台，尖峰随指迁移</div>
    <div class="dactyl-hint">拖动下面这条 —— 跟手不进入 JS</div>
    <div class="lane">
      <div class="dome" v-follow="{ axis: 'x' }">
        <div class="peak" /><div class="peak" /><div class="peak" /><div class="peak" /><div class="peak" />
      </div>
    </div>
  </div>
</template>

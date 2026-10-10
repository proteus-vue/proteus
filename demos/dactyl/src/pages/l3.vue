<route>
{
  "meta": {
    "title": "L3 沸腾",
    "isTab": true
  }
}
</route>

<!-- Dactyl L3 · 沸腾（§4.4，最锋利的一关）：跟手**同时**后台高频数据更新。
     本切片给"跟手 + 数据场"的静态形态（数字/光点网格）；逐帧数据泵属运行期批次（§4.4 负载变量 f）。
     跟手仍走 v-follow（内核合成平移，零 JS）。 -->
<template>
  <div class="page">
    <div class="dactyl-title">L3 · 沸腾</div>
    <div class="dactyl-sub">跟手中数据持续跳变（动画与更新打架）</div>
    <div class="dactyl-hint">拖动穹顶，同时下方数字场"沸腾"</div>
    <div class="lane">
      <div class="dome" v-follow="{ axis: 'x' }">
        <div class="peak" /><div class="peak" /><div class="peak" /><div class="peak" /><div class="peak" /><div class="peak" />
      </div>
    </div>
    <div class="boil">
      <div class="cell" /><div class="cell" /><div class="cell" /><div class="cell" /><div class="cell" /><div class="cell" />
      <div class="cell" /><div class="cell" /><div class="cell" /><div class="cell" /><div class="cell" /><div class="cell" />
      <div class="cell" /><div class="cell" /><div class="cell" /><div class="cell" /><div class="cell" /><div class="cell" />
      <div class="cell" /><div class="cell" /><div class="cell" /><div class="cell" /><div class="cell" /><div class="cell" />
    </div>
  </div>
</template>

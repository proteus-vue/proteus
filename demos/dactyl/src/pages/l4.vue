<route>
{
  "meta": {
    "title": "L4 十指",
    "isTab": true
  }
}
</route>

<!-- Dactyl L4 · 十指（§4.5）：多股液柱**同时**跟手（每个是独立跟手锚点）。
     多指 ⇒ 宿主一帧一次批量 FFI（ffi_calls_per_frame ≤ 1，触点翻倍而跨界不翻倍——S3-T3）。 -->
<template>
  <div class="page">
    <div class="dactyl-title">L4 · 十指</div>
    <div class="dactyl-sub">同时拖动多股液柱</div>
    <div class="dactyl-hint">多指同时按住几股 —— 延迟不随触点翻倍</div>
    <div class="multi">
      <div class="pillar" v-follow="{ axis: 'x' }" />
      <div class="pillar" v-follow="{ axis: 'x' }" />
      <div class="pillar" v-follow="{ axis: 'x' }" />
    </div>
  </div>
</template>

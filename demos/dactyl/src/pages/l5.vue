<route>
{
  "meta": {
    "title": "L5 崩裂",
    "isTab": true
  }
}
</route>

<!-- Dactyl L5 · 崩裂（§4.6，天花板关）：滑动滑出旋钮 —— v-follow + clamp + snap
     ⇒ swipe-to-delete 语义（过阈值吸附滑出 / 未过阈值回弹归零，判定+弹簧全在内核，零 JS）。 -->
<template>
  <div class="page">
    <div class="dactyl-title">L5 · 崩裂</div>
    <div class="dactyl-sub">左右滑动 —— 过阈值滑出 / 未过回弹</div>
    <div class="dactyl-hint">向左或向右甩动 —— 判定与回弹都在内核</div>
    <div class="lane">
      <div class="rupt" v-follow="{ axis: 'x', clamp: [-260, 260], snap: { threshold: 100, target: 260 } }" />
    </div>
  </div>
</template>

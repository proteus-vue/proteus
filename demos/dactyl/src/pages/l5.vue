<route>
{
  "meta": {
    "title": "L5 崩裂",
    "isTab": true
  }
}
</route>

<!-- Dactyl L5 · 崩裂（§4.6，天花板关）：① 滑动滑出旋钮（`v-follow` + clamp + snap，判定/回弹全在内核）
     ② **总负载旋钮**（`v-pump` 泵源 `load` 0–100，60Hz）——把 L1–L4 的负载同时放大：每根负载针的
        opacity/scale 随档位（**全合成属性**）；③ 过载档（>80）显示 RUPTURE ZONE。
     ⇒ 观众拧到第一次明显崩 ⇒ 记录**崩裂档位**（§5.1 判据：input_latency_p95>8.33ms / jank>1%）。
     ★自洽红线（§7.3）：装饰只走合成属性（门禁 check:dactyl-visual-nonblocking 守）。 -->
<template>
  <div class="page">
    <div class="dactyl-title">L5 · 崩裂</div>
    <div class="dactyl-sub">总负载旋钮 —— 拧到第一次明显崩</div>
    <div class="dactyl-hint">拖动滑出条；下方负载针林随档位加码</div>
    <div class="lane">
      <div class="rupt" v-follow="{ axis: 'x', clamp: [-260, 260], snap: { threshold: 100, target: 260 } }" />
    </div>
    <div class="loadfield" v-pump="{ src: 'load', hz: 60, gen: { kind: 'int', min: 0, max: 100 } }">
      <div class="ln" v-for="i in Array.from({ length: 24 }, (_, k) => k)" :key="i"
           :style="{ opacity: 0.25 + load * 0.007, transform: 'scale(' + (0.6 + load * 0.006) + ')' }" />
    </div>
    <div class="rupture-hint" :style="{ opacity: load > 80 ? 1 : 0.15 }">
      {{ load > 80 ? 'RUPTURE ZONE' : 'stable' }}
    </div>
  </div>
</template>

<style>
.lane {
  display: flex;
  flex-direction: row;
  margin-top: 12px;
  height: 60px;
}
.rupt {
  width: 220px;
  height: 56px;
  border-radius: 12px;
  background-color: #2a1a3a;
  border-width: 1px;
  border-color: #7a5cff;
}
/* 负载针林：24 根 —— 随档位 opacity/scale（全合成属性） */
.loadfield {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 16px;
}
.ln {
  width: 22px;
  height: 34px;
  margin: 3px;
  border-radius: 4px;
  background-color: #39d0ff;
}
.rupture-hint {
  margin-top: 12px;
  font-size: 13px;
  color: #d64545;
  letter-spacing: 1px;
}
</style>

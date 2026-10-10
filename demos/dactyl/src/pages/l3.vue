<route>
{
  "meta": {
    "title": "L3 沸腾",
    "isTab": true
  }
}
</route>

<!-- Dactyl L3 · 沸腾（§4.4，最锋利的一关）：跟手**同时**后台高频数据更新。
     ① 数字场用 `v-pump` 声明的**运行期数据源**（宿主按 hz 周期产新值）驱动——每格绑同一个泵源数字，
        与跟手（`v-follow`，内核合成平移，零 JS）**同时**进行 = "数据更新 / 动画打架"的压力源。
     ② 节奏心用**第二个泵**（低频）+ `v-animate:zoom` —— **数据跳变驱动动画**（跳变→播内核动画）：
        这是"跳变驱动动画"在 App 壳运行期的落地（触发逻辑在共享层，宿主只提供 animStart 通道）。
     ★泵走**数据通路**（宿主按频率 → 数据源 → 既有 slot-runtime 增量）；跟手仍**零 JS**；动画走内核动画通道。 -->
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
    <div class="boil" v-pump="{ src: 'p0', hz: 30, gen: { kind: 'int', min: 1, max: 99 } }">
      <div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div>
      <div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div>
      <div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div><div class="cell">{{ p0 }}</div>
    </div>
    <div class="throb" v-pump="{ src: 'beat', hz: 3, gen: { kind: 'int', min: 1, max: 2 } }">
      <div class="core" v-animate:zoom="beat"></div>
    </div>
  </div>
</template>

<style>
/* L3 沸腾数据场：数字格（`v-pump` 泵源驱动文本跳变）。★自洽红线（§7.3）：装饰只走合成属性。 */
.boil {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 14px;
}
.cell {
  width: 52px;
  height: 30px;
  margin: 3px;
  background-color: #2a1a3a;
  border-radius: 6px;
  color: #9fe8ff;
  font-size: 15px;
  text-align: center;
}
/* 节奏心：第二个泵（3Hz）驱动 `v-animate:zoom` —— 每次数据跳变播一次内核缩放动画。 */
.throb {
  display: flex;
  justify-content: center;
  margin-top: 14px;
}
.core {
  width: 44px;
  height: 44px;
  background-color: #39d0ff;
  border-radius: 22px;
}
</style>

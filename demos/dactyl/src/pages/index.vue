<route>
{
  "meta": {
    "title": "Dactyl 触感穹顶"
  }
}
</route>

<!--
  Dactyl · 触感穹顶 —— L1 触即应 + L2 跟手（`15-dactyl-demo.md` §4.2/§4.3）

  【本页要证明什么（编译期交互下沉）】
    · L1 触即应：`.pad:active` ⇒ 编译期折成节点 `press*` 字段 ⇒ App 宿主 DOWN 时**原生立即**改绘制
      （零 JS 跨界）——对标 RN Pressable / Flutter InkWell 必过逻辑层。
    · L2 跟手：`v-follow` ⇒ 编译期折成节点 `follow*` 规格 ⇒ App 宿主 MOVE **直接喂内核**
      （换算/夹取在内核，零 JS 跨界）——`js_involved_gestures_ratio == 0`。
  【诚实边界】本页只提供"可交互元素 + 本底视觉"；延迟显影器（幽灵拖尾/延迟环/帧格）与 HUD
    由宿主叠加层绘制（合成通道，见 §3/§7.3——显影器自身不得成为压力源）。
-->
<template>
  <div class="page">
    <div class="dactyl-head">
      <div class="dactyl-title">Dactyl · 触感穹顶</div>
      <div class="dactyl-sub">L1 触即应 · L2 跟手 · 延迟显影</div>
    </div>

    <!-- L1 · 触即应：48 个磁块（按压即凹陷发光，零 JS 往返） -->
    <div class="section-title">L1 · 触即应（按下即响应）</div>
    <div class="pad-grid">
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
      <div class="pad" />
    </div>

    <!-- L2 · 跟手：拖动穹顶平台（整条随指迁移 = 尖峰场随指；本元素是跟手锚点，宽条好命中） -->
    <div class="section-title">L2 · 跟手（拖我）</div>
    <div class="track-wrap">
      <div class="dome-knob" v-follow="{ axis: 'x' }">
        <div class="dome-peak"></div>
        <div class="dome-peak"></div>
        <div class="dome-peak"></div>
        <div class="dome-peak"></div>
        <div class="dome-peak"></div>
      </div>
    </div>

    <!-- L4 · 十指：多股液柱同时跟手（一帧一次批量 FFI，触点翻倍而延迟不翻倍——S3-T3） -->
    <div class="section-title">L4 · 十指（同时拖动多股）</div>
    <div class="multi-wrap">
      <div class="pillar" v-follow="{ axis: 'x' }"></div>
      <div class="pillar" v-follow="{ axis: 'x' }"></div>
      <div class="pillar" v-follow="{ axis: 'x' }"></div>
    </div>

    <!-- L5 · 崩裂：滑动滑出（swipe-to-delete 语义——过阈值吸附滑出，未过回弹；S3-T2） -->
    <div class="section-title">L5 · 崩裂（左右滑动）</div>
    <div class="track-wrap">
      <div class="rupt-knob" v-follow="{ axis: 'x', clamp: [-260, 260], snap: { threshold: 100, target: 260 } }"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Dactyl 无业务逻辑：L1/L2 全走编译期折叠（`:active` / `v-follow`），端上零 JS 参与交互。
</script>

<style>
.dactyl-head {
  padding: 4px 0 8px;
}
.dactyl-title {
  display: block;
  font-size: 22px;
  font-weight: 800;
  color: #39D0FF;
}
.dactyl-sub {
  display: block;
  font-size: 12px;
  color: var(--text-3);
  margin-top: 4px;
}

/* L1 磁块网格 */
.pad-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}
.pad {
  width: 44px;
  height: 44px;
  margin: 3px;
  background-color: #141A24;
  border-radius: 10px;
}
/* 按下态：编译期折成 press* 字段（App 宿主 DOWN 原生立即应用，零 JS） */
.pad:active {
  background-color: #39D0FF;
}

/* L2 跟手轨道 */
.track-wrap {
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 100%;
  height: 90px;
  margin-top: 8px;
  background-color: #10141c;
  border-radius: 14px;
}
.dome-knob {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  width: 220px;
  height: 70px;
  margin: 0 8px;
  padding: 0 10px;
  background-color: #10202e;
  border-radius: 14px;
}
/* 铁磁流体尖峰（静态造型；跟手 = 整条随指迁移，纯合成平移） */
.dome-peak {
  width: 28px;
  height: 46px;
  margin: 0 3px;
  background-color: #39D0FF;
  border-radius: 10px 10px 4px 4px;
}

/* L4：多股液柱（每个都是独立跟手锚点 ⇒ 多指同时） */
.multi-wrap {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  width: 100%;
  height: 130px;
  margin-top: 8px;
  padding: 0 12px;
  background-color: #0e1520;
  border-radius: 14px;
}
.pillar {
  width: 44px;
  height: 90px;
  margin: 0 8px;
  background-color: #7c5cff;
  border-radius: 12px 12px 4px 4px;
}

/* L5：崩裂旋钮（滑动滑出 / 回弹） */
.rupt-knob {
  width: 70px;
  height: 70px;
  margin: 0 12px;
  background-color: #ff9a6c;
  border-radius: 16px;
}
</style>

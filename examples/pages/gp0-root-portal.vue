<!-- examples/pages/gp0-root-portal.vue —— ★★★GP0-a 实测页（root-portal 点击穿透，2026-10-03）
     用途：`Proteus_全局挂载点任务卡清单.md` 的 **GP0-a**（最高优先级·一票否决卡）。
     要测什么：Skyline + 不同基础库下，`<root-portal>`（即 `<teleport>` 编译产物）内的
       元素**点击是否响应**——社区已确认基础库 3.8.4 会穿透（3.5.8 正常），规避是 `virtualHost=false`。

     ★判据设计（三层，缺一不可）：
       ① **tap 事件真的到 JS**：页内 `portalTaps` 计数 +1（打印到 console 供 e2e grep）
       ② **不是坐标问题**：同一 tap 也打主树按钮作对照（`mainTaps`）——若主树通而 portal 不通
          ⇒ 是穿透（不是 hitTest 偏移/元素不可见）
       ③ **可区分"组件边界吞事件"**：portal 内同时放 `button`（原生，无组件边界）
          与 `p-button`（自定义组件，原生 tap 不跨边界）——区分两种失效形态

     ★本页不引第三方：只用 view/button/text + teleport，最小依赖。 -->
<template>
  <view class="gp0">
    <text class="gp0-title">GP0-a · root-portal 点击穿透实测</text>
    <text class="gp0-sub">tap 主树按钮与 portal 内按钮，比较两者是否都触发</text>

    <!-- ★对照：主树内的原生 button（不走 teleport） -->
    <view class="gp0-block">
      <text class="gp0-label">① 主树（无 teleport）</text>
      <button id="gp0-main-btn" class="gp0-main-btn" @tap="onMainTap">main-btn taps={{ mainTaps }}</button>
    </view>

    <!-- ★被测：teleport → 编译产物 <root-portal> —— 内含两种形态 -->
    <teleport to="body">
      <view class="gp0-portal">
        <button id="gp0-portal-btn" class="gp0-portal-btn" @tap="onPortalTap">portal-btn taps={{ portalTaps }}</button>
        <!-- ★第二形态（2026-10-03 补）：**自定义组件**在 portal 内能否点到——
             「组件边界吞事件」是穿透之外的另一种失效形态（既有经验：原生 tap 不跨组件边界，
             p-button 走 click + bubbles/composed 让父级 bind:click 能收） -->
        <p-button id="gp0-portal-comp" variant="primary" size="small" @click="onPortalCompTap">
          portal-comp taps={{ portalCompTaps }}
        </p-button>
        <text class="gp0-count">portalCompTaps={{ portalCompTaps }}</text>
      </view>
    </teleport>

    <view class="gp0-block">
      <text class="gp0-label">计数（e2e 断言面）</text>
      <text class="gp0-count">mainTaps={{ mainTaps }} portalTaps={{ portalTaps }}</text>
      <text class="gp0-count">lastTap={{ lastTap }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { PButton } from '@proteus-vue/components'

const mainTaps = ref(0)
const portalTaps = ref(0)
/** ★第二形态：portal 内**自定义组件**（p-button）的点击计数 */
const portalCompTaps = ref(0)
const lastTap = ref('none')

/** ★主树 tap：对照组（若它也不触发 ⇒ 是设备/链路问题，不是穿透） */
function onMainTap(): void {
  mainTaps.value += 1
  lastTap.value = 'main'
  // ★console 落痕供 e2e grep（判据 ①：事件真的到 JS 层）
  console.log('[GP0A] main-tap ' + mainTaps.value)
}

/** ★portal 内 tap：被测（若 main 触发而它不触发 ⇒ 点击穿透成立） */
function onPortalTap(): void {
  portalTaps.value += 1
  lastTap.value = 'portal'
  console.log('[GP0A] portal-tap ' + portalTaps.value)
}

/** ★portal 内**自定义组件**的点击（第二失效形态：组件边界是否吞事件） */
function onPortalCompTap(): void {
  portalCompTaps.value += 1
  lastTap.value = 'portal-comp'
  console.log('[GP0A] portal-comp-tap ' + portalCompTaps.value)
}
</script>

<style>
.gp0 {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.gp0-title {
  font-size: 18px;
  font-weight: 600;
}
.gp0-sub {
  font-size: 12px;
  color: #666;
}
.gp0-block {
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gp0-label {
  font-size: 12px;
  color: #333;
}
.gp0-count {
  font-size: 12px;
  color: #666;
}
/* ★portal 内容：固定定位在屏幕下部（不依赖 fixed——Skyline 不支持；root-portal 已脱离页面层叠） */
.gp0-portal {
  position: absolute;
  left: 24px;
  top: 320px;
  padding: 10px;
  background: #e8f0ff;
  border-radius: 8px;
}
</style>

<!-- src/components/p-loading-region/index.vue —— ★★★GP4-b（2026-10-03）：**区域遮罩**（就地包裹）

     【三种遮罩范围的第三种，为什么必须是组件而不是服务】
       · `page` / `global` 由 `p-loading-host` 承载（页面级 portal，全屏遮罩）
       · `region`（本组件）要贴合**某个元素的盒子**（"这个表格正在加载"）——
         ★就地包裹 ⇒ 天然精确（盒子即遮罩边界），零测量、零滚动同步、零尺寸变化处理；
         若放进页面级宿主，就得"测量目标元素矩形 + 跟随滚动/窗口变化"——脆弱且三端有差异。
       ⇒ 用法：把目标内容包进本组件（默认插槽），`active` 为真时盖上遮罩并拦截交互。

     【交互拦截语义】`active` 时遮罩**吞掉点击**（`catchtap`——不冒泡到区域内容）；
       区域**外**的元素完全不受影响（遮罩只覆盖本组件自己的盒子）。
       `dismissible` 缺省 false（与 page/global 一致：结束由业务显式置 active=false）。

     【★和 p-loading 的关系】`p-loading` 是**既有**的声明式遮罩（fixed 全屏，单实例）；
       本组件是**区域内**的遮罩（自适应盒子尺寸）。两者可共存（不同层叠范围）。

     【★Skyline 约束】遮罩用 `position: absolute` + 四边 0（**父容器需 position:relative**——
       本组件根自带）。★不用 `position: fixed`（Skyline 不支持，S42 血泪）。 -->
<template>
  <view class="p-loading-region">
    <slot />
    <view v-if="active" class="p-loading-region__mask" @catchtap="onMaskTap">
      <view class="p-loading-region__panel">
        <view class="p-loading-region__spinner" />
        <text v-if="text" class="p-loading-region__text">{{ text }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
const props = defineProps({
  pid: { type: String, default: '' },
  /** 是否显示区域遮罩（受控——结束由业务置 false） */
  active: { type: Boolean, default: false },
  /** 提示文案（缺省只显示 spinner） */
  text: { type: String, default: '' },
  /** 点击遮罩是否可关（缺省 false——与 page/global 语义一致） */
  dismissible: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

/** 遮罩点击：仅 dismissible 时 emit close（缺省吞掉点击，不冒泡到区域内容） */
function onMaskTap(): void {
  if (props.dismissible) emit('close')
}
</script>

<style scoped>
/* 根 = 定位基准（遮罩相对它四边撑满 ⇒ 天然贴合本区域盒子，无需测量） */
.p-loading-region {
  position: relative;
}
.p-loading-region__mask {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  background: rgba(255, 255, 255, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
}
.p-loading-region__panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 16px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.75);
}
/* ★加载环：统一色 border 环 + 随转子元素点（单边异色 border 在 Skyline 下会让 border-radius 失效） */
.p-loading-region__spinner {
  width: 20px;
  height: 20px;
  border-radius: 10px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  box-sizing: border-box;
  animation: proteus-loading-region-spin 800ms linear infinite;
}
.p-loading-region__spinner::after {
  content: '';
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 2px;
  background: #ffffff;
  margin-left: 7px;
  margin-top: 1px;
}
.p-loading-region__text {
  margin-top: 6px;
  color: #fff;
  font-size: 13px;
}
@keyframes proteus-loading-region-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>

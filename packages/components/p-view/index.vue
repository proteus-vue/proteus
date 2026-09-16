<!-- src/components/p-view/index.vue —— 通用容器（组件库 B2）
     矩阵 01 §1：display 统一 flex 纵向；box-sizing 统一 content-box（Skyline 默认，Web 侧对齐）
     双端同源码：div → view（编译期映射）；Web 原生 div + 插槽
     ★2026-09-14 Web 按压反馈修复：根节点由 `<div>` 改 **`<view>`**——`div` 在 Web 端保持原生 div，
       Web 模拟层（proteus-view）不介入 → hover-* 无任何反馈；`<view>` 经插件改写为 proteus-view，
       复用模拟层的 hover-start-time/stay-time/stop-propagation（MP 端同为原生 view，产物不变）。 -->
<template>
  <view
    class="p-view"
    :class="{ 'is-disabled': disabled }"
    :aria-label="ariaLabel"
    :hover-class="hoverClass === 'none' ? 'none' : (hoverClass || 'p-view--hover')"
    :hover-stop-propagation="hoverStopPropagation"
    :hover-start-time="hoverStartTime"
    :hover-stay-time="hoverStayTime"
  >
    <slot />
  </view>
</template>

<script setup lang="ts">
// 对象形式 defineProps（编译器静态提取）：BaseProps 契约（contracts/props.ts）逐字面量落地
// pid：跨端唯一标识（自动生成 v2.0 拆包时统一注入，当前透传）
defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  // ── ★官方 <view> 按压反馈属性（2026-09-14 对齐） ──
  /** 按下样式类：缺省（''）→ 框架默认 p-view--hover；'none' → 关闭按压态；其它值 → 自定义类名（MP） */
  hoverClass: { type: String, default: '' },
  /** 是否阻止祖先节点出现按压态 */
  hoverStopPropagation: { type: Boolean, default: false },
  /** 按住多久出现按压态（ms） */
  hoverStartTime: { type: Number, default: 50 },
  /** 松开后按压态保留时间（ms） */
  hoverStayTime: { type: Number, default: 400 },
})
</script>

<style scoped>
.p-view {
  display: flex;
  flex-direction: column;
  box-sizing: content-box;
}
.is-disabled {
  opacity: 0.6;
}
</style>

<!-- ★按压态（小程序专用；global + 单类选择器——同 p-button）：
     hover-class 的类名由**平台**在按下时加到根节点，不经 Vue 编译期 :class → 无 scopeId 后缀，
     scoped 版永远匹配不上；Skyline glass-easel 亦不支持复合类选择器，故用单类全局选择器。 -->
<style global>
.p-view--hover {
  opacity: 0.7;
}
</style>

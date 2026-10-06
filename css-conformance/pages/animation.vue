<!--
  css-conformance/pages/animation.vue —— CSS 验收 · 动画/过渡族

  【验收对象】@keyframes · animation / animation-name / animation-duration /
    animation-timing-function / animation-iteration-count · transition / transition-property /
    transition-duration / transition-timing-function
  【判据（Web 为基准）】每案例稳定 id —— 逐端按 id 定位并与 Web 并排比对。
  【★诚实边界】
   · 动画/过渡是**时间轴**行为——静态截图取某一时刻；本页用**终态/静止形态**演示声明被正确接受与解析
     （逐帧波形不在本页判据内，那是 packages/animation 的验收面）。
   · `will-change` = **非视觉**（合成/性能提示，无渲染输出）⇒ 不设截图案例（见清单 `channel: non-visual`）。
   · `transition-property` 用 **opacity**（合成属性）——与 Skyline 接受值域一致（该端接受 none/all/transform/opacity）。
-->
<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 动画 / 过渡</text>
    <text class="cc-page__sub">@keyframes / animation 族 · transition 族</text>

    <!-- A：@keyframes + animation（旋转指示器） -->
    <text class="cc-sec">A · @keyframes + animation（旋转）</text>
    <view class="cc-card">
      <view id="case-animation" class="spin"></view>
    </view>

    <!-- B：animation 各长手（时长/缓动/次数） -->
    <text class="cc-sec">B · animation-duration / timing-function / iteration-count</text>
    <view class="cc-card">
      <view id="case-animation-timing" class="pulse"></view>
    </view>

    <!-- C：transition（属性/时长/缓动——合成属性 opacity） -->
    <text class="cc-sec">C · transition（transition-property / duration / timing）</text>
    <view class="cc-card">
      <view id="case-transition" class="tbtn"><text class="t t--w">transition</text></view>
    </view>
  </view>
</template>

<style scoped>
.t { font-size: 12px; color: #1a1c22; }
.t--w { color: #ffffff; }

@keyframes cc-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes cc-pulse {
  0% { opacity: 0.4; }
  50% { opacity: 1; }
  100% { opacity: 0.4; }
}

.spin { width: 40px; height: 40px; border-radius: 50%; background-color: #5b5bd6; animation: cc-spin 1s linear infinite; }
.pulse { width: 48px; height: 24px; border-radius: 6px; background-color: #2e7d5b; animation-name: cc-pulse; animation-duration: 1.2s; animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
.tbtn { width: 120px; height: 40px; border-radius: 8px; background-color: #4b78c8; display: flex; align-items: center; justify-content: center; transition-property: all; transition-duration: 300ms; transition-timing-function: ease-out; }
</style>

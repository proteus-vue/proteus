<!--
  css-conformance/pages/at-rules.vue —— CSS 验收 · 条件规则 / 级联层

  【验收对象】@media（媒体查询）· @supports（特性查询）· @layer（级联层）
  【判据（Web 为基准）】每案例稳定 id —— 逐端按 id 定位并与 Web 并排比对。
  【案例即真实业务形态】窄屏适配（@media）/ 能力探测（@supports）/ 分层覆盖（@layer）。
  【★诚实边界】Web 由浏览器原生求值；App/Skyline 的**条件块求值口径**见清单 `at-media`/`at-supports` 行
  （编译期按目标视口/能力折叠或如实诊断）。
-->
<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 条件规则</text>
    <text class="cc-page__sub">@media / @supports / @layer · Web 基准</text>

    <!-- A：@media（视口宽度条件） -->
    <text class="cc-sec">A · @media（max-width: 480px）</text>
    <view class="cc-card">
      <view id="case-media" class="mq-box"><text class="t t--w">窄屏变蓝 / 宽屏变绿</text></view>
    </view>

    <!-- B：@supports（特性查询） -->
    <text class="cc-sec">B · @supports（display: grid）</text>
    <view class="cc-card">
      <view id="case-supports" class="sup-box"><text class="t">支持 grid 时的样式</text></view>
    </view>

    <!-- C：@layer（级联层——同特异性下层的次序决定胜负） -->
    <text class="cc-sec">C · @layer（级联层次序）</text>
    <view class="cc-card">
      <view id="case-layer" class="lay-box"><text class="t t--w">base 层 vs theme 层</text></view>
    </view>
  </view>
</template>

<style scoped>
.t { font-size: 12px; color: #1a1c22; }
.t--w { color: #ffffff; }

/* A：@media —— 手机视口（≤480px）命中 */
.mq-box { height: 48px; background-color: #2e7d5b; display: flex; align-items: center; justify-content: center; }
@media (max-width: 480px) {
  .mq-box { background-color: #4b78c8; }
}

/* B：@supports */
.sup-box { height: 48px; background-color: #eef0f6; display: flex; align-items: center; justify-content: center; }
@supports (display: grid) {
  .sup-box { background-color: #dfeee7; }
}

/* C：@layer —— theme 层声明在后（次序更晚 ⇒ 胜出） */
@layer base, theme;
@layer base {
  .lay-box { height: 48px; background-color: #b8722c; display: flex; align-items: center; justify-content: center; }
}
@layer theme {
  .lay-box { background-color: #5b5bd6; }
}
</style>

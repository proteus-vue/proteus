<!--
  css-conformance/pages/units.vue —— CSS 验收 · 单位

  【验收对象】px · em · rem · pt（+ vw/vh 见视口单位页；% 见 grid/flex 页；rpx 为小程序专有）
  【判据（Web 为基准）】每案例稳定 id —— 逐端按 id 定位并与 Web 并排比对。
  【案例即真实业务形态】字号缩放（em 相对父）/ 根字号（rem）/ 打印单位（pt）/ 绝对尺寸（px）。
  【★诚实边界】em/rem 依赖**运行期上下文**（父/根字号）——Web 由浏览器求值，App 端按清单 `unit-relative`
    行的口径处理（编译期无上下文 ⇒ 诊断或按根字号折叠）。
-->
<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 单位</text>
    <text class="cc-page__sub">px · em · rem · pt · Web 基准</text>

    <!-- A：px（绝对） -->
    <text class="cc-sec">A · px（绝对像素）</text>
    <view class="cc-card">
      <view id="case-px" class="u-px"><text class="t t--w">width: 120px</text></view>
    </view>

    <!-- B：em（相对父字号——父 20px ⇒ 1.5em = 30px） -->
    <text class="cc-sec">B · em（相对父字号）</text>
    <view class="cc-card">
      <view id="case-em" class="u-em-parent">
        <view class="u-em-box"><text class="t t--w">1.5em</text></view>
      </view>
    </view>

    <!-- C：rem（相对根字号） -->
    <text class="cc-sec">C · rem（相对根字号）</text>
    <view class="cc-card">
      <view id="case-rem" class="u-rem"><text class="t t--w">2rem</text></view>
    </view>

    <!-- D：pt（印刷单位） -->
    <text class="cc-sec">D · pt（印刷单位）</text>
    <view class="cc-card">
      <view id="case-pt" class="u-pt"><text class="t t--w">width: 60pt</text></view>
    </view>
  </view>
</template>

<style scoped>
.t { font-size: 12px; color: #1a1c22; }
.t--w { color: #ffffff; }

.u-px { width: 120px; height: 40px; background-color: #5b5bd6; display: flex; align-items: center; justify-content: center; }
.u-em-parent { font-size: 20px; height: 56px; display: flex; align-items: center; }
.u-em-box { width: 1.5em; height: 1.5em; background-color: #2e7d5b; display: flex; align-items: center; justify-content: center; }
.u-rem { width: 2rem; height: 32px; background-color: #b8722c; display: flex; align-items: center; justify-content: center; }
.u-pt { width: 60pt; height: 40px; background-color: #4b78c8; display: flex; align-items: center; justify-content: center; }
</style>

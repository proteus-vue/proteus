<!--
  css-conformance/pages/overflow.vue —— CSS 验收 · 溢出裁剪域（overflow / overflow-x / overflow-y）

  【验收对象（G-61 清单 P0 · 用法 10×）】overflow 族的**子内容裁剪**在真实渲染下的各端表现。
  【判据（Web 为基准）】每案例带稳定 id（`case-*`）；逐端截图按 id 定位与 Web 并排比对。
  【案例即真实业务形态】卡片封面裁切（hidden）/ 溢出可见对照（visible）/ 单轴声明（x/y 分开）。
  【★诚实边界（页面具名，不隐藏）】App 端无交互滚动：`auto`/`scroll` 的**渲染语义 = 静态裁剪**
  （与 hidden 同观感——本页 C 案即此形态）；Web 端 auto 有滚动条（截图不可滚，只看裁剪边界）。
-->
<script setup lang="ts">
// 纯静态页（验收只看真实渲染结果）
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 溢出裁剪</text>
    <text class="cc-page__sub">overflow 族 · Web 基准（浏览器真值）· 稳定 id 供逐端寻址</text>

    <!-- 案例 A：overflow:hidden —— 裁子内容（卡片封面形态；Web 真值 = 裁到 padding box） -->
    <text class="cc-sec">A · overflow: hidden（卡片裁切）</text>
    <view class="cc-card">
      <view id="case-hidden" class="ovf-box ovf-hidden">
        <view class="ovf-big ovf-big--a"></view>
      </view>
    </view>

    <!-- 案例 B：overflow:visible（默认）—— 不裁，子内容溢出可见（对照） -->
    <text class="cc-sec">B · overflow: visible（对照：溢出可见）</text>
    <view class="cc-card">
      <view id="case-visible" class="ovf-box ovf-visible">
        <view class="ovf-big ovf-big--b"></view>
      </view>
    </view>

    <!-- 案例 C：单轴声明 overflow-x:hidden + overflow-y:auto —— Web 归一回放（visible→auto ⇒ 两轴均裁） -->
    <text class="cc-sec">C · overflow-x: hidden · overflow-y: auto（单轴声明）</text>
    <view class="cc-card">
      <view id="case-single-axis" class="ovf-box ovf-single">
        <view class="ovf-big ovf-big--c"></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 裁剪宿主盒：固定小盒 + 明显溢出的子内容（裁/不裁差异一眼可辨） */
.ovf-box {
  width: 160px;
  height: 56px;
  background: #eef1f6;
  overflow: hidden;
}
.ovf-hidden { overflow: hidden; }
.ovf-visible { overflow: visible; }
/* C 案：单轴声明（Web 归一后 x=hidden y=auto ⇒ 两轴均裁） */
.ovf-single { overflow-x: hidden; overflow-y: auto; }

/* 超尺寸子内容：右下双向溢出宿主盒（裁剪边界 = 盒右缘/下缘）
   ★flex-shrink: 0 必须显式声明：App/小程序渲染引擎是 **flex 环境**（容器无 block 布局——
   固定高度容器内显式高度子项会被 flex-shrink 压到容器高 ⇒ 没有真溢出可裁）；
   Web 的 block 容器忽略该声明（子项天然溢出）⇒ 本声明是**跨端统一语义**的标准写法。 */
.ovf-big {
  width: 260px;
  height: 120px;
  flex-shrink: 0;
  border-radius: 6px;
}
.ovf-big--a { background: #5b5bd6; }
.ovf-big--b { background: #d64545; }
.ovf-big--c { background: #2e9e6b; }
</style>

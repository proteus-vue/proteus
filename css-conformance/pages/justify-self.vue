<!--
  css-conformance/pages/justify-self.vue —— CSS 验收 · 网格项行内轴自对齐域（justify-self）

  【验收对象】`justify-self`（P0 · 语料 9×——全在 grid 上下文：p-formfactor 仪表盘 KPI 卡）。
  【Web 真值（真 Chromium 已取证，2026-10-06）】仅对 **grid 项**生效（对齐到 grid 区域内的行内轴位置）；
  在 **flex 容器**下被忽略（CSS 规范：justify-self 不适用于 flex 项）；`stretch` 不覆盖显式 width。
  【案例即真实业务形态】仪表盘 KPI 单元（定宽徽章在轨道内的三种对齐）+ 反例（flex 下忽略）。
  【★诚实边界（页面具名，不隐藏）】
   · MP/Skyline：官方属性表**无** justify-self，且该端**无 Grid 容器**（display:grid 退化为 block）
     ⇒ 本页 B/C 案的「居中/靠右」在 MP 呈现为靠左（引擎锁死，具名边界，不作缺陷）；
     D 案（flex 下忽略）与 E 案（auto）在 MP 与 Web 同形（可判）。
   · 内核映射：auto ⇒ 回落父 justify-items；normal ⇒ stretch；baseline/left/right 未列（诊断跳过）。
-->
<script setup lang="ts">
// 纯静态页（验收只看真实渲染结果）
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 网格自对齐</text>
    <text class="cc-page__sub">justify-self · Web 基准（浏览器真值）· 稳定 id 供逐端寻址</text>

    <!-- 案例 A：justify-self: start —— 徽章靠轨道左缘 -->
    <text class="cc-sec">A · justify-self: start（靠左）</text>
    <view class="cc-card">
      <view id="case-start" class="js-grid">
        <view class="js-item js-item--a">
          <text class="js-item__t">已绑</text>
        </view>
      </view>
    </view>

    <!-- 案例 B：justify-self: center —— 徽章水平居中（(240-80)/2 = 80 偏移） -->
    <text class="cc-sec">B · justify-self: center（居中）</text>
    <view class="cc-card">
      <view id="case-center" class="js-grid">
        <view class="js-item js-item--b">
          <text class="js-item__t">进行中</text>
        </view>
      </view>
    </view>

    <!-- 案例 C：justify-self: end —— 徽章靠轨道右缘（240-80 = 160 偏移） -->
    <text class="cc-sec">C · justify-self: end（靠右）</text>
    <view class="cc-card">
      <view id="case-end" class="js-grid">
        <view class="js-item js-item--c">
          <text class="js-item__t">失败</text>
        </view>
      </view>
    </view>

    <!-- 案例 D：flex 容器 + justify-self: center —— **被忽略**（对照：仍靠左） -->
    <text class="cc-sec">D · flex 容器（对照：该属性被忽略）</text>
    <view class="cc-card">
      <view id="case-flex-ignored" class="js-flex">
        <view class="js-item js-item--d">
          <text class="js-item__t">待审</text>
        </view>
      </view>
    </view>

    <!-- 案例 E：auto（缺省回退）—— 回落父 justify-items（stretch 不覆盖显式宽 ⇒ 与 start 同形） -->
    <text class="cc-sec">E · auto（回落父 justify-items）</text>
    <view class="cc-card">
      <view id="case-auto" class="js-grid">
        <view class="js-item js-item--e">
          <text class="js-item__t">归档</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 网格宿主：单列 240px 轨道（定宽徽章在其内部按 justify-self 落位，差异一眼可辨） */
.js-grid {
  display: grid;
  grid-template-columns: 240px;
  width: 240px;
  background: #eef1f6;
  padding: 6px;
  box-sizing: border-box;
}

/* 反例宿主：flex 容器（Web 真值 = justify-self 被忽略） */
.js-flex {
  display: flex;
  flex-direction: row;
  width: 240px;
  background: #eef1f6;
  padding: 6px;
  box-sizing: border-box;
}

/* 徽章：定宽 80（stretch 不覆盖显式宽——Web 真值），各案不同底色便于逐案定位 */
.js-item {
  /* ★显式 display:flex —— 让下面的 align-items/justify-content 真正生效：
     Web 的 <view> 默认 display:block（两键无效 ⇒ 文字贴左上），App/Skyline 的 <view> 默认 flex
     （两键生效 ⇒ 文字居中）⇒ 不声明会让五端「徽章内文字对齐」不一致（与 justify-self 无关，是本页写法缺陷）。
     ★纪律：容器要靠 flex 对齐两轴，必须**显式** display:flex（别依赖各端默认 display 分歧）。 */
  display: flex;
  width: 80px;
  height: 32px;
  border-radius: 6px;
  align-items: center;
  justify-content: center;
}
.js-item__t {
  font-size: 13px;
  color: #ffffff;
}
.js-item--a { background: #5b5bd6; justify-self: start; }
.js-item--b { background: #d64545; justify-self: center; }
.js-item--c { background: #2e9e6b; justify-self: end; }
/* D：声明了 center，但宿主是 flex ⇒ 按 Web 真值必须被忽略（仍靠左） */
.js-item--d { background: #b06a17; justify-self: center; }
/* E：auto = 缺省回落（父 justify-items 缺省 stretch；显式宽下与 start 同形） */
.js-item--e { background: #6b4fa8; justify-self: auto; }
</style>

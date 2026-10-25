<!--
  css-conformance/pages/font.vue —— CSS 验收 · 文本样式族

  【验收对象】font-size · font-weight · font-family · line-height · letter-spacing ·
    text-align · text-decoration · color
  【判据（Web 为基准）】每案例稳定 id —— 逐端按 id 定位并与 Web 并排比对。
  【案例即真实业务形态】标题层级 / 正文行距 / 字距 / 对齐 / 下划线链接 / 删除线价格。
-->
<script setup lang="ts">
// line-height 案例需真实换行（Vue 模板会压缩文本节点空白）⇒ 走 script 常量插值
const lhText = '第一行文本\n第二行文本（行高 28px）'
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 文本样式</text>
    <text class="cc-page__sub">font-size/weight/family · line-height · letter-spacing · text-align · decoration · color</text>

    <!-- A：font-size / font-weight -->
    <text class="cc-sec">A · font-size / font-weight（字号层级）</text>
    <view class="cc-card">
      <text id="case-font-size" class="s20">20px 常规</text>
      <text id="case-font-weight" class="s16-bold">16px 加粗（700）</text>
      <text id="case-font-normal" class="s14">14px 常规（400）</text>
    </view>

    <!-- B：font-family（角色映射） -->
    <text class="cc-sec">B · font-family（字体族角色）</text>
    <view class="cc-card">
      <text id="case-font-family" class="ff-mono">monospace 0123456789</text>
    </view>

    <!-- C：line-height（行高） -->
    <text class="cc-sec">C · line-height（行盒高）</text>
    <view class="cc-card">
      <text id="case-line-height" class="lh">{{ lhText }}</text>
    </view>

    <!-- D：letter-spacing（字距） -->
    <text class="cc-sec">D · letter-spacing（字距）</text>
    <view class="cc-card">
      <text id="case-letter-spacing" class="ls">字距加宽 ABCDEF</text>
    </view>

    <!-- E：text-align（对齐） -->
    <text class="cc-sec">E · text-align（left / center / right）</text>
    <view class="cc-card">
      <view id="case-text-align" class="ta-host">
        <text class="ta-l">左对齐 left</text>
        <text class="ta-c">居中 center</text>
        <text class="ta-r">右对齐 right</text>
      </view>
    </view>

    <!-- ★★★font-style 项（2026-10-18 · 批 B F3）：斜体/倾斜（normal 作对照） -->
    <text class="cc-sec">G · font-style（斜体对齐 Web）</text>
    <view class="cc-card">
      <text id="case-font-style-normal" class="fst-normal">常规 normal（对照）</text>
      <text id="case-font-style-italic" class="fst-italic">斜体 italic Italic 123</text>
      <text id="case-font-style-oblique" class="fst-oblique">倾斜 oblique Italic 123</text>
    </view>

    <!-- ★★★text-transform 项（2026-10-18 · 批 B F3）：大小写变换（Cap 形态用于**静态文本**——MP 编译期通道） -->
    <text class="cc-sec">I · text-transform（大小写变换 · 基准 = Web）</text>
    <view class="cc-card tt-scope">
      <text id="case-text-transform-upper" class="tt-upper">Hello World 123</text>
      <text id="case-text-transform-lower" class="tt-lower">Hello World 123</text>
      <text id="case-text-transform-cap" class="tt-cap">don't 中文abc hello-world a1b</text>
      <text id="case-text-transform-inherit" class="tt-inherit">inherited caps</text>
    </view>

    <!-- ★★★text-decoration 三兄弟项（2026-10-18 · 批 B F3）：颜色 / 线型 / 线宽 -->
    <text class="cc-sec">K · text-decoration 三兄弟（颜色 / 线型 / 线宽 · 基准 = Web）</text>
    <view class="cc-card">
      <text id="case-deco-color" class="dk-color">彩色下划线（红）</text>
      <text id="case-deco-style-dotted" class="dk-dotted">点线下划线</text>
      <text id="case-deco-style-dashed" class="dk-dashed">虚线下划线</text>
      <text id="case-deco-style-double" class="dk-double">双线下划线</text>
      <text id="case-deco-thickness" class="dk-thick">加粗下划线 3px</text>
      <text id="case-deco-shorthand" class="dk-short">简写 underline 2px dashed 品牌色</text>
    </view>

    <!-- ★★★font-variant-numeric 项（2026-10-18 · 批 B F3）：等宽数字（价格/KPI 列对齐刚需） -->
    <text class="cc-sec">J · font-variant-numeric（等宽数字 · 基准 = Web）</text>
    <view class="cc-card fvn-scope">
      <text id="case-tabular-nums" class="fvn-tab">1111111111</text>
      <text id="case-variant-normal" class="fvn-prop">1111111111</text>
      <text id="case-tabular-inherit" class="fvn-plain">2222222222</text>
      <!-- ★用**比例数字**字族对照：serif（Times）的 1 明显窄于 8 ⇒ tabular 前后宽度差可见 -->
      <text id="case-tabular-serif" class="fvn-serif-tab">1111111111</text>
      <text id="case-normal-serif" class="fvn-serif-prop">1111111111</text>
    </view>

    <!-- ★★★font 简写项（2026-10-18 · 批 B F3）：重置型简写（父的 italic/3 倍行高**不得**漏进子节点） -->
    <text class="cc-sec">H · font 简写（重置型 · 基准 = Web）</text>
    <view class="cc-card fsh-wrap">
      <text id="case-font-short-all" class="fsh-all">italic bold 20px/1.5</text>
      <text id="case-font-short-reset" class="fsh-reset">16px monospace</text>
      <text id="case-font-short-order" class="fsh-order">normal normal 700 14px</text>
    </view>

    <!-- F：text-decoration + color -->
    <text class="cc-sec">F · text-decoration / color</text>
    <view class="cc-card">
      <text id="case-decoration" class="deco-underline">下划线链接</text>
      <text id="case-color" class="col-brand">品牌色文本</text>
    </view>

    <!-- I · 批 B 收尾：text-indent / word-spacing / overflow-wrap（基准 = Web） -->
    <text class="cc-sec">I · text-indent / word-spacing / overflow-wrap</text>
    <view class="cc-card">
      <view class="ti-wrap">
        <text id="case-indent" class="ti-indent">首行缩进两字宽</text>
      </view>
      <view class="ti-wrap">
        <text id="case-indent-none" class="ti-none">未声明缩进的同段落对照基线</text>
      </view>
      <text id="case-word-space-wide" class="wsp-wide">wide word spacing</text>
      <text id="case-word-space-tight" class="wsp-tight">tight word spacing</text>
      <text id="case-word-space-none" class="wsp-none">normal word spacing</text>
      <view class="ow-box">
        <text id="case-overflow-wrap" class="ow-wrap">abcdefghijklmnopqrstuvwx</text>
      </view>
      <view class="ow-box">
        <text id="case-overflow-normal" class="ow-normal">abcdefghijklmnopqrstuvwx</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.cc-card { display: flex; flex-direction: column; }
.s20 { display: block; font-size: 20px; font-weight: 400; line-height: 28px; color: #1a1c22; }
.s16-bold { display: block; font-size: 16px; font-weight: 700; line-height: 24px; color: #1a1c22; }
.s14 { display: block; font-size: 14px; font-weight: 400; line-height: 22px; color: #1a1c22; }
.ff-mono { display: block; font-family: monospace; font-size: 14px; line-height: 22px; color: #4b5058; }
.lh { display: block; font-size: 14px; line-height: 28px; color: #4b5058; }
.ls { display: block; font-size: 15px; letter-spacing: 2px; color: #1a1c22; }
.ta-host { display: flex; flex-direction: column; width: 100%; }
.ta-l { display: block; font-size: 14px; text-align: left; color: #1a1c22; }
.ta-c { display: block; font-size: 14px; text-align: center; color: #1a1c22; }
.ta-r { display: block; font-size: 14px; text-align: right; color: #1a1c22; }
.deco-underline { display: block; font-size: 14px; text-decoration: underline; color: #5b5bd6; }
.col-brand { display: block; font-size: 14px; color: #d64545; }
/* ★★★font-style 项（2026-10-18）：斜体/倾斜 —— 三端字体引擎都支持；Web 为基准。 */
.fst-normal { display: block; font-size: 16px; font-style: normal; color: #1a1c22; }
.fst-italic { display: block; font-size: 16px; font-style: italic; color: #1a1c22; }
.fst-oblique { display: block; font-size: 16px; font-style: oblique; color: #1a1c22; }
/* ★★★font 简写项（2026-10-18 · 批 B F3 · 基准 = Web）：**重置型简写**——
   父 .fsh-wrap 的 font-style:italic / line-height:3 **不应**漏进三个子节点（Web 实测如此）。
   `.fsh-order` 的多个 normal 占位也不得吞掉 700 字重。 */
.fsh-wrap { font-style: italic; line-height: 3; }
.fsh-all { display: block; font: italic bold 20px/1.5 "Helvetica Neue", sans-serif; color: #1a1c22; }
.fsh-reset { display: block; font: 16px monospace; color: #4b5058; }
.fsh-order { display: block; font: normal normal 700 14px serif; color: #1a1c22; }
/* ★★★text-transform 项（2026-10-18 · 批 B F3 · 基准 = Web）：
   `.tt-scope` 自身声明 uppercase ⇒ 子 `.tt-inherit` 未声明时**应继承**（CSS 可继承属性）。
   `.tt-upper`/`.tt-lower`/`.tt-cap` 各自覆盖。 静态文本在 MP 端由编译期变换（Skyline 无该属性）。 */
.tt-scope { display: flex; flex-direction: column; text-transform: uppercase; }
.tt-upper { display: block; font-size: 15px; color: #1a1c22; text-transform: uppercase; }
.tt-lower { display: block; font-size: 15px; color: #1a1c22; text-transform: lowercase; }
.tt-cap { display: block; font-size: 15px; color: #1a1c22; text-transform: capitalize; }
.tt-inherit { display: block; font-size: 15px; color: #4b5058; }
/* ★★★font-variant-numeric 项（2026-10-18 · 批 B F3 · 基准 = Web）：
   用**比例数字**字族（Helvetica/Arial——Web 实测 tnum 使数字宽 +55%）让差异可见。
   `.fvn-prop` 显式 normal（= proportion 数字）作对照；`.fvn-plain` 未声明 ⇒ **继承**父的 tabular-nums。 */
.fvn-scope { display: flex; flex-direction: column; font-variant-numeric: tabular-nums; font-family: system; }
.fvn-tab { display: block; font-size: 15px; color: #1a1c22; font-variant-numeric: tabular-nums; }
.fvn-prop { display: block; font-size: 15px; color: #1a1c22; font-variant-numeric: normal; }
.fvn-plain { display: block; font-size: 15px; color: #4b5058; }
.fvn-serif-tab { display: block; font-size: 15px; color: #1a1c22; font-family: serif; font-variant-numeric: tabular-nums; }
.fvn-serif-prop { display: block; font-size: 15px; color: #1a1c22; font-family: serif; font-variant-numeric: normal; }
/* ★★★text-decoration 三兄弟项（2026-10-18 · 批 B F3 · 基准 = Web）：
   线型须在**比例字体**下看才有意义（等宽字体里点线/虚线都很密）。 */
.dk-color { display: block; font-size: 15px; color: #5b5bd6; text-decoration: underline; text-decoration-color: #d64545; }
.dk-dotted { display: block; font-size: 15px; color: #1a1c22; text-decoration: underline; text-decoration-style: dotted; text-decoration-color: #d64545; }
.dk-dashed { display: block; font-size: 15px; color: #1a1c22; text-decoration: underline; text-decoration-style: dashed; text-decoration-color: #2a8a5a; }
.dk-double { display: block; font-size: 15px; color: #1a1c22; text-decoration: underline; text-decoration-style: double; text-decoration-color: #5b5bd6; }
.dk-thick { display: block; font-size: 15px; color: #1a1c22; text-decoration: underline; text-decoration-color: #d64545; text-decoration-thickness: 3px; }
.dk-short { display: block; font-size: 15px; color: #1a1c22; text-decoration: underline 2px dashed #5b5bd6; }
/* ★★★批 B F3 收尾三项（2026-10-25 · 基准 = Web 真 Chromium 实测）：
   · text-indent：只缩**首行**（后续行靠左基线）——与 `.ti-none` 对照看首行起点差异。
   · word-spacing：只改**词间空白**，字符本身间距不变（与 letter-spacing 的区别看这里）。
   · overflow-wrap：`break-word` ⇒ 长串按盒宽折断；`normal`（对照）⇒ 长串整体溢出（Web 真值）。 */
.ti-indent { display: block; font-size: 14px; line-height: 22px; color: #1a1c22; text-indent: 28px; white-space: normal; }
.ti-none { display: block; font-size: 14px; line-height: 22px; color: #4b5058; white-space: normal; }
.wsp-wide { display: block; font-size: 15px; color: #1a1c22; word-spacing: 8px; }
.wsp-tight { display: block; font-size: 15px; color: #1a1c22; word-spacing: -2px; }
.wsp-none { display: block; font-size: 15px; color: #4b5058; }
.ow-wrap { display: block; font-size: 14px; line-height: 22px; color: #5b5bd6; overflow-wrap: break-word; white-space: normal; }
.ow-normal { display: block; font-size: 14px; line-height: 22px; color: #d64545; overflow-wrap: normal; white-space: normal; }
/* ★★★真机取证的形态约束（2026-10-25）：**多行**文本放在卡片里必须包一层全宽 view ——
   直接作为 `display:flex; flex-direction:column` 卡片的子节点时 Android 端渲染空白
   （既有缺陷；既有 text 页 case-normal 就是靠这层 view 正常折行渲染的）。 */
/* ★按 text.vue 的 case-normal 同款形态（真机验证过能渲染多行长中文）：
   容器给出**显式宽度与最小高**，文本显式 `white-space: normal` + `display: block`。 */
.ti-wrap { display: flex; flex-direction: column; width: 100%; min-height: 24px; }
/* ★窄容器（90px）+ 一个放不下的 24 字符无空格串：
   `break-word` ⇒ 折断成 2 行；`normal` ⇒ 整串溢出右边界（Web 真值，实测 scrollWidth 211 > 100）。 */
.ow-box { display: flex; flex-direction: column; width: 90px; min-height: 22px; }
</style>

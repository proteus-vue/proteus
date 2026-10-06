<!--
  css-conformance/pages/word-break.vue —— CSS 验收 · 行内断词域（word-break）

  【验收对象】`word-break`（P0 · 语料 7×——长串/代码块 `break-all` · p-rich-text `break-word`）。
  【Web 真值（真 Chromium 已取证，2026-10-06）】盒宽固定，放一条长不可断串（无空格）：
   · `normal` ⇒ **词边界断**（长串整体溢出盒宽，不折行）；
   · `break-all` ⇒ **任意字符处可断**（长串按盒宽折成多行，不溢出）。
  【案例即真实业务形态】日志/ID/URL 的溢出对照（normal 溢出 vs break-all 折行）。
  【★诚实边界（页面具名）】
   ① 值集 = 四端可表达子集（normal / break-all，Skyline 官方表即此二值）；keep-all / break-word /
      auto-phrase 编译期诊断跳过。本页只验 normal / break-all。
   ② ★★**normal 语义（2026-10-09 补齐）**：Web `normal` = 词边界断、**长不可断串整串溢出（不折行）**。
      · **App 三端（自绘）已对齐 Web**：宿主对「无断点长串且溢出盒宽」显式判为**单行溢出**
        （Android `isUnbreakableToken` / iOS `effectiveWrap` / 鸿蒙 `WORD_BREAK_TYPE_NORMAL`）——
        案例 A 与 Web 一致（单行溢出、不折行）。
      · **MP/Skyline = 引擎锁死边界**：Skyline 文本引擎**恒软换行**（无「长词溢出」模式）⇒ 案例 A 在 MP 呈**折行**
        （具名豁免——引擎无对应能力，穷尽官方表后确认）。
      ★**案例 B（break-all）= 任意字符处断**在五端**一致**（均折行）——语料唯一用到的值（7× 全 break-all）。
-->
<script setup lang="ts">
// ★文本内容用脚本常量插值：Vue 模板会压缩文本节点空白，且长串需精确控制
const LONG = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 断词</text>
    <text class="cc-page__sub">word-break · Web 基准（浏览器真值）· 稳定 id 供逐端寻址</text>

    <!-- 案例 A：word-break: normal —— 长串按词边界断（整串溢出盒宽） -->
    <text class="cc-sec">A · word-break: normal（对照：长串溢出）</text>
    <view class="cc-card">
      <view id="case-normal" class="wb-box wb-normal">
        <text class="wb-txt">{{ LONG }}</text>
      </view>
    </view>

    <!-- 案例 B：word-break: break-all —— 长串任意字符处断（按盒宽折行） -->
    <text class="cc-sec">B · word-break: break-all（任意字符处断）</text>
    <view class="cc-card">
      <view id="case-break-all" class="wb-box wb-break-all">
        <text class="wb-txt">{{ LONG }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 断词宿主盒：定宽 200 + 定高 56——长串在 normal 下溢出、break-all 下折行（差异一眼可辨） */
.wb-box {
  width: 200px;
  height: 56px;
  background: #eef1f6;
  /* ★显式 display:flex —— 让文本块在盒内左上定位（Web 默认 block 亦左对齐，显式避免默认分歧） */
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  padding: 6px;
  box-sizing: border-box;
}
.wb-normal { word-break: normal; }
.wb-break-all { word-break: break-all; }

/* 文本：定字号，长串（无空格）——normal 溢出 / break-all 折行 */
.wb-txt {
  font-size: 14px;
  color: #1a1c22;
}
</style>

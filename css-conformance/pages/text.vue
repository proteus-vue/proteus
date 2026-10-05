<!--
  css-conformance/pages/text.vue —— CSS 验收 · 文本域（white-space 族）

  【验收对象（G-61 清单 P0 · 用法 24×）】`white-space` 各值在**真实渲染**下的三端表现。
  【判据（Web 为基准）】每一案例容器带稳定 id（`case-*`）——逐端截图后按 id 定位、与 Web 基准并排比对。
  【案例即真实业务形态】列表标题截断（nowrap+ellipsis）/ 正文折行（normal）/ 保留空白（pre·pre-wrap）。
  【★诚实边界】App 端文本模型为单行（不自动折行）——`normal`/`pre*` 的**真折行/保留语义**是已知结构缺口，
  本页如实呈现（视觉验收据此登记差异，不隐藏）。
-->
<script setup lang="ts">
// ★pre/pre-wrap 案例的文本必须带**真实换行与缩进**——Vue 模板编译器默认压缩文本节点空白
//   （`&#10;` 实体与源码换行都会被折成空格）⇒ 走 script 常量插值（渲染时原样进 DOM）。
const preText = '第一行\n    缩进四格第二行\n第三行'
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 文本换行</text>
    <text class="cc-page__sub">white-space 族 · Web 基准（浏览器真值）· 稳定 id 供逐端寻址</text>

    <!-- 案例 A：nowrap + 溢出省略（真实业务形态：单行标题截断） -->
    <text class="cc-sec">A · nowrap + ellipsis（列表标题截断）</text>
    <view class="cc-card">
      <view id="case-nowrap" class="cc-nowrap">
        <text class="cc-nowrap__t">这是一条非常长的标题文本用于验证单行截断与省略号显示效果</text>
      </view>
      <view id="case-nowrap-short" class="cc-nowrap">
        <text class="cc-nowrap__t">短标题</text>
      </view>
    </view>

    <!-- 案例 B：normal（默认自动换行——正文形态） -->
    <text class="cc-sec">B · normal（自动换行）</text>
    <view class="cc-card">
      <view id="case-normal" class="cc-normal">
        <text class="cc-normal__t">这是一段足够长的正文用于验证自动换行行为文字超过容器宽度时应该折行显示并在下一行继续排版</text>
      </view>
    </view>

    <!-- 案例 C：pre-wrap（保留空白 + 折行——代码/日志形态） -->
    <text class="cc-sec">C · pre-wrap（保留空白与缩进）</text>
    <view class="cc-card">
      <view id="case-pre-wrap" class="cc-pre-wrap">
        <text class="cc-pre-wrap__t">{{ preText }}</text>
      </view>
    </view>

    <!-- 案例 D：nowrap 无省略（溢出裁切——overflow:hidden 无 ellipsis） -->
    <text class="cc-sec">D · nowrap + clip（溢出裁切，无省略号）</text>
    <view class="cc-card">
      <view id="case-nowrap-clip" class="cc-nowrap-clip">
        <text class="cc-nowrap-clip__t">这是一条非常长的标题文本用于验证溢出裁切无省略号的效果</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* ── 案例 A：单行截断（nowrap + hidden + ellipsis——superapp 音乐条同款形态） ── */
.cc-nowrap {
  display: flex;
  flex-direction: row;
  align-items: center;
  overflow: hidden;
  height: 26px;
}
.cc-nowrap__t {
  font-size: 14px;
  color: var(--cc-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  display: block;
  max-width: 240px;
}

/* ── 案例 B：自动换行（normal——Web 默认） ── */
.cc-normal {
  width: 240px;
  min-height: 40px;
}
.cc-normal__t {
  font-size: 14px;
  line-height: 20px;
  color: var(--cc-text);
  white-space: normal;
  display: block;
}

/* ── 案例 C：保留空白（pre-wrap） ── */
.cc-pre-wrap {
  width: 240px;
  min-height: 60px;
}
.cc-pre-wrap__t {
  font-size: 13px;
  line-height: 20px;
  color: var(--cc-text-2);
  white-space: pre-wrap;
  display: block;
}

/* ── 案例 D：溢出裁切（nowrap + hidden，无 ellipsis） ── */
.cc-nowrap-clip {
  display: flex;
  flex-direction: row;
  align-items: center;
  overflow: hidden;
  height: 26px;
}
.cc-nowrap-clip__t {
  font-size: 14px;
  color: var(--cc-text);
  overflow: hidden;
  white-space: nowrap;
  display: block;
  max-width: 200px;
}
</style>

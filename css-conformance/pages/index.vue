<!--
  css-conformance/pages/index.vue —— CSS 验收 · 首页（逐特性索引）

  【为什么有它（用户 2026-10-09 指出）】此前本项目**没有首页导航**——每次只能用脚本
  `--es screen <名>` 打开某页，导致"桌面点开复审某一页"做不到，会漏掉其他端（修一端漏其余）。
  本页 = 可点索引：列出全部特性页，点进任意页逐端复审。

  【四端形态（B1 统一运行期）】
   · Web/MP：原生 Vue DOM/小程序渲染——`:style` / 自定义组件原生可用。
   · App（自绘）：经**统一运行期**（buildAppRuntimeContent 产 tpl/table/events/handlers →
     createScreenRuntime 实例化 + 手势派发）——`@tap="$nav('<页名>')"` 编译成 nav 动作，
     运行期交共享 `router.push` 导航（与 Web/MP 同形）。
   ★目标一律**静态字符串**（`$nav('text')`）——动态目标（`v-for` 里 `$nav(item.name)`）为后续批次
     （编译期会诊断）；故此处逐条平铺（列表写法保持直白、可静态校验）。
-->
<script setup lang="ts">
</script>

<template>
  <view class="cc-page">
    <text class="cc-page__title">CSS 验收 · 索引</text>
    <text class="cc-page__sub">逐特性页 · 点进任意页复审（Web/MP/App 一致）</text>

    <view class="ix-list">
      <view class="ix-item" @tap="$nav('text')"><text class="ix-item__t">文本换行</text><text class="ix-item__d">white-space 族</text></view>
      <view class="ix-item" @tap="$nav('word-break')"><text class="ix-item__t">断词</text><text class="ix-item__d">word-break</text></view>
      <view class="ix-item" @tap="$nav('line-clamp')"><text class="ix-item__t">多行截断</text><text class="ix-item__d">-webkit-line-clamp</text></view>
      <view class="ix-item" @tap="$nav('text-shadow')"><text class="ix-item__t">文本阴影</text><text class="ix-item__d">text-shadow</text></view>
      <view class="ix-item" @tap="$nav('border')"><text class="ix-item__t">边框</text><text class="ix-item__d">border 族</text></view>
      <view class="ix-item" @tap="$nav('border-style')"><text class="ix-item__t">边框线型</text><text class="ix-item__d">dashed / dotted</text></view>
      <view class="ix-item" @tap="$nav('outline')"><text class="ix-item__t">轮廓</text><text class="ix-item__d">outline 族</text></view>
      <view class="ix-item" @tap="$nav('overflow')"><text class="ix-item__t">溢出</text><text class="ix-item__d">overflow</text></view>
      <view class="ix-item" @tap="$nav('overflow-page')"><text class="ix-item__t">溢出（页面）</text><text class="ix-item__d">overflow 页面级</text></view>
      <view class="ix-item" @tap="$nav('grid-auto')"><text class="ix-item__t">网格轨迹</text><text class="ix-item__d">grid-auto / minmax</text></view>
      <view class="ix-item" @tap="$nav('grid-auto-flow')"><text class="ix-item__t">网格流</text><text class="ix-item__d">grid-auto-flow</text></view>
      <view class="ix-item" @tap="$nav('grid-template-areas')"><text class="ix-item__t">网格区域</text><text class="ix-item__d">grid-template-areas</text></view>
      <view class="ix-item" @tap="$nav('justify-self')"><text class="ix-item__t">网格自对齐</text><text class="ix-item__d">justify-self</text></view>
      <view class="ix-item" @tap="$nav('place-items')"><text class="ix-item__t">网格对齐</text><text class="ix-item__d">place-items</text></view>
      <view class="ix-item" @tap="$nav('math-functions')"><text class="ix-item__t">数学函数</text><text class="ix-item__d">min / max / clamp</text></view>
      <view class="ix-item" @tap="$nav('background-position')"><text class="ix-item__t">背景定位</text><text class="ix-item__d">background size/position</text></view>
      <view class="ix-item" @tap="$nav('safe-area')"><text class="ix-item__t">安全区</text><text class="ix-item__d">--pf-inset-*</text></view>
      <view class="ix-item" @tap="$nav('vw-vh')"><text class="ix-item__t">视口单位</text><text class="ix-item__d">vw / vh</text></view>
    </view>
  </view>
</template>

<style scoped>
.ix-list { display: flex; flex-direction: column; }
.ix-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background: var(--cc-surface);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 8px;
}
.ix-item__t { font-size: 15px; font-weight: 600; color: var(--cc-text); }
.ix-item__d { font-size: 12px; color: var(--cc-text-3); }
</style>

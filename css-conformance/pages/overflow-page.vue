<!--
  css-conformance/pages/overflow-page.vue —— CSS 验收 · 页面级滚动锁定（overflow-y:hidden on page root）

  【验收对象（用户 2026-10-08 点名）】**长页面**在页面根声明 `overflow-y: hidden` 时，页面**是否真不能滚动**。
  这与 #560 overflow 批的**子内容裁剪**（节点级裁切）不同——这是**页面级滚动锁定**（#560 诚实边界 a 项
  「App 端 auto/scroll 滚动交互未接」的正面验证）。

  【★Web 真值（关键，2026-10-08 真 Chromium 实测，逐值）】
   · 内容高根（min-height:100vh）+ `overflow-y:hidden` ⇒ **文档照样滚**（根不形成滚动容器）。
   · 固定高根（height:100vh）+ `overflow-y:hidden` ⇒ **不滚**（容器封住）。
   ⇒ 本页采用**固定高根 + overflow:hidden**（无歧义"锁滚"形态）。

  【★App 端语义映射（诚实边界）】App 的「页面滚动」= **整树滚动**（宿主自绘视图），非元素内滚动 ⇒
   页根声明 `overflow-y:hidden` ⇒ **整页不滚**（三端宿主按页根 overflowY 把滚动范围置 0）。
   ★App 端 `height:100vh` 落到页根会丢（`vh` 仅 min/max-* 支持）⇒ App 端"固定高根"以
   `height:100vh`(Web) / `min-height:100vh`+溢出内容(App) 两形态表达；**锁定只看页根 overflowY**，
   与是否固定高无关。
   ★内容用**静态高块**（非 v-for）——App 屏内容是静态结构，v-for 不展开（实测只折 1 行 ⇒ 无真溢出）。
-->
<template>
  <view class="cc-page ps-page ps-lock">
    <text class="cc-page__title">CSS 验收 · 页面滚动锁定</text>
    <text class="cc-page__sub">页根 overflow-y: hidden · 内容高于视口 ⇒ 应不可滚 · 稳定 id</text>

    <!-- 静态高块（2000px）——明显高于视口，保证三端都真溢出（v-for 在 App 产物里不展开） -->
    <view id="case-lock-long" class="ps-tall"></view>
  </view>
</template>

<style scoped>
/* 页根=**固定高滚动容器**（height:100vh）——Web 侧「overflow-y:hidden ⇒ 不滚」的成立前提
   （内容高根 min-height:100vh + hidden 在 Web **照样滚**）。App 端 height:100vh 落页根会丢，
   但锁定只看页根 overflow-y ⇒ 两端都锁（机制不同、行为一致）。 */
.ps-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
.ps-lock { overflow-y: hidden; }
/* 静态高块：2000px >> 视口高；flex-shrink:0 防被 flex 压缩 */
.ps-tall { height: 2000px; flex-shrink: 0; background: #cfd6e2; border-radius: 6px; }
</style>

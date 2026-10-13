<!--
  superapp/pages/glass-nav.vue —— ★★★决策 #906/#907：**悬浮玻璃导航**演示（可滚动 · 真实可交互）

  【是什么】一屏**可滚动的长内容流**（类 App Store：主图 + 多张卡片），一条**液态玻璃导航**
    **固定悬浮**在视口底部（内容**从玻璃底下滑过** ⇒ 直接看折射/位移效果，对齐 iOS）。
  【App 端】`position:fixed` 由 App 壳做滚动反向补偿（钉在视口）；玻璃折 `style.glass`。
<route>
  { "title": "悬浮玻璃导航" }
</route> -->
<template>
  <view class="gna-page">
    <view class="gna-head">
      <text class="gna-head__t">游戏</text>
      <text class="gna-head__s">向下滑动，看内容滑过悬浮玻璃</text>
    </view>

    <!-- 主推大卡 -->
    <view class="gna-hero">
      <view class="gna-hero__art" />
      <view class="gna-hero__meta">
        <text class="gna-hero__kicker">时下热门</text>
        <text class="gna-hero__title">元素，伙伴，和一个世界</text>
        <text class="gna-hero__desc">你在《原神》中会发现什么？</text>
      </view>
    </view>

    <!-- 卡片流 1（多种实色图标 ⇒ 滑过玻璃时折射可见） -->
    <view class="gna-list">
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--p" />
        <view class="gna-row__main">
          <text class="gna-row__t">王者荣耀</text>
          <text class="gna-row__d">S45 赛季 · 月照长安</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--t" />
        <view class="gna-row__main">
          <text class="gna-row__t">无畏契约：源能行动</text>
          <text class="gna-row__d">全新潮流英雄射击手游力作</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--o" />
        <view class="gna-row__main">
          <text class="gna-row__t">和平精英</text>
          <text class="gna-row__d">经典战术竞技 · 全新玩法</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--g" />
        <view class="gna-row__main">
          <text class="gna-row__t">豆包 · AI 助手</text>
          <text class="gna-row__d">生活问答 · 工作任务 · 创意设计</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--b" />
        <view class="gna-row__main">
          <text class="gna-row__t">原神</text>
          <text class="gna-row__d">开放世界冒险 · 全新版本</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--r" />
        <view class="gna-row__main">
          <text class="gna-row__t">崩坏：星穹铁道</text>
          <text class="gna-row__d">银河冒险策略 RPG</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
    </view>

    <!-- 第二张主推大卡（再一段高对比 ⇒ 滚动时玻璃明显折射） -->
    <view class="gna-hero gna-hero--2">
      <view class="gna-hero__art gna-hero__art--2" />
      <view class="gna-hero__meta">
        <text class="gna-hero__kicker">编辑精选</text>
        <text class="gna-hero__title">前世今生的情意江湖</text>
        <text class="gna-hero__desc">青蛇篇开启 · 限定英灵登场</text>
      </view>
    </view>

    <!-- 卡片流 2 -->
    <view class="gna-list">
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--g" />
        <view class="gna-row__main">
          <text class="gna-row__t">第五人格</text>
          <text class="gna-row__d">非对称对抗竞技</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--p" />
        <view class="gna-row__main">
          <text class="gna-row__t">英雄联盟手游</text>
          <text class="gna-row__d">经典 5v5 峡谷对决</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
    </view>

    <!-- ★★悬浮玻璃导航：**fixed** 钉在视口底部（内容从玻璃底下滑过）。bottom 抬到 App 壳 tab 栏之上。 -->
    <view class="gna-dock">
      <pg-glass class="gna-bar" preset="floating" :radius="30" interactive interactive-effect="surface">
        <view class="gna-bar__inner">
          <view class="gna-highlight" :style="{ left: hlLeft }" />
          <view class="gna-item" @click="setActive(0)">
            <view class="gna-item__glyph"><p-icon name="home" :size="22" /></view>
            <text class="gna-item__label">Today</text>
          </view>
          <view class="gna-item" @click="setActive(1)">
            <view class="gna-item__glyph"><p-icon name="apps" :size="22" /></view>
            <text class="gna-item__label">游戏</text>
          </view>
          <view class="gna-item" @click="setActive(2)">
            <view class="gna-item__glyph"><p-icon name="apps" :size="22" /></view>
            <text class="gna-item__label">App</text>
          </view>
          <view class="gna-item" @click="setActive(3)">
            <view class="gna-item__glyph"><p-icon name="search" :size="22" /></view>
            <text class="gna-item__label">搜索</text>
          </view>
        </view>
      </pg-glass>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const activeIdx = ref(1)
/** 高亮胶囊左偏移 px（★px 数值：App 端布局只吃数值）。条内宽 320、4 项、各 77px。 */
const hlLeft = ref(6 + 1 * 77)

function setActive(idx: number): void {
  activeIdx.value = idx
  hlLeft.value = 6 + idx * 77
}
</script>

<style scoped>
.gna-page {
  /* ★不写 position：否则它成为内部 fixed 的 containing block（=整页高）⇒ fixed 的 bottom 落到页底屏外。
     保持 static ⇒ fixed 相对根的初始包含块（≈视口），bottom 才落到视口底（对齐 iOS）。 */
  min-height: 1400px;      /* 内容够长 ⇒ 可滚动（内容从悬浮玻璃下滑过） */
  padding: var(--sa-4, 16px) 12px 200px;
  box-sizing: border-box;
  background: var(--sa-bg, #f4f5f7);
}
.gna-head__t {
  display: block;
  font-size: 32px;
  font-weight: 700;
  color: var(--sa-text, #1a1c22);
}
.gna-head__s {
  display: block;
  margin: 4px 0 14px;
  font-size: 13px;
  color: var(--sa-text-3, #8a8f99);
}
.gna-hero {
  border-radius: 18px;
  overflow: hidden;
  background: #4a52c9;
  margin-bottom: 14px;
}
.gna-hero__art {
  height: 220px;
  background: #6f78e0;
}
.gna-hero__meta { padding: 12px 14px 16px; }
.gna-hero__kicker { display: block; font-size: 12px; color: #c9ccf5; }
.gna-hero__title {
  display: block;
  margin-top: 2px;
  font-size: 22px;
  font-weight: 700;
  color: #ffffff;
}
.gna-hero__desc { display: block; margin-top: 4px; font-size: 13px; color: #d8dbf7; }
.gna-hero--2 { background: #2f7d4f; margin-top: 14px; }
.gna-hero__art--2 { background: #4aa06a; height: 240px; }
.gna-list {
  border-radius: 16px;
  background: #ffffff;
  border: 1px solid var(--sa-line, #e8eaee);
  overflow: hidden;
}
.gna-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--sa-line, #eef0f3);
}
.gna-row__ico { flex-shrink: 0; width: 46px; height: 46px; border-radius: 12px; margin-right: 12px; }
.gna-row__ico--p { background: #2f6bd8; }
.gna-row__ico--t { background: #e2504a; }
.gna-row__ico--o { background: #e8a03c; }
.gna-row__ico--g { background: #2f9d67; }
.gna-row__ico--b { background: #8a5cf0; }
.gna-row__ico--r { background: #d63d6a; }
.gna-row__main { flex: 1; min-width: 0; }
.gna-row__t { display: block; font-size: 16px; font-weight: 600; color: var(--sa-text, #1a1c22); }
.gna-row__d { display: block; margin-top: 2px; font-size: 12px; color: var(--sa-text-3, #8a8f99); }
.gna-row__btn { flex-shrink: 0; padding: 6px 18px; border-radius: 16px; background: rgba(91, 91, 214, 0.14); }
.gna-row__btn-t { font-size: 14px; font-weight: 600; color: #5b5bd6; }
/* ★悬浮玻璃导航：**fixed** 钉在视口底部（内容从玻璃底下滑过）；bottom 抬到 App 壳 tab 栏之上。 */
.gna-dock {
  position: fixed;
  left: 0;
  right: 0;
  /* ★fixed 的 containing block = 视口（引擎 #907 修复）⇒ bottom 相对视口生效（此前只能 top）。 */
  bottom: 90;
  display: flex;
  flex-direction: row;
  justify-content: center;
}
.gna-bar { width: 320px; }
.gna-bar__inner {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-around;
  height: 68px;
  padding: 6px;
  box-sizing: border-box;
}
.gna-highlight {
  position: absolute;
  top: 6px;
  bottom: 6px;
  width: 77px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.55);
}
.gna-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 56px;
}
.gna-item__glyph { display: flex; align-items: center; justify-content: center; height: 24px; color: var(--sa-text-2, #5f6673); }
.gna-item__label { font-size: 11px; font-weight: 600; line-height: 1; color: var(--sa-text-2, #5f6673); }
</style>

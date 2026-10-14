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

    <!-- ★#907：**高频纹理墙**（密集色块网格）——玻璃折射的真正素材是**高频内容**（色彩每格翻转）。
         ★App 端无图片通路（无 imageResolver）+ 布局只有单类选择器 ⇒ 用**固定网格单元 + 8 个色类循环**造高频。 -->
    <view class="gna-wall">
      <view class="gna-wall__r">
        <view class="gna-c c0" /><view class="gna-c c3" /><view class="gna-c c6" /><view class="gna-c c1" /><view class="gna-c c4" /><view class="gna-c c7" /><view class="gna-c c2" /><view class="gna-c c5" /><view class="gna-c c0" /><view class="gna-c c6" />
      </view>
      <view class="gna-wall__r">
        <view class="gna-c c5" /><view class="gna-c c2" /><view class="gna-c c7" /><view class="gna-c c4" /><view class="gna-c c1" /><view class="gna-c c6" /><view class="gna-c c3" /><view class="gna-c c0" /><view class="gna-c c7" /><view class="gna-c c2" />
      </view>
      <view class="gna-wall__r">
        <view class="gna-c c1" /><view class="gna-c c6" /><view class="gna-c c2" /><view class="gna-c c5" /><view class="gna-c c0" /><view class="gna-c c4" /><view class="gna-c c7" /><view class="gna-c c3" /><view class="gna-c c6" /><view class="gna-c c1" />
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
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--b" />
        <view class="gna-row__main">
          <text class="gna-row__t">明日方舟</text>
          <text class="gna-row__d">策略塔防 · 全新活动</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--r" />
        <view class="gna-row__main">
          <text class="gna-row__t">暗区突围</text>
          <text class="gna-row__d">硬核战术射击</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--o" />
        <view class="gna-row__main">
          <text class="gna-row__t">光遇</text>
          <text class="gna-row__d">温暖治愈的社交冒险</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--t" />
        <view class="gna-row__main">
          <text class="gna-row__t">使命召唤手游</text>
          <text class="gna-row__d">3A 级枪战体验</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--g" />
        <view class="gna-row__main">
          <text class="gna-row__t">蛋仔派对</text>
          <text class="gna-row__d">休闲竞技 · 全新赛季</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
      <view class="gna-row">
        <view class="gna-row__ico gna-row__ico--p" />
        <view class="gna-row__main">
          <text class="gna-row__t">率土之滨</text>
          <text class="gna-row__d">东方战略 · 一统天下</text>
        </view>
        <view class="gna-row__btn"><text class="gna-row__btn-t">获取</text></view>
      </view>
    </view>

    <!-- ★又一段高频纹理（滚动到此处时玻璃压其上 ⇒ 折射漩涡最明显） -->
    <view class="gna-wall">
      <view class="gna-wall__r">
        <view class="gna-c c7" /><view class="gna-c c2" /><view class="gna-c c0" /><view class="gna-c c5" /><view class="gna-c c3" /><view class="gna-c c6" /><view class="gna-c c1" /><view class="gna-c c4" /><view class="gna-c c2" /><view class="gna-c c7" />
      </view>
      <view class="gna-wall__r">
        <view class="gna-c c4" /><view class="gna-c c0" /><view class="gna-c c6" /><view class="gna-c c1" /><view class="gna-c c7" /><view class="gna-c c3" /><view class="gna-c c5" /><view class="gna-c c2" /><view class="gna-c c0" /><view class="gna-c c5" />
      </view>
    </view>

    <!-- ★#948：**黑底内容**（验证「背景明暗 → 玻璃自动调整」）——滚到此处时玻璃条正下方是纯黑 ⇒
         玻璃应变暗（深底 α 小、透出暗背景）。与上方浅色卡片交替 ⇒ 滚动即可看玻璃自动切换。 -->
    <view class="gna-dark">
      <text class="gna-dark__t">深色背景区</text>
      <text class="gna-dark__d">滚到这里 → 玻璃条应自动变深（对齐 iOS 背景自适应）</text>
    </view>

    <!-- 尾部说明（保证滑到底仍有余量） -->
    <view class="gna-footer">
      <text class="gna-footer__t">按住/拖动玻璃条 → 玻璃表面流动；上滑 → 内容从玻璃底下经过</text>
    </view>

    <!-- ★★悬浮玻璃导航：**fixed** 钉在视口底部（内容从玻璃底下滑过）。bottom 抬到 App 壳 tab 栏之上。 -->
    <view class="gna-dock">
      <!-- ★#946：条**不加白 tint**——面纱（#943 α0.91 近白）已经是"白霜"，preset floating 的 `tint rgba(255,255,255,0.18)`
           在面纱后**再提亮**把 90% 的霜面推成 100% 纯白（iOS 浅底 L253 保留一丝内容 / 我们 255 死白）⇒ 显式关掉（tint alpha 0）。 -->
      <pg-glass class="gna-bar" preset="floating" :radius="30" interactive interactive-effect="surface" tint="rgba(255,255,255,0)">
        <view class="gna-bar__inner">
          <!-- ★★★决策 #908：激活胶囊 = **第二层玻璃**（对齐 iOS App Store 选中胶囊 = 同材质的更亮规格），
               不再是 `rgba(255,255,255,0.55)` 白平铺。真机像素实证两处 artifact 都出自它：
                 ① 深色/复杂背景上是一团**无锚定的脏白斑**（白平铺不采样背景 ⇒ 与背后内容无关）；
                 ② 高亮盒盖到相邻图标 ⇒ icon 上出现月牙状裁切边。
               本处改为**同 preset 的玻璃实例**（`preset="floating"` 与条同材质，仅用 tint 提亮规格）；
               嵌套合法性见 `docs/proteus-glass-plan/11-audit-performance.md`（`<pg-glass>` 嵌套 ≤ 2 层 ⇒ 本处 1 层）。
               宿主侧：背板捕获**排除所有玻璃子树** ⇒ 胶囊采到的是**原始内容** ⇒ 观感 = "更亮的玻璃窗口"（与 iOS 同语义）。 -->
          <!-- ★`preset="floating"` 自带 `interactive: true` ⇒ 必须显式关掉：否则玻璃盒里出现**第二个可交互玻璃**，
               触点命中被胶囊抢走（原先流动的是整条 bar）——行为回归。胶囊是**静态更亮规格**（同 iOS 选中胶囊）。 -->
          <!-- ★#952：`overlay` ⇒ 胶囊**叠一层半透明中性色**（浅底→灰「light 按下」/ 深底→亮「dark 按下」）——
               与条恒有差异、可辨识，且**不动面纱 α**（透过内容的可见度与条一致）。 -->
          <pg-glass class="gna-highlight" preset="floating" :radius="24" :interactive="false" overlay tint="rgba(0,0,0,0)" :style="{ left: hlLeft }" />
          <!-- ★★★决策 #907 端到端：**v-for 行 + 行参 handler + 行内动态 `:class`**——
               正是本轮修的两面墙：B1（`pick(item.key)` 行参）+ B2（`:class` 引用外层 `active`）。
               此前这两写法在 App 端**静默失效**（点不动 + 高亮不动）。 -->
          <view
            v-for="item in navItems"
            :key="item.key"
            class="gna-item"
            @click="pick(item.key, item.pos)"
          >
            <view class="gna-item__glyph" :class="{ 'gna-item__glyph--on': active === item.key }"><p-icon :name="item.icon" :size="26" /></view>
            <text class="gna-item__label" :class="{ 'gna-item__label--on': active === item.key }">{{ item.label }}</text>
          </view>
        </view>
      </pg-glass>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

/** ★#907 端到端：导航项（**ref 数组**——普通 const 不被当响应式源，见缺口台账 A3）。 */
const navItems = ref([
  { key: 'today', pos: 0, label: 'Today', icon: 'calendar-today' },
  { key: 'games', pos: 1, label: '游戏', icon: 'local-fire-department' },
  { key: 'apps', pos: 2, label: 'App', icon: 'apps' },
  { key: 'search', pos: 3, label: '搜索', icon: 'search' },
])
/** 当前激活项 key（→ 行内 `:class` 高亮）。用 `===`（执行器只认严格相等）。 */
const active = ref('games')
/** 高亮胶囊左偏移 px（★px 数值：App 端布局只吃数值）。条内宽 320、4 项、各 77px。 */
const hlLeft = ref(6 + 1 * 91)

/** ★#907 行参 handler（B1）：两个行参 `item.key` / `item.pos` 均折进行内读取（此前静默失效）。 */
function pick(key: string, pos: number): void {
  active.value = key
  hlLeft.value = 6 + pos * 91
}
</script>

<style scoped>
.gna-page {
  /* ★不写 position：否则它成为内部 fixed 的 containing block（=整页高）⇒ fixed 的 bottom 落到页底屏外。
     保持 static ⇒ fixed 相对根的初始包含块（≈视口），bottom 才落到视口底（对齐 iOS）。 */
  min-height: 2600px;      /* 内容够长 ⇒ 上滑到底仍有内容（内容从悬浮玻璃下滑过） */
  padding: var(--sa-4, 16px) 12px 220px;
  box-sizing: border-box;
  background: var(--sa-bg, #f4f5f7);
}
/* ★#907 高频纹理墙：密集色块网格（每格换色 ⇒ 玻璃折射/漩涡的素材）。 */
.gna-wall {
  margin: 14px 0;
  border-radius: 14px;
  overflow: hidden;
}
.gna-wall__r {
  display: flex;
  flex-direction: row;
  height: 56px;
}
.gna-c {
  flex: 1;
}
.c0 { background: #e2504a; }
.c1 { background: #2f9d67; }
.c2 { background: #2f6bd8; }
.c3 { background: #e8a03c; }
.c4 { background: #8a5cf0; }
.c5 { background: #d63d6a; }
.c6 { background: #1fb6c9; }
.c7 { background: #b7c22f; }
.gna-dark {
  margin: 14px 0;
  padding: 60px 20px;
  background-color: #0b0b0f;
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.gna-dark__t { font-size: 20px; font-weight: 700; color: #ffffff; }
.gna-dark__d { font-size: 12px; color: #9aa1af; }
.gna-footer {
  margin-top: 16px;
  padding: 20px 0;
}
.gna-footer__t {
  font-size: 13px;
  color: var(--sa-text-3, #8a8f99);
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
  /* ★#922：卡片白 #ffffff → iOS App Store 列表浅灰（白霜在纯白上无区分；浅灰上可见） */
  background: #f2f2f7;
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
  /* ★#933：左右 padding 12（与 .gna-page 一致）⇒ 条与内容等宽（box-sizing 防溢出） */
  padding: 0 12px;
  box-sizing: border-box;
  /* ★fixed 的 containing block = 视口（引擎 #907 修复）⇒ bottom 相对视口生效（此前只能 top）。 */
  bottom: 90;
  display: flex;
  flex-direction: row;
  justify-content: center;
}
/* ★#933：宽 = **内容等宽**（dock 左右 padding 12 ⇒ bar 100% 填满 = 屏宽 − 24；★不写死 px——
   设备逻辑宽不同（我们 400pt / iOS 390pt），固定值必然对不齐）。 */
.gna-bar { width: 100%; }
.gna-bar__inner {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-around;
  /* ★#934：高 40→56（用户：「高度太低了」；68 太高、40 太低 ⇒ 取 ≈iOS 的 56pt）；padding 6 */
  height: 56px;
  padding: 6px;
  box-sizing: border-box;
}
/* ★★★决策 #908：激活胶囊 = 玻璃实例 ⇒ **不再有 background 平铺**（白斑 artifact 的来源）。
   仅保留几何（绝对定位 + 尺寸 + 圆角）；材质/着色由 `<pg-glass preset="floating">` + tint 决定。 */
.gna-highlight {
  position: absolute;
  /* ★#940：inset 6→1 + 圆角做满（用户「胶囊太低了，不是 iOS 那种紧贴上下两边」）。
     像素实测：iOS 选中胶囊 ≈ **满条高**（B-bottom：胶囊 143px / 条 141px，边距≈0）；
     我们原 inset 6 ⇒ 胶囊只 79% 条高（上下各留 ~10% 白）⇒ 看着像"浮着的小药丸"。
     现 inset 1 + 圆角 27（= 条高 56/2 − 1 ⇒ 胶囊呈**stadium 药丸**，两端半圆，同 iOS）。 */
  /* ★#955：inset 1→4（用户「胶囊太高了、和上下边完全没边界」；#940 的 6px「太低」/ 1px「太高」⇒ 取中）。
     可见缝 ≈ 4px 逻辑 = 12px 物理。圆角 = 半高（(56−8)/2 = 24）⇒ stadium。 */
  top: 4px;
  bottom: 4px;
  width: 91px;
  border-radius: 24px;
  /* ★决策 #936：胶囊是**装饰层**（对齐 iOS：选中胶囊在内容之下、不拦截点击）——
     否则命中测试命中的是胶囊而非导航项 ⇒ 点"选中项所在位置"点不动（真机实证 target=178）。 */
  pointer-events: none;
}
.gna-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  /* ★#934：随条高 56 恢复 */
  height: 44px;
}
/* ★#941：未选中用 --sa-text（浅底近黑 #1a1c22 / 深底近白 #eef0f5，对齐 iOS「浅底黑/深底白」）；
   此前 --sa-text-2（更浅灰）。glyph 高 24→26 随图标放大（`p-icon :size` 26）。 */
.gna-item__glyph { display: flex; align-items: center; justify-content: center; height: 26px; color: var(--sa-text); }
.gna-item__label { font-size: 11px; font-weight: 600; line-height: 1; color: var(--sa-text); }
/* ★#907 行内动态 :class（B2）可见落点：激活项图标/文字提亮（此前该绑定静默失效）。
   ★就地直接声明（**不能**用后代选择器——运行期动态类计划只解析节点自身类的直接声明，见台账）。 */
.gna-item__glyph--on { color: #2b2f7a; }
.gna-item__label--on { color: #2b2f7a; font-weight: 700; }
</style>

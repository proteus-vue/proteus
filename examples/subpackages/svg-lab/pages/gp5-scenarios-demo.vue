<!--
  examples/subpackages/svg-lab/pages/gp5-scenarios-demo.vue —— ★★★GP5：八条超级应用场景验证页

  【这张卡要验什么】《全局挂载点方案》§6 的八条场景，**任一条需要每页引入 ⇒ 方案不成立**。
    本页是 Global 层四条的验收面（Overlay 三条 = GP4-a/b/c 各自的演示页；网络状态条 = GP3-b1）：
      ④ 全局悬浮球 · ⑤ 全局音乐播放条 · ⑦ 全局主题容器 · ⑧ 全局 IM 未读角标
    ★**本页源码零全局声明**（没有 app-root / global-layer 标签，也没有任何场景元素）——
      控件调用的 `glToggle*` / `glBumpIm` 全部是**随 Global 层片段注入到本页实例的壳方法**；
      跨页一致靠共享状态通道（`_proteus/global-layer.js`，require 缓存 = 同实例）。

  【★事件写法用 `@click` 而不是 `@tap`】`@click` 两端安全（MP 编译成 `bindtap`——产
    物实测；Web 是真 DOM click）；`@tap` 在 Web 端**不绑定**（首版踩到：点了没反应）——
    本仓既有 Web 页面全部用 `@click`，这是同源纪律。

  【★双端机制（同形不同机制）】
    · MP：壳方法**编译期注入**本页实例（经 `getCurrentPages()` 取实例调用——注入的方法就在本页实例上）；
    · Web：无注入机制 ⇒ App.vue 在 onMounted 把场景控制函数挂到 `globalThis.__PROTEUS_GP5__`
      （本页经该桥调用）——**不 import 任何外部模块**（小程序侧无模块系统，跨目录 import 会落 undefined）。
    ★诚实边界（方案 §1.2-bis）：MP 端 Global 层**每页一份实例**（N = 页面栈），跨页一致靠**状态一份**——
      不得读成"单实例跨页面存活"。
-->
<script setup lang="ts">
import { ref } from 'vue'

/** 壳桥（注入到本页实例的方法名——与 App.mp.vue 的 Global 层同源） */
type ShellBridge = {
  glToggleFab?: () => void
  glToggleMusic?: () => void
  glToggleTheme?: () => void
  glBumpIm?: () => void
  glClearIm?: () => void
  data?: Record<string, unknown>
}
/** Web 桥（App.vue 注册——见头注） */
type WebBridge = {
  fabVisible?: { value: boolean }
  musicVisible?: { value: boolean }
  theme?: { value: string }
  imUnread?: { value: number }
  toggleFab?: () => void
  toggleMusic?: () => void
  toggleTheme?: () => void
  bumpIm?: () => void
  clearIm?: () => void
}

/** MP 判定：小程序运行时才有 getCurrentPages（Web 端走 globalThis 桥） */
function isMp(): boolean {
  return typeof getCurrentPages !== 'undefined'
}

/** 取当前页实例（壳方法注入在它上面） */
function currentPage(): ShellBridge | undefined {
  if (!isMp()) return undefined
  const pages = getCurrentPages() as unknown as ShellBridge[]
  return pages[pages.length - 1]
}

/** 取 Web 桥（App.vue 在 onMounted 注册；未注册时安全空操作） */
function webBridge(): WebBridge | undefined {
  const g = globalThis as unknown as Record<string, unknown>
  return (g.__PROTEUS_GP5__ as WebBridge | undefined) ?? undefined
}

/**
 * ★统一分发的纪律（本轮实测教训）：**不用动态键分发、不用联合类型参数**。
 *   ① 动态键 `p[name]`（name 为联合类型参数）会让 MP 编译器的 TS 剥除器产出
 *      "Malformed arrow function parameter list"（参数列表里出现 `() => void` 联合
 *      ⇒ 被误当箭头函数）——构建直接失败；
 *   ② 既有演示页（gp3-global-layer-demo）的**已知可用**形态 = 逐场景显式方法 + 可选链。
 *   ⇒ 每个场景一个方法：有壳方法（MP 注入）走壳；否则走 Web 桥。
 *   【为什么不能靠平台名判】Web 适配器也有 `getCurrentPages`（返回 `{route}` 快照，
 *     不带壳方法）⇒ 按平台名判会走错分支（首版即踩）⇒ **按"壳方法是否真存在"判**。
 */

/** 读数（注入字段的可观测面；e2e 也直接读 page.data） */
const readout = ref('点「刷新读数」查看注入的全局字段')

function toggleFab(): void {
  const p = currentPage()
  if (p && p.glToggleFab) {
    p.glToggleFab()
    return
  }
  const b = webBridge()
  if (b && b.toggleFab) b.toggleFab()
}
function toggleMusic(): void {
  const p = currentPage()
  if (p && p.glToggleMusic) {
    p.glToggleMusic()
    return
  }
  const b = webBridge()
  if (b && b.toggleMusic) b.toggleMusic()
}
function toggleTheme(): void {
  const p = currentPage()
  if (p && p.glToggleTheme) {
    p.glToggleTheme()
    return
  }
  const b = webBridge()
  if (b && b.toggleTheme) b.toggleTheme()
}
function bumpIm(): void {
  const p = currentPage()
  if (p && p.glBumpIm) {
    p.glBumpIm()
    return
  }
  const b = webBridge()
  if (b && b.bumpIm) b.bumpIm()
}
function clearIm(): void {
  const p = currentPage()
  if (p && p.glClearIm) {
    p.glClearIm()
    return
  }
  const b = webBridge()
  if (b && b.clearIm) b.clearIm()
}

function refresh(): void {
  const p = currentPage()
  // ★同为"按事实判"：MP 页实例带 data（注入的全局字段就在里面）；Web 快照只有 route
  if (p && p.data && 'fabVisible' in p.data) {
    const d = p.data
    readout.value =
      'theme=' + String(d.theme) + ' · imUnread=' + String(d.imUnread) +
      ' · fab=' + String(d.fabVisible) + ' · music=' + String(d.musicVisible)
  } else {
    const b = webBridge() ?? {}
    readout.value =
      'theme=' + String(b.theme?.value) + ' · imUnread=' + String(b.imUnread?.value) +
      ' · fab=' + String(b.fabVisible?.value) + ' · music=' + String(b.musicVisible?.value)
  }
}
</script>

<template>
  <view class="gp5">
    <text class="gp5-title">GP5 · 八条超级应用场景</text>
    <text class="gp5-sub">本页源码零全局声明——悬浮球/音乐条/主题/角标全部来自 App 壳 Global 层（声明一次）</text>

    <view class="gp5-block">
      <button id="gp5-fab" class="gp5-btn" @click="toggleFab">切换全局悬浮球</button>
      <button id="gp5-music" class="gp5-btn" @click="toggleMusic">切换全局音乐条</button>
      <button id="gp5-theme" class="gp5-btn" @click="toggleTheme">切换全局主题（暗 / 亮）</button>
      <button id="gp5-im-bump" class="gp5-btn" @click="bumpIm">IM 未读 +1</button>
      <button id="gp5-im-clear" class="gp5-btn gp5-btn--ghost" @click="clearIm">IM 未读清零</button>
      <button id="gp5-read" class="gp5-btn gp5-btn--ghost" @click="refresh">刷新读数</button>
      <text id="gp5-readout" class="gp5-readout">{{ readout }}</text>
    </view>

    <view class="gp5-block">
      <text class="gp5-note">跨页验证：开启后跳其它页，全局内容仍在（共享状态）</text>
      <navigator url="/pages/index" class="gp5-link">去首页</navigator>
    </view>
  </view>
</template>

<style scoped>
.gp5 {
  display: flex;
  flex-direction: column;
  padding: 24rpx;
}
.gp5-title {
  font-size: 32rpx;
  font-weight: 700;
  margin-bottom: 8rpx;
}
.gp5-sub {
  font-size: 24rpx;
  color: #666;
  margin-bottom: 24rpx;
}
.gp5-block {
  display: flex;
  flex-direction: column;
  margin-bottom: 24rpx;
}
.gp5-btn {
  margin-bottom: 16rpx;
}
.gp5-btn--ghost {
  background-color: #f2f3f5;
  color: #1f2328;
}
.gp5-readout {
  font-size: 22rpx;
  color: #8a6d3b;
  background-color: #fff7e6;
  padding: 12rpx;
}
.gp5-note {
  font-size: 22rpx;
  color: #999;
  margin-bottom: 12rpx;
}
.gp5-link {
  font-size: 26rpx;
  color: #3355aa;
}
</style>

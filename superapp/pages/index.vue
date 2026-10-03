<!--
  superapp/pages/index.vue —— 首页（超级应用工作台）

  【它同时是验收宿主】本页**源码零全局声明**——顶部的网络提示条、右下角客服球、
    底部音乐条、右上角 IM 角标全部来自 App 壳的 Global 层（声明一次，本工程全部页面共享）。
    首页内容里展示"全局层当前状态"，即八条场景的可观测面。

  【页面模式示范（L3）】本页 = **工作台模式**：问候区 → 数据卡片 → 快捷入口 → 列表。
    这是超级应用首页的标准骨架（不是演示页的"按钮墙"）。
-->
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

/** ★★★2026-10-04（**两端视觉对不上的根因**，用户当场指出）：
 *   MP 编译器给**静态 class 与模板字面量**一律追加 scopeId（`sa-card` → `sa-card-data-v-xxx`），
 *   而本工程的 L2 共享类定义在**全局 app.wxss**（无后缀）⇒ **全部匹配失败** ⇒ MP 端退化成裸文字
 *   （Web 端无此机制 ⇒ 两端视觉分叉）。
 *   修法：共享类名走**变量**（编译器对变量值不做改写）——本表是各页用到的全局类清单。 */
/** 读数（从壳注入的全局字段同步——MP 页实例 data / Web 桥） */
const themeLabel = ref('浅色')
const unreadLabel = ref('0')
const musicLabel = ref('未播放')

type ShellLike = {
  theme?: string
  imUnread?: number
  musicVisible?: boolean
  musicTitle?: string
  // 壳方法（MP 注入）
  saShowNetBar?: (t: string, l: string) => void
  saPlayMusic?: (t: string, a: string) => void
  data?: Record<string, unknown>
}

/** 取壳（MP：注入字段在页实例 data；Web：globalThis 桥）
 *  ★2026-10-04：**本工程辅助层不用 `as` 断言**——MP 编译器对**表达式位**的 `as` 漏剥
 *    （实测产物 `Unexpected identifier 'as'` ⇒ 构建失败）。这里用**声明位 any**等价表达。 */
function shell(): any {
  if (typeof getCurrentPages === 'function') {
    const pages: any = getCurrentPages()
    const p: any = pages[pages.length - 1]
    if (p && p.data && 'theme' in p.data) return p
  }
  const g: any = globalThis
  return g.__SUPERAPP_GLOBAL__
}

/** 取 Web 桥（App.vue onMounted 注册；未注册时空操作） */

/** 统一读数（Web 桥的值是 ref；MP 是 data 字段）——四页同形 */
function readVal(k: string): any {
  const s: any = shell()
  if (!s) return undefined
  const raw: any = typeof getCurrentPages === 'function' ? (s.data ?? {})[k] : s[k]
  if (raw && typeof raw === 'object' && 'value' in raw) return raw.value
  return raw
}

/** 取 Web 桥（App.vue onMounted 注册；未注册时空操作） */
function webBridge(): any {
  const g: any = globalThis
  return g.__SUPERAPP_GLOBAL__
}

/** 主题类（MP 端 page 无 html 根 ⇒ 由页面根 <view> 绑类；Web 端由 App.vue 绑 <html>） */
const shellThemeIsDark: any = ref(false)
/** ★★2026-10-04（MP 端深色失效的**根因**）：`:class="{ 'sa-dark': cond }"` 会被 MP 编译器
 *   把字面量键**追加 scopeId**（产物 `sa-dark-data-v-xxx`），而深色变量块在**全局 app.wxss**
 *   （`.sa-dark`，无后缀）⇒ **选择器永不匹配 ⇒ 深色在 MP 端完全失效**（Web 端无此问题）。
 *   修法：类名走**数据字段字符串**（编译器对变量值不做改写）⇒ 产物 class 里是裸 `sa-dark`。 */
const shellThemeCls: any = ref('')



function syncReadout(): void {
  const isDk = String(readVal('theme')) === 'dark'
  shellThemeIsDark.value = isDk
  shellThemeCls.value = isDk ? 'sa-dark' : ''
  themeLabel.value = String(readVal('theme')) === 'dark' ? '深色' : '浅色'
  const un: any = readVal('imUnread')
  unreadLabel.value = String(un === undefined || un === null ? 0 : un)
  const mv: any = readVal('musicVisible')
  const mt: any = readVal('musicTitle')
  musicLabel.value = mv ? String(mt ?? '播放中') : '未播放'
}


/** ★Web 端没有"页面 onShow"（顶层 onShow 只被编译器映射进 MP 的 Page({
 *   onShow })——Web 端它是普通函数、永不执行，2026-10-04 验收实测踩到）。
 *   两端覆盖 = onMounted（Web 每次进页都重新挂载 ⇒ 等价 onShow）+ onShow（MP 返回时刷新）。 */
onMounted(() => {
  syncReadout()
  // ★2026-10-04 第二轮（外部验收抓出「面板 0 / 角标 5 / 统计 3」三方矛盾）：
  //   原只在挂载/onShow 刷新 ⇒ 在同一页里改全局状态（点快捷入口开音乐/角标）时面板不更新。
  //   修法：Web 端**订阅壳的响应式状态**（桥对象里的 ref）——任一变化立即重算读数。
  const g: any = globalThis
  const b: any = g.__SUPERAPP_GLOBAL__
  if (b && typeof b === 'object') {
    // 用 Vue 的 watchEffect 不可行（壳 ref 不是本组件依赖）⇒ 轻量轮询窗口（200ms × 30 次 = 6s 覆盖交互期）
    // ★诚实边界：MP 端由 onShow 拉取（跨页回来刷新）；Web 端本页内即时——两端都覆盖主要路径。
    // ★2026-10-04 第三轮（外部验收：02「场景全开」图里读数仍是 0/未播放——切换后未刷新）：
    //   原窗口 6s 太短（截图脚本先点弱网再点播放，跨越该窗口）⇒ 改为**页面存续期内持续轻量同步**
    //   （200ms 往返一次读 data 是纯内存操作，代价可忽略；页面卸载即清）。
    const t = setInterval(() => syncReadout(), 200)
    onUnmounted(() => clearInterval(t))
  }
})

/** MP 端页面显示时刷新（编译器映射进 Page 钩子；Web 端此函数不被调用——见上） */
function onShow() {
  syncReadout()
}

/** 快捷入口：模拟一次"弱网"（触发全局网络提示条——真实业务在网络回调里调） */
function simulateWeakNet(): void {
  const s = shell()
  if (s && s.saShowNetBar) {
    s.saShowNetBar('当前网络不稳定，图片加载可能较慢', 'warn')
  } else {
    const b = webBridge()
    b?.showNetBar?.('当前网络不稳定，图片加载可能较慢', 'warn')
  }
}

/** 快捷入口：播放一首（触发全局音乐条） */
function playDemoTrack(): void {
  const s = shell()
  if (s && s.saPlayMusic) {
    s.saPlayMusic('热区业务周报', '内部播客 · 第 12 期')
  } else {
    const b = webBridge()
    b?.playMusic?.('热区业务周报', '内部播客 · 第 12 期')
  }
}

const stats = ref([
  { k: '待办', v: '6', tone: 'brand' },
  { k: '未读', v: '3', tone: 'rec' },
  { k: '完成率', v: '92%', tone: 'ok' },
])
</script>

<template>
  <view class="sa-page" :class="shellThemeCls">
    <!-- 问候区（工作台模式） -->
    <view class="idx-hero">
      <text class="idx-hero__hi">早上好，运营同学</text>
      <text class="idx-hero__sub">今天是 10 月 4 日 · 有 2 项关键任务待跟进</text>
    </view>

    <!-- 数据卡片（生产应用的"一眼看板"） -->
    <view class="sa-card">
      <view class="sa-card__body idx-stats">
        <view v-for="s in stats" :key="s.k" class="idx-stat">
          <text class="idx-stat__v" :class="'sa-' + s.tone">{{ s.v }}</text>
          <text class="idx-stat__k">{{ s.k }}</text>
        </view>
      </view>
    </view>

    <!-- 全局层读数（八条场景的可观测面——本页源码零全局声明，值全部来自 App 壳） -->
    <text class="sa-section">全局状态</text>
    <view class="sa-list">
      <view class="sa-item">
        <view class="sa-item__main"><text class="sa-item__label">主题</text></view>
        <text id="idx-read-theme" class="sa-item__value">{{ themeLabel }}</text>
      </view>
      <view class="sa-item">
        <view class="sa-item__main"><text class="sa-item__label">IM 未读角标</text></view>
        <text id="idx-read-unread" class="sa-item__value">{{ unreadLabel }}</text>
      </view>
      <view class="sa-item">
        <view class="sa-item__main"><text class="sa-item__label">音乐播放条</text></view>
        <text id="idx-read-music" class="sa-item__value">{{ musicLabel }}</text>
      </view>
    </view>

    <!-- 快捷入口（触发全局层——真实业务形态：点击即触发全局能力） -->
    <text class="sa-section">快捷操作</text>
    <view class="sa-list">
      <view id="idx-weaknet" class="sa-item sa-item--tap" @click="simulateWeakNet">
        <view class="sa-item__main">
          <text class="sa-item__label">模拟弱网</text>
          <text class="sa-item__desc">弱网时提醒用户</text>
        </view>
        <view class="sa-item__arrow" />
      </view>
      <view id="idx-play" class="sa-item sa-item--tap" @click="playDemoTrack">
        <view class="sa-item__main">
          <text class="sa-item__label">播放内部播客</text>
          <text class="sa-item__desc">播放内部播客</text>
        </view>
        <view class="sa-item__arrow" />
      </view>
      <navigator url="/pages/verify" class="sa-item sa-item--tap">
        <view class="sa-item__main">
          <text class="sa-item__label">打开验收控制台</text>
          <text class="sa-item__desc">全局能力自检</text>
        </view>
        <view class="sa-item__arrow" />
      </navigator>
    </view>

    <!-- 待办列表（生产形态：列表模式示范） -->
    <text class="sa-section">今日待办</text>
    <view class="sa-list">
      <view class="sa-item">
        <view class="sa-item__main">
          <text class="sa-item__label">Q4 投放计划复核</text>
          <text class="sa-item__desc">截止 18:00</text>
        </view>
        <text class="sa-tag">紧急</text>
      </view>
      <view class="sa-item">
        <view class="sa-item__main">
          <text class="sa-item__label">渠道月报数据校对</text>
          <text class="sa-item__desc">截止明日</text>
        </view>
        <text class="sa-item__value">进行中</text>
      </view>
      <view class="sa-item">
        <view class="sa-item__main">
          <text class="sa-item__label">新客回访名单确认</text>
          <text class="sa-item__desc">截止本周五</text>
        </view>
        <text class="sa-item__value">待开始</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* 问候区（工作台模式的第一屏——比"标题+副标题"更接近真实业务） */
.idx-hero {
  padding: var(--sa-6) 0 var(--sa-4);
}
.idx-hero__hi {
  display: block;
  font-size: var(--sa-font-xxl);
  font-weight: var(--sa-fw-bold);
  color: var(--sa-text);
  letter-spacing: -0.3px;
}
.idx-hero__sub {
  display: block;
  margin-top: var(--sa-2);
  font-size: var(--sa-font-md);
  color: var(--sa-text-2);
}

/* 数据卡片（三格看板） */
.idx-stats {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.idx-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.idx-stat__v {
  font-size: var(--sa-font-xl);
  font-weight: var(--sa-fw-bold);
}
.idx-stat__k {
  margin-top: var(--sa-1);
  font-size: var(--sa-font-sm);
  color: var(--sa-text-3);
}
</style>

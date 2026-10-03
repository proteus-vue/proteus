<!--
  superapp/pages/mine.vue —— 我的（设置 + 全局能力开关）

  【它承载 ⑦ 主题容器与 ④ 客服球的业务侧】设置项直接读写 App 壳的全局状态：
    · 深色模式开关 → 壳的 `saSetTheme` → 全应用即时切换（无需刷新，八条场景 ⑦ 的验收面）
    · 客服悬浮球开关 → 壳的 `saToggleFab`（④）
  【页面模式（L3）】本页 = **设置模式**：分组卡片 + 开关行 + 关于区。
-->
<script setup lang="ts">
import { ref } from 'vue'
// ★2026-10-04（生命周期体系）：页面生命周期**从框架导入**（不再写同名顶层函数）
import { onShow } from '@proteus-vue/runtime'

/** ★★★2026-10-04（**两端视觉对不上的根因**，用户当场指出）：
 *   MP 编译器给**静态 class 与模板字面量**一律追加 scopeId（`sa-card` → `sa-card-data-v-xxx`），
 *   而本工程的 L2 共享类定义在**全局 app.wxss**（无后缀）⇒ **全部匹配失败** ⇒ MP 端退化成裸文字
 *   （Web 端无此机制 ⇒ 两端视觉分叉）。
 *   修法：共享类名走**变量**（编译器对变量值不做改写）——本表是各页用到的全局类清单。 */
const darkOn = ref(false)
const fabOn = ref(true)
const musicOn = ref(false)
const versionText = 'v0.1.0 · Proteus 超级应用'

type ShellLike = {
  data?: Record<string, unknown>
  theme?: string
  fabVisible?: boolean
  musicVisible?: boolean
  saSetTheme?: (t: string) => void
  saToggleFab?: () => void
  saStopMusic?: () => void
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

/** 统一读数（Web 桥的值是 ref；MP 是 data 字段）——四页同形 */
function readVal(k: string): any {
  const s: any = shell()
  if (!s) return undefined
  const raw: any = typeof getCurrentPages === 'function' ? (s.data ?? {})[k] : s[k]
  if (raw && typeof raw === 'object' && 'value' in raw) return raw.value
  return raw
}



function syncFromShell(): void {
  const isDk = String(readVal('theme')) === 'dark'
  shellThemeIsDark.value = isDk
  shellThemeCls.value = isDk ? 'sa-dark' : ''
  darkOn.value = String(readVal('theme')) === 'dark'
  const f = readVal('fabVisible')
  fabOn.value = f === undefined ? true : Boolean(f)
  musicOn.value = Boolean(readVal('musicVisible'))
}

/** ★2026-10-04（生命周期体系）：`onShow` 从框架导入——编译期提取回调体生成 MP 的 Page 钩子，
 *   Web 端映射 onMounted（每次进页重新挂载）。**一份代码两端生效**（不再"同名函数 + onMounted"双写）。 */
onShow(() => {
  syncFromShell()
})

/** ⑦ 深色模式开关（真实业务：设置项 → 全局主题容器） */
function toggleDark(): void {
  const next = darkOn.value ? 'light' : 'dark'
  darkOn.value = !darkOn.value
  const s = shell()
  if (s && s.saSetTheme) {
    s.saSetTheme(next)
  } else {
    const b = webBridge()
    b?.setTheme?.(next)
  }
}

/** ④ 客服悬浮球开关 */
function toggleFab(): void {
  fabOn.value = !fabOn.value
  const s = shell()
  if (s && s.saToggleFab) {
    s.saToggleFab()
  } else {
    const b = webBridge()
    b?.toggleFab?.()
  }
}

/** ⑤ 关闭音乐条（开关语义：只能关不能开——开由内容页触发，符合真实逻辑） */
function closeMusic(): void {
  musicOn.value = false
  const s = shell()
  if (s && s.saStopMusic) {
    s.saStopMusic()
  } else {
    const b = webBridge()
    b?.stopMusic?.()
  }
}
</script>

<template>
  <view class="sa-page" :class="shellThemeCls">
    <view class="mine-head">
      <view class="mine-avatar"><text class="mine-avatar__t">运</text></view>
      <view class="mine-id">
        <text class="mine-id__name">运营同学</text>
        <text class="mine-id__desc">华东大区 · 渠道运营</text>
      </view>
    </view>

    <text class="sa-section">外观</text>
    <view class="sa-list">
      <view id="mine-row-dark" class="sa-item sa-item--tap" @click="toggleDark">
        <view class="mine-ico mine-ico--theme"><text class="mine-ico__t">◐</text></view>
        <view class="sa-item__main">
          <text class="sa-item__label">深色模式</text>
          <text class="sa-item__desc">全应用即时生效（无需刷新）</text>
        </view>
        <!-- ★只有行绑 @click（整行可点）；开关是**视觉指示**——点它靠冒泡由行处理。
             （曾双绑 ⇒ Web 端冒泡触发两次 ⇒ 相互抵消 ⇒ "点了没反应"；MP 端 catch 语义不冒泡故未暴露） -->
        <view id="mine-dark" class="mine-switch" :class="{ 'mine-switch--on': darkOn }">
          <view class="mine-switch__knob" />
        </view>
      </view>
    </view>

    <text class="sa-section">全局能力</text>
    <view class="sa-list">
      <view id="mine-row-fab" class="sa-item sa-item--tap" @click="toggleFab">
        <view class="mine-ico"><text class="mine-ico__t">◉</text></view>
        <view class="sa-item__main">
          <text class="sa-item__label">客服悬浮球</text>
          <text class="sa-item__desc">常驻入口，关闭后全部页面隐藏</text>
        </view>
        <view id="mine-fab" class="mine-switch" :class="{ 'mine-switch--on': fabOn }">
          <view class="mine-switch__knob" />
        </view>
      </view>
      <view class="sa-item sa-item--tap" @click="closeMusic">
        <view class="mine-ico"><text class="mine-ico__t">♪</text></view>
        <view class="sa-item__main">
          <text class="sa-item__label">音乐播放条</text>
          <text class="sa-item__desc">当前状态：{{ musicOn ? '播放中' : '未播放' }}</text>
        </view>
        <text class="sa-item__value">{{ musicOn ? '点击关闭' : '—' }}</text>
      </view>
    </view>

    <text class="sa-section">关于</text>
    <view class="sa-list">
      <navigator url="/pages/verify" class="sa-item sa-item--tap">
        <view class="sa-item__main">
          <text class="sa-item__label">验收控制台</text>
          <text class="sa-item__desc">全局能力自检</text>
        </view>
        <view class="sa-item__arrow" />
      </navigator>
      <view class="sa-item">
        <view class="sa-item__main"><text class="sa-item__label">版本</text></view>
        <text class="sa-item__value">{{ versionText }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.mine-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: var(--sa-6) 0 var(--sa-4);
}
.mine-avatar {
  width: 56px;
  height: 56px;
  border-radius: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sa-brand-soft-2);
  margin-right: var(--sa-3);
}
.mine-avatar__t {
  font-size: var(--sa-font-xl);
  font-weight: var(--sa-fw-bold);
  color: var(--sa-brand-ink);
}
.mine-id__name {
  display: block;
  font-size: var(--sa-font-lg);
  font-weight: var(--sa-fw-semibold);
  color: var(--sa-text);
}
.mine-id__desc {
  display: block;
  margin-top: 2px;
  font-size: var(--sa-font-sm);
  color: var(--sa-text-3);
}
/* ★2026-10-04：说明文字与右侧开关的**间距保证**（审计实测：说明墨迹右缘 318.5 撞开关左缘 320）
   ——`sa-item` 是 flex 行，`__main` 默认 flex:1 会被内容撑宽 ⇒ 显式限宽 + 右留白。 */
.sa-item .sa-item__main {
  padding-right: var(--sa-3);
}

/* 行前置图标（生产应用的设置行惯例：图标 + 文案 + 右侧控件） */
.mine-ico {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sa-brand-soft);
  margin-right: var(--sa-3);
}
.mine-ico__t {
  font-size: 15px;
  color: var(--sa-brand-ink);
}

/* 开关（纯 CSS——生产应用的标准开关形态） */
.mine-switch {
  flex-shrink: 0;
  width: 44px;
  height: 26px;
  border-radius: 13px;
  background: var(--sa-line);
  padding: 2px;
  box-sizing: border-box;
  transition: background-color var(--sa-dur-fast) var(--sa-ease-out);
}
.mine-switch--on {
  background: var(--sa-brand);
}
/* ★2026-10-04 修复（外部视觉验收实测："胶囊内纯白像素 = 0" ⇒ 滑块根本没渲染出来）：
   原写法 `.mine-switch__knob` 在 **scoped 样式**里对本元素生效需要 class 命中——而元素是无子内容的
   `<view>`（自闭合）⇒ 当时的实际问题：`.mine-switch` 的 `padding: 2px` + 子元素 `width:22px` 在
   flex 缺省下被压成 0 宽（无 `flex-shrink:0` 且父级未设 `display:flex`）⇒ 滑块不可见。
   修法：父级显式 flex 布局 + 滑块 `flex-shrink: 0`（并保留 box-sizing）。 */
.mine-switch {
  display: flex;
  flex-direction: row;
  align-items: center;
}
.mine-switch__knob {
  /* ★2026-10-04（实测缺陷修复）：滑块盖在开关本体上并**接走点击** ⇒ 点开关无反应。
     生产应用的开关，点滑块与点轨道都应切换 ⇒ 滑块**不接事件**（由本体接住）。 */
  pointer-events: none;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 11px;
  background: #ffffff;
  box-shadow: var(--sa-shadow-sm);
  transition: transform var(--sa-dur-fast) var(--sa-ease-out);
}
.mine-switch--on .mine-switch__knob {
  transform: translateX(18px);
}
</style>

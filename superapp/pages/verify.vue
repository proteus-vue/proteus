<!--
  superapp/pages/verify.vue —— 验收控制台（八条超级应用场景 · 逐条触发与读数）

  【它是什么】超级应用的**验收入口页**——八条场景每条一行：
    左侧说明（含"归哪层/怎么实现"），右侧触发按钮 + 实时读数。
    验收人（或自动化）在这里逐条走查，无需翻源码。

  【★本页为什么手写一个宿主】③ 登录失效拦截需要绑业务动作（`onAction` → 这里走既有导航），
    而自动注入的是裸标签（绑不了事件）⇒ **这类宿主必须手写**（且手写后自动注入让位，防双宿主）
    ——这是 GP4-c 的既有结论，也是"八条里唯一手写宿主"的例外（有理由，不是违规）。

  【①②（Toast / Loading）】Overlay 能力（GP4-a/b）——MP 端由构建期按需注入宿主，
    Web 端在 App.vue 的 Overlay 层声明一次 ⇒ 本页调 API 即可（零宿主声明）。
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue'

/** ★★★2026-10-04（**两端视觉对不上的根因**，用户当场指出）：
 *   MP 编译器给**静态 class 与模板字面量**一律追加 scopeId（`sa-card` → `sa-card-data-v-xxx`），
 *   而本工程的 L2 共享类定义在**全局 app.wxss**（无后缀）⇒ **全部匹配失败** ⇒ MP 端退化成裸文字
 *   （Web 端无此机制 ⇒ 两端视觉分叉）。
 *   修法：共享类名走**变量**（编译器对变量值不做改写）——本表是各页用到的全局类清单。 */
import type { Ref } from 'vue'
import { showToast, showLoading, hideLoading, notifyAuthExpired, markAuthRestored, isAuthExpired } from '@proteus-vue/runtime'
import { PAuthGate } from '@proteus-vue/components'

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

/** 取 Web 桥（App.vue onMounted 注册；未注册时空操作） */
function webBridge(): any {
  const g: any = globalThis
  return g.__SUPERAPP_GLOBAL__
}

/** 统一读数（Web 桥的值是 ref；MP 是 data 字段）——四页同形 */
function readVal(k: string): any {
  const s: any = shell()
  if (!s) return undefined
  const raw: any = typeof getCurrentPages === 'function' ? (s.data ?? {})[k] : s[k]
  if (raw && typeof raw === 'object' && 'value' in raw) return raw.value
  return raw
}

/** 各场景读数（验收面） */
const readout: any = ref({})
/** 操作日志（验收留痕） */
const rowLog: any = ref([])


/** 刷新全部读数（本页右侧的"验收面"） */
/** ★2026-10-04：主题类（MP 端 page 无 html 根 ⇒ 由页面根 `<view>` 绑类；Web 端由 App.vue 绑 <html>，
 *   两者共用 global.css 的 `.sa-dark` 变量覆盖块）。读的是壳注入的 theme（跨页同源）。 */
const shellThemeIsDark = ref(false)
/** ★2026-10-04（MP 深色失效根因）：类名走数据字段字符串——`:class` 字面量键会被编译器加
 *   scopeId（`sa-dark-data-v-xxx`），而变量块在全局 app.wxss（`.sa-dark`）⇒ 永不匹配。 */
const shellThemeCls: any = ref('')

function refresh(): void {
  const isDk = String(readVal('theme')) === 'dark'
  shellThemeIsDark.value = isDk
  shellThemeCls.value = isDk ? 'sa-dark' : ''
  const next: Record<string, string> = {}
  // ①②：Toast/Loading 是瞬时能力——读它们的运行态计数（runtime 端口）
  next.toast = '调 showToast() 即入队显示（宿主由构建期注入/根组件声明）'
  next.loading = '调 showLoading() 即显示（多实例共存）'
  // ③：登录失效态（唯一事实——与路由守卫同源）
  next.auth = isAuthExpired() ? '已失效（弹窗显示中）' : '正常'
  // ④-⑧：壳状态
  next.fab = readVal('fabVisible') ? '显示中' : '已隐藏'
  next.music = readVal('musicVisible') ? String(readVal('musicTitle') || '播放中') : '未显示'
  next.netbar = readVal('netBarVisible') ? '提示中' : '未显示'
  next.theme = String(readVal('theme')) === 'dark' ? '深色' : '浅色'
  const un = readVal('imUnread')
  next.im = un === undefined ? '—' : String(un)
  readout.value = next
}

/** ★Web 端没有"页面 onShow"（顶层 onShow 只被编译器映射进 MP 的
 *   `Page({ onShow })`——Web 端它是普通函数、**永不执行**，2026-10-04 验收实测踩到）。
 *   两端覆盖 = `onMounted`（Web 每次进页重新挂载 ⇒ 等价 onShow）+ `onShow`（MP 返回时刷新）。 */
onMounted(() => {
  refresh()
})

/** MP 端页面显示时刷新（编译器映射进 Page 钩子；Web 端不调用——见上） */
function onShow() {
  refresh()
}

function log(line: string): void {
  rowLog.value = [...rowLog.value.slice(-4), line]
  refresh()
}

/* ① Toast（Overlay · GP4-a：队列 + 位置 + 自定义样式） */
function t1(): void {
  showToast({ text: '已保存草稿', duration: 2000 })
  log('① showToast → 队列显示（2s 自动关）')
}
function t1b(): void {
  showToast({ text: '第一条', duration: 1500 })
  showToast({ text: '第二条', duration: 1500 })
  showToast({ text: '第三条', duration: 1500 })
  log('① 连续 3 条 → 按序显示（队列语义）')
}

/* ② Loading（Overlay · GP4-b：多实例 + 遮罩范围） */
function t2(): void {
  const id = showLoading({ text: '加载中…', mask: true })
  log('② showLoading（遮罩拦截）→ id=' + id)
}
function t2b(): void {
  showLoading({ text: '请求 A…', mask: true })
  showLoading({ text: '请求 B…', mask: false })
  log('② 两个实例共存（一个带遮罩、一个不拦——多实例语义）')
}
function t2c(): void {
  hideLoading()
  log('② hideLoading → 关闭')
}

/* ③ 登录失效拦截（Overlay · GP4-c：不可取消；★本页手写宿主——需绑 onAction） */
const actionCalls = ref(0)
function t3(): void {
  notifyAuthExpired('登录已过期，请重新登录')
  log('③ notifyAuthExpired → 弹窗（不可取消）')
}
/** 「重新登录」动作：走**既有导航**（真实业务在此 router.replace 到登录页；本工程演示回首页） */
function onAuthAction(): void {
  actionCalls.value = actionCalls.value + 1
  markAuthRestored()
  log('③ 点「重新登录」→ 收口（本工程演示：直接 markAuthRestored；真实业务走 router.replace）')
}
function t3b(): void {
  markAuthRestored()
  log('③ markAuthRestored → 恢复（模拟登录成功）')
}

/* ④ 客服球 */
function t4(): void {
  const s = shell()
  if (s && s.saToggleFab) s.saToggleFab()
  else { const b: any = webBridge(); if (b && b.toggleFab) b.toggleFab() }
  log('④ 切客服悬浮球（全局层）')
}

/* ⑤ 音乐条 */
function t5(): void {
  const s = shell()
  if (s && s.saPlayMusic) s.saPlayMusic('热区业务周报', '内部播客 · 第 12 期')
  else { const b: any = webBridge(); if (b && b.playMusic) b.playMusic('热区业务周报', '内部播客 · 第 12 期') }
  log('⑤ 播放 → 全局音乐条出现')
}
function t5b(): void {
  const s = shell()
  if (s && s.saStopMusic) s.saStopMusic()
  else { const b: any = webBridge(); if (b && b.stopMusic) b.stopMusic() }
  log('⑤ 关闭音乐条')
}

/* ⑥ 网络条 */
function t6(): void {
  const s = shell()
  if (s && s.saShowNetBar) s.saShowNetBar('当前网络不稳定，图片加载可能较慢', 'warn')
  else { const b: any = webBridge(); if (b && b.showNetBar) b.showNetBar('当前网络不稳定，图片加载可能较慢', 'warn') }
  log('⑥ 触发弱网提示条')
}
function t6b(): void {
  const s = shell()
  if (s && s.saHideNetBar) s.saHideNetBar()
  else { const b: any = webBridge(); if (b && b.hideNetBar) b.hideNetBar() }
  log('⑥ 收起提示条')
}

/* ⑦ 主题容器 */
function t7(): void {
  const s = shell()
  if (s && s.saToggleTheme) s.saToggleTheme()
  else { const b: any = webBridge(); if (b && b.toggleTheme) b.toggleTheme() }
  log('⑦ 切换主题（全应用即时生效）')
}

/* ⑧ IM 角标 */
function t8(): void {
  const s = shell()
  if (s && s.saBumpUnread) s.saBumpUnread()
  else { const b: any = webBridge(); if (b && b.bumpUnread) b.bumpUnread() }
  log('⑧ 未读 +1（跨页同步）')
}
function t8b(): void {
  const s = shell()
  if (s && s.saSetUnread) s.saSetUnread(0)
  else { const b: any = webBridge(); if (b && b.setUnread) b.setUnread(0) }
  log('⑧ 未读清零')
}
</script>

<template>
  <view class="sa-page" :class="shellThemeCls">
    <view class="vf-head">
      <text class="vf-head__title">验收控制台</text>
      <text class="vf-head__sub">八条超级应用场景 · 逐条触发并读回状态（本页 = 验收入口）</text>
    </view>

    <!-- ① Toast -->
    <view class="sa-card">
      <view class="sa-card__body">
        <view class="vf-row">
          <view class="vf-info">
            <text class="vf-name">① 全局 Toast</text>
            <text class="vf-desc">Overlay 层 · 队列语义（构建期按需注入宿主）</text>
            <text id="vf-read-toast" class="vf-read">{{ readout.toast }}</text>
          </view>
          <view class="vf-btns">
            <view id="vf-1a" class="vf-btn" @click="t1">单条</view>
            <view id="vf-1b" class="vf-btn vf-btn--ghost" @click="t1b">排队 3 条</view>
          </view>
        </view>
      </view>
    </view>

    <!-- ② Loading -->
    <view class="sa-card">
      <view class="sa-card__body">
        <view class="vf-row">
          <view class="vf-info">
            <text class="vf-name">② 全局 Loading</text>
            <text class="vf-desc">Overlay 层 · 多实例 + 遮罩范围</text>
            <text id="vf-read-loading" class="vf-read">{{ readout.loading }}</text>
          </view>
          <view class="vf-btns">
            <view id="vf-2a" class="vf-btn" @click="t2">一个</view>
            <view id="vf-2b" class="vf-btn vf-btn--ghost" @click="t2b">两个共存</view>
            <view id="vf-2c" class="vf-btn vf-btn--ghost" @click="t2c">关闭</view>
          </view>
        </view>
      </view>
    </view>

    <!-- ③ 登录失效拦截 -->
    <view class="sa-card">
      <view class="sa-card__body">
        <view class="vf-row">
          <view class="vf-info">
            <text class="vf-name">③ 登录失效拦截</text>
            <text class="vf-desc">Overlay 层 · 不可取消（★手写宿主——需绑 onAction）</text>
            <text id="vf-read-auth" class="vf-read">{{ readout.auth }}</text>
          </view>
          <view class="vf-btns">
            <view id="vf-3a" class="vf-btn" @click="t3">模拟 401</view>
            <view id="vf-3b" class="vf-btn vf-btn--ghost" @click="t3b">模拟登录成功</view>
          </view>
        </view>
      </view>
    </view>

    <!-- ④ 客服球 -->
    <view class="sa-card">
      <view class="sa-card__body">
        <view class="vf-row">
          <view class="vf-info">
            <text class="vf-name">④ 客服悬浮球</text>
            <text class="vf-desc">Global 层 · App 壳声明一次</text>
            <text id="vf-read-fab" class="vf-read">{{ readout.fab }}</text>
          </view>
          <view class="vf-btns">
            <view id="vf-4" class="vf-btn" @click="t4">切换显隐</view>
          </view>
        </view>
      </view>
    </view>

    <!-- ⑤ 音乐条 -->
    <view class="sa-card">
      <view class="sa-card__body">
        <view class="vf-row">
          <view class="vf-info">
            <text class="vf-name">⑤ 音乐播放条</text>
            <text class="vf-desc">Global 层 · 播放控制</text>
            <text id="vf-read-music" class="vf-read">{{ readout.music }}</text>
          </view>
          <view class="vf-btns">
            <view id="vf-5a" class="vf-btn" @click="t5">播放</view>
            <view id="vf-5b" class="vf-btn vf-btn--ghost" @click="t5b">关闭</view>
          </view>
        </view>
      </view>
    </view>

    <!-- ⑥ 网络条 -->
    <view class="sa-card">
      <view class="sa-card__body">
        <view class="vf-row">
          <view class="vf-info">
            <text class="vf-name">⑥ 网络状态条</text>
            <text class="vf-desc">Global 层 · 弱网提示（可忽略）</text>
            <text id="vf-read-netbar" class="vf-read">{{ readout.netbar }}</text>
          </view>
          <view class="vf-btns">
            <view id="vf-6a" class="vf-btn" @click="t6">触发</view>
            <view id="vf-6b" class="vf-btn vf-btn--ghost" @click="t6b">收起</view>
          </view>
        </view>
      </view>
    </view>

    <!-- ⑦ 主题容器 -->
    <view class="sa-card">
      <view class="sa-card__body">
        <view class="vf-row">
          <view class="vf-info">
            <text class="vf-name">⑦ 主题容器</text>
            <text class="vf-desc">Global 层 · 深/浅切换（无需刷新）</text>
            <text id="vf-read-theme" class="vf-read">{{ readout.theme }}</text>
          </view>
          <view class="vf-btns">
            <view id="vf-7" class="vf-btn" @click="t7">切换主题</view>
          </view>
        </view>
      </view>
    </view>

    <!-- ⑧ IM 角标 -->
    <view class="sa-card">
      <view class="sa-card__body">
        <view class="vf-row">
          <view class="vf-info">
            <text class="vf-name">⑧ IM 未读角标</text>
            <text class="vf-desc">Global + 状态 · 跨页同步</text>
            <text id="vf-read-im" class="vf-read">{{ readout.im }}</text>
          </view>
          <view class="vf-btns">
            <view id="vf-8a" class="vf-btn" @click="t8">+1</view>
            <view id="vf-8b" class="vf-btn vf-btn--ghost" @click="t8b">清零</view>
          </view>
        </view>
      </view>
    </view>

    <!-- 操作日志（验收留痕） -->
    <text class="sa-section">操作日志</text>
    <view class="sa-card">
      <view class="sa-card__body">
        <text v-for="(l, i) in rowLog" :key="i" class="vf-log">{{ l }}</text>
        <text v-if="rowLog.length === 0" class="vf-log vf-log--empty">（操作后在此留痕）</text>
      </view>
    </view>

    <!--
      ★③ 的宿主（手写——需绑 onAction；自动注入让位防双宿主）
      ★放置位置：**页面内容内**即可（组件内部以 teleport → root-portal 落到 Overlay 层）
    -->
    <p-auth-gate :on-action="onAuthAction" />
  </view>
</template>

<style scoped>
.vf-head {
  /* ★2026-10-04 第二轮：补左内边距（验收实测整页墨迹起于 0.5-1pt） */
  padding: var(--sa-6) var(--sa-4) var(--sa-4);
}
/* ★2026-10-04 第三轮：删掉这组 margin——它与 global.css 新增的**页 gutter**
   （.sa-page 的左右 padding）重复计入 ⇒ 本页被内缩 32px 而右侧为 0（贴死屏边，
   外部验收判 P0）。gutter 已由页面统一承担，卡片在内容区满宽（其余三页即此形态）。 */
.vf-head {
  padding-left: 0;
  padding-right: 0;
}
.sa-card {
  margin-left: 0;
  margin-right: 0;
}
.vf-head__title {
  display: block;
  font-size: var(--sa-font-xxl);
  font-weight: var(--sa-fw-bold);
  color: var(--sa-text);
  letter-spacing: -0.3px;
}
.vf-head__sub {
  display: block;
  margin-top: var(--sa-2);
  font-size: var(--sa-font-sm);
  color: var(--sa-text-2);
}

/* 行式布局（左侧信息 / 右侧按钮组）——验收场景的标准形态 */
.vf-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
}
.vf-info {
  flex: 1;
  min-width: 0;
  margin-right: var(--sa-3);
}
.vf-name {
  display: block;
  font-size: var(--sa-font-md);
  font-weight: var(--sa-fw-semibold);
  color: var(--sa-text);
}
.vf-desc {
  display: block;
  margin-top: 2px;
  font-size: var(--sa-font-xs);
  color: var(--sa-text-3);
}
.vf-read {
  display: block;
  margin-top: var(--sa-2);
  font-size: var(--sa-font-sm);
  color: var(--sa-brand-ink);
}

.vf-btns {
  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 200px;
}
.vf-btn {
  margin: 0 0 var(--sa-2) var(--sa-2);
  padding: var(--sa-2) var(--sa-3);
  border-radius: var(--sa-radius-md);
  background: var(--sa-brand);
  color: #ffffff;
  font-size: var(--sa-font-sm);
}
.vf-btn:active {
  opacity: 0.85;
}
.vf-btn--ghost {
  background: var(--sa-surface);
  color: var(--sa-text-2);
  border: 1px solid var(--sa-line);
}

.vf-log {
  display: block;
  font-family: var(--sa-mono);
  font-size: var(--sa-font-xs);
  color: var(--sa-text-2);
  line-height: var(--sa-lh-loose);
}
.vf-log--empty {
  color: var(--sa-text-3);
}
</style>

<!--
  superapp/pages/messages.vue —— 消息页（IM 会话列表）

  【它是 ⑧ 场景的业务侧（Global 层 IM 角标的数据源）】本页与 App 壳的 `imUnread`
    **读写同一份状态**：本页列表未读数变化 → 角标同步（跨页一致）。
    「全部已读」→ 角标清零；「标记一条未读」→ 角标 +1。这就是"Global + 状态"的真实形态。

  【页面模式（L3）】本页 = **列表模式**：筛选段 + 会话列表 + 底部说明。
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
import type { Ref } from 'vue'

interface Session {
  id: string
  name: string
  preview: string
  time: string
  unread: number
}

const sessions: Ref<Session[]> = ref([
  { id: 's1', name: '产品评审群', preview: '张工：新版原型已上传，请过目', time: '10:24', unread: 2 },
  { id: 's2', name: '客服工作台', preview: '系统：有 1 位用户正在等待接入', time: '09:58', unread: 1 },
  { id: 's3', name: '投放数据机器人', preview: '昨日 ROI 1.86，环比 +12%', time: '08:30', unread: 0 },
  { id: 's4', name: '合规提醒', preview: '素材复审截止今日 18:00', time: '昨天', unread: 0 },
])

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

/** 未读总数（列表派生——单一事实源在本页，写入壳 ⇒ 角标同步） */
const totalUnread: any = ref(0)

/** 主题类（MP 端 page 无 html 根 ⇒ 由页面根 <view> 绑类） */
const shellThemeIsDark: any = ref(false)
/** ★★2026-10-04（MP 端深色失效的**根因**）：`:class="{ 'sa-dark': cond }"` 会被 MP 编译器
 *   把字面量键**追加 scopeId**（产物 `sa-dark-data-v-xxx`），而深色变量块在**全局 app.wxss**
 *   （`.sa-dark`，无后缀）⇒ **选择器永不匹配 ⇒ 深色在 MP 端完全失效**（Web 端无此问题）。
 *   修法：类名走**数据字段字符串**（编译器对变量值不做改写）⇒ 产物 class 里是裸 `sa-dark`。 */
const shellThemeCls: any = ref('')



function syncToShell(): void {
  const isDk = String(readVal('theme')) === 'dark'
  shellThemeIsDark.value = isDk
  shellThemeCls.value = isDk ? 'sa-dark' : ''
  const n = sessions.value.reduce((acc, s) => acc + s.unread, 0)
  totalUnread.value = n
  const s = shell()
  if (!s) return
  if (s.saSetUnread) {
    s.saSetUnread(n)
  } else {
    const b = webBridge()
    b?.setUnread?.(n)
  }
}

/** ★2026-10-04（生命周期体系）：`onShow` 从框架导入——编译期提取回调体生成 MP 的 Page 钩子，
 *   Web 端映射 onMounted（每次进页重新挂载）。**一份代码两端生效**（不再"同名函数 + onMounted"双写）。 */
onShow(() => {
  // 首次进入把列表未读灌进壳（打开应用即见角标——真实形态）
  syncToShell()
})

/** 标记一条未读（模拟新消息到达） */
function markOneUnread(): void {
  const first = sessions.value[0]
  if (!first) return
  first.unread = first.unread + 1
  syncToShell()
}

/** 全部已读 */
function markAllRead(): void {
  for (const s of sessions.value) s.unread = 0
  syncToShell()
}

/** 点会话（已读该条） */
function openSession(id: string): void {
  const s = sessions.value.find((x) => x.id === id)
  if (!s) return
  s.unread = 0
  syncToShell()
}
</script>

<template>
  <view class="sa-page" :class="shellThemeCls">
    <view class="msg-head">
      <text class="msg-head__title">消息</text>
      <text id="msg-total" class="msg-head__total">未读 {{ totalUnread }}</text>
    </view>

    <!-- 筛选段（生产列表页的标准头部操作区） -->
    <view class="msg-actions">
      <view id="msg-mark-one" class="msg-action" @click="markOneUnread">标记一条未读</view>
      <view id="msg-mark-all" class="msg-action" @click="markAllRead">全部已读</view>
    </view>

    <!-- 会话列表（列表模式） -->
    <view class="sa-list">
      <view v-for="s in sessions" :key="s.id" class="sa-item sa-item--tap" @click="openSession(s.id)">
        <view class="msg-avatar">
          <text class="msg-avatar__text">{{ s.name.slice(0, 1) }}</text>
        </view>
        <view class="sa-item__main">
          <text class="sa-item__label">{{ s.name }}</text>
          <text class="sa-item__desc">{{ s.preview }}</text>
        </view>
        <view class="msg-meta">
          <text class="msg-meta__time">{{ s.time }}</text>
          <text v-if="s.unread > 0" class="sa-badge">{{ s.unread }}</text>
        </view>
      </view>
    </view>

    
  </view>
</template>

<style scoped>
.msg-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  padding: var(--sa-6) var(--sa-4) var(--sa-3);
}
.msg-head__title {
  font-size: var(--sa-font-xxl);
  font-weight: var(--sa-fw-bold);
  color: var(--sa-text);
  letter-spacing: -0.3px;
}
.msg-head__total {
  font-size: var(--sa-font-sm);
  color: var(--sa-text-3);
}

.msg-actions {
  display: flex;
  flex-direction: row;
  padding: 0 0 var(--sa-3);
}
.msg-action {
  margin-right: var(--sa-3);
  padding: var(--sa-2) var(--sa-3);
  border-radius: var(--sa-radius-md);
  background: var(--sa-surface);
  border: 1px solid var(--sa-line);
  font-size: var(--sa-font-sm);
  color: var(--sa-text-2);
}
.msg-action:active {
  background: var(--sa-surface-2);
}

.msg-avatar {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sa-brand-soft);
  margin-right: var(--sa-3);
}
.msg-avatar__text {
  font-size: var(--sa-font-md);
  font-weight: var(--sa-fw-semibold);
  color: var(--sa-brand-ink);
}

.msg-meta {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.msg-meta__time {
  font-size: var(--sa-font-xs);
  color: var(--sa-text-3);
  margin-bottom: 4px;
}

.msg-note {
  display: block;
  padding: var(--sa-2) 0;
  font-size: var(--sa-font-xs);
  color: var(--sa-text-3);
}
</style>

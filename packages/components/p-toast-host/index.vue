<!-- src/components/p-toast-host/index.vue —— ★★★GP4-a（2026-10-03）：Toast 队列宿主（Overlay 层）

     【它与 p-toast 的分工（别混）】
       · `p-toast`（既有）= **声明式单条**提示（父级给 visible/text，组件只渲染 + 到点 emit close）
         ——适合"页面里固定位置的一个提示块"，是用户可自由摆放的组件
       · `p-toast-host`（本组件）= **命令式队列的渲染端**：订阅 runtime 的 toast 队列
         （`subscribeToast`），自己不知道该显示什么——队列说显示谁就显示谁
         ⇒ 业务侧只调 `showToast({...})`，**源码零模板改动**（MP 端宿主由构建期按需注入每页）

     【三条硬约束（都是真机踩出来的，别"顺手改回去"）】
       ① **Overlay 层**（任务卡硬约束：Toast 不得混入 Global 层）⇒ `<teleport to="body">`
          （编译期 → `root-portal`，脱离页面层叠）。
       ② **portal 根常驻 + 全屏**：teleport 的**直接子元素**绝不放 v-if（S47：portal 内容条件卸载
          会锁死页面——编译器已机器化该判据）；且 Skyline 下 `position: fixed` **只有 portal 内 +
          四边撑满**才构成视口坐标系（S42；p-drawer 同款）——面板再以 absolute 相对它定位。
          ★首跑真实缺陷：面板自身 fixed 而父容器无尺寸 ⇒ 面板塌成 0×0（截图看不见、查询无几何）。
       ③ **动态类名一律字面量键**（T12/A 同族）：`:class="'p-toast-host--' + position"` 会被编译成
          `'p-toast-host---' + scopeId + position` ⇒ 拼出 `...-data-v-xxxcenter`，**与任何 CSS 都不匹配**
          ⇒ 根容器没有 top ⇒ 面板塌陷 ⇒ **整条提示不可见且零报错**（首跑第二个真实缺陷）。
          ⇒ 位置/可见性类都用 `{ 'literal-key': cond }` 形态（p-drawer 同款）。

     【★诚实边界（方案 §1.2-bis 同源）】MP 端每页一份宿主实例（N = 页面栈深度），
       但队列状态是模块级单例 ⇒ "实例 N 份、状态一份"（同 custom-tab-bar 模式）。 -->
<template>
  <teleport to="body">
    <view
      id="p-toast-host-root"
      class="p-toast-host"
      :class="{
        'p-toast-host--top': position === 'top',
        'p-toast-host--bottom': position === 'bottom',
        'p-toast-host--center': position !== 'top' && position !== 'bottom',
      }"
    >
      <view
        id="p-toast-host-panel"
        class="p-toast-host__panel"
        :class="{
          'p-toast-host__panel--on': current !== null,
          'p-toast-host__panel--tap': current !== null && current.dismissible,
        }"
        :style="toneStyle"
        @tap="onPanelTap"
      >
        <text class="p-toast-host__text">{{ currentText }}</text>
      </view>
    </view>
  </teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { Ref } from 'vue'
// ★GP4-a：队列状态与调度在 runtime（模块级单例）；本组件只做**渲染端**
import { subscribeToast, toastSnapshot, hideToast } from '@proteus-vue/runtime'
import type { ToastItem, ToastSnapshot } from '@proteus-vue/runtime'

const props = defineProps({
  pid: { type: String, default: '' },
})

// ★★初值必须**静态可求值**（`ref(null)`/`ref('center')`）——不能写 `ref<T>(运行时调用)`，也不能带
//   类型实参（`ref<X|null>(null)`）：MP 侧初值无法静态求值 ⇒ 落 undefined + 编译器告警（首版即触发）。
const current: Ref<ToastItem | null> = ref(null)
const position = ref('center')

/** 面板文本（`current` 可空——避免模板里散落链式判空） */
const currentText = computed(() => (current.value ? current.value.text : ''))

/**
 * 色彩语义 → CSS 变量（宿主可经 `--p-toast-<type>` 换色；缺省值 = 组件库常规色）。
 * ★在 script 里拼好（不在模板里写字符串表达式）——见文件头约束③（动态表达式在 MP 侧不可靠）。
 */
const toneStyle = computed(() => {
  const t = current.value ? current.value.type : 'info'
  const fallback =
    t === 'success' ? '#07c160' : t === 'warn' ? '#fa9d3b' : t === 'error' ? '#fa5151' : 'rgba(0, 0, 0, 0.75)'
  return `--p-toast-tone: var(--p-toast-${t}, ${fallback})`
})

let unsubscribe: (() => void) | null = null

/** 把快照投影到本地状态（订阅与首帧补齐共用同一处——防两处写法漂移） */
function applySnapshot(snap: ToastSnapshot): void {
  current.value = snap.current
  // ★位置只在**有新条目**时更新（当前项尚未结束时不因队列推进抖动）
  if (snap.current) position.value = snap.current.position
}

onMounted(() => {
  /* ★落痕（e2e 与真机排障的组件侧观测面）
   *
   * 【为什么需要】宿主在 `root-portal` 内 ⇒ 它**不在页面的组件树**里 ⇒ 页面级
   *   `selectComponent` / `createSelectorQuery` **一律查不到**（本轮实测：四种选择器全 null）。
   *   ⇒ 组件自己把**实际渲染的那一条**写出来，e2e 与排障才有可断言/可读的通道。
   *
   * 【★★为什么按页面路由分桶（本轮真机缺陷）】reLaunch/导航时**多个宿主实例会短时共存**
   *   （新页 ready 早于旧页 detached）——若都写同一个全局键，**旧实例会覆盖新实例**，
   *   读到的永远是"上一条 toast"或 null（本轮 e2e 一度据此误判"订阅没生效"）。
   *   ⇒ 以**当前页 route** 为键分桶 + 每桶带时间戳：读的是"这一页的宿主渲染了什么"。
   */
  const g = globalThis as unknown as Record<string, unknown>
  g.__PROTEUS_TOAST_HOST_MOUNTED__ = (Number(g.__PROTEUS_TOAST_HOST_MOUNTED__) || 0) + 1
  const routeOf = (): string => {
    try {
      const pages = (getCurrentPages?.() ?? []) as Array<{ route?: string }>
      return pages.length ? pages[pages.length - 1].route ?? 'unknown' : 'unknown'
    } catch {
      return 'unknown'
    }
  }
  const render = (snap?: ToastSnapshot): void => {
    const c = current.value
    const entry = {
      text: c ? c.text : null,
      position: position.value,
      type: c ? c.type : null,
      at: Date.now(),
      // ★诊断：本次收到的快照（区分"快照里就没有 current"与"投影丢了"）
      snapCur: snap ? (snap.current ? snap.current.text : null) : 'n/a',
    }
    const byPage = (g.__PROTEUS_TOAST_RENDER_BY_PAGE__ as Record<string, unknown>) || {}
    byPage[routeOf()] = entry
    g.__PROTEUS_TOAST_RENDER_BY_PAGE__ = byPage
    // 兼容单键读取（最近一次渲染——不分页；诊断用）
    g.__PROTEUS_TOAST_RENDER__ = entry
  }
  // ★订阅队列变化（runtime 的 notify 携带完整快照——本组件只投影 current/position）
  unsubscribe = subscribeToast((snap: ToastSnapshot) => {
    applySnapshot(snap)
    render(snap)
  })
  // 订阅前的状态变化补齐（宿主挂载晚于首次 showToast 的场景——见 showToast 的"无宿主提示"注释）
  applySnapshot(toastSnapshot())
  render()
})

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
})

/** 点击提示本体（仅 dismissible 的条目可关） */
function onPanelTap(): void {
  if (current.value && current.value.dismissible) hideToast(current.value.id)
}

void props
</script>

<style scoped>
/* 全屏根 = 视口坐标系（portal 内 fixed + 四边撑满——Skyline 正解，抄 p-drawer/p-modal） */
.p-toast-host {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
}
/* 面板：相对全屏根的绝对定位锚点（位置类由根容器承载——见 template 的字面量键） */
.p-toast-host__panel {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  max-width: 280px;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--p-toast-tone, rgba(0, 0, 0, 0.75));
  /* 常驻 + 类门控可见性（不用 v-if 卸载——S47 约束，见文件头） */
  visibility: hidden;
  opacity: 0;
}
.p-toast-host--top .p-toast-host__panel {
  top: 60px;
}
.p-toast-host--center .p-toast-host__panel {
  top: 50%;
  transform: translate(-50%, -50%);
}
.p-toast-host--bottom .p-toast-host__panel {
  bottom: 100px;
}
.p-toast-host__panel--on {
  visibility: visible;
  opacity: 1;
  animation: proteus-toast-host-in 200ms ease-out;
}
.p-toast-host__text {
  color: var(--p-toast-color, #fff);
  font-size: 14px;
}
@keyframes proteus-toast-host-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>

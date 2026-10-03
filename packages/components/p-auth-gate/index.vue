<!-- src/components/p-auth-gate/index.vue —— ★★★GP4-c（2026-10-03）：**登录失效拦截弹窗**（不可取消）

     【它与 p-modal / p-page-container 的区别（本组件的存在理由）】
       · `p-modal` / `p-page-container` 是**可取消**的弹层（有关闭按钮、点遮罩可关）——这是绝大多数
         弹窗的正确默认。
       · 本组件是**不可取消**的模态：无关闭按钮、点遮罩**不关**、`closable/maskClosable` **不开放**
         （不给"配置成可关"的口子——任务卡硬约束："不可取消的模态弹窗（无关闭按钮、不响应返回键）"）。
       · 它的唯一出口是：**登录态恢复**（`markAuthRestored()`）⇒ 由"登录成功"这一业务事实驱动关闭，
         而不是用户点一下就能关掉（那会让用户把失效弹窗当成普通提示忽略掉，然后在后续操作里处处失败）。

     【它与路由守卫的关系（★任务卡硬约束："不得新建独立的全局拦截机制"）】
       本组件**不是**拦截机制——它是既有守卫那套状态的**可视出口**：
       `packages/runtime/src/auth-gate.ts` 的 `expired` 是唯一事实，守卫（导航时）与它（401 时）
       读同一份状态；恢复也走业务注入的**既有导航**（`onRestored` 里 router.replace）。
       ⇒ 组件只做两件事：显示"失效了"、提供"去重新登录"这一个动作（动作交给业务回调）。

     【命中与层叠（与 p-toast-host/p-loading-host 同源的既有结论，勿自行发明）】
       · `<teleport to="body">` → 编译期 `root-portal`（Overlay 层；弹层不得混入 Global 层）
       · portal 根**常驻 + 四边撑满**（Skyline：`position:fixed` 需 portal 内撑满才成视口坐标系）
       · **拦截挂根容器**（Skyline 下遮罩元素自身不参与命中测试——p-drawer 实证）
       · 动态类名一律**字面量键**（拼串会被编译期插 scopeId ⇒ 与 CSS 不匹配 ⇒ 不可见且零报错）

     【★诚实边界（§1.2-bis 同源）】MP 端每页一份实例；失效状态是模块级单例 ⇒ "实例 N 份、状态一份"。 -->
<template>
  <teleport to="body">
    <!-- 根：常驻全屏 + 承载拦截（点它**不关**——唯一出口是登录态恢复） -->
    <view
      id="p-auth-gate-root"
      class="p-auth-gate"
      :class="{ 'p-auth-gate--on': expired }"
      @catchtap="onRootTap"
    >
      <view class="p-auth-gate__mask" />
      <view id="p-auth-gate-panel" class="p-auth-gate__panel" @catchtap="onPanelTap">
        <text class="p-auth-gate__title">登录已失效</text>
        <text class="p-auth-gate__message">{{ message }}</text>
        <view id="p-auth-gate-action" class="p-auth-gate__action" @tap="onActionTap">
          <text class="p-auth-gate__action-text">{{ actionText }}</text>
        </view>
      </view>
    </view>
  </teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { subscribeAuthGate, authGateState, markAuthRestored } from '@proteus-vue/runtime'
import type { AuthGateState } from '@proteus-vue/runtime'

const props = defineProps({
  pid: { type: String, default: '' },
  /** "去重新登录"动作的文案（业务可改） */
  actionText: { type: String, default: '重新登录' },
  /**
   * 点击动作按钮时调用（业务在此走**既有导航**：`router.replace({ name: 'login' })`）。
   * ★本组件**不自己导航**——导航归业务/守卫，组件只管显示与转达（否则就是"新建拦截机制"）。
   */
  onAction: { type: Function, default: null },
})

// ★初值静态可求值（`ref(false)`/`ref('')`）——带类型实参的调用在 MP 侧初值无法静态求值
const expired = ref(false)
const message = ref('')

let unsubscribe: (() => void) | null = null

/** 把状态投影到本地（订阅与首帧补齐共用一处——防两处写法漂移） */
function apply(state: AuthGateState): void {
  expired.value = state.expired
  message.value = state.message
}

onMounted(() => {
  /* ★落痕（e2e 与真机排障的组件侧观测面）：与 GP4-a/b 同源——
     组件在 root-portal 内 ⇒ 页面级 selectComponent/selectorQuery 一律查不到 */
  const g = globalThis as unknown as Record<string, unknown>
  g.__PROTEUS_AUTH_GATE_HOST_MOUNTED__ = (Number(g.__PROTEUS_AUTH_GATE_HOST_MOUNTED__) || 0) + 1
  const routeOf = (): string => {
    try {
      const pages = (getCurrentPages?.() ?? []) as Array<{ route?: string }>
      return pages.length ? (pages[pages.length - 1].route ?? 'unknown') : 'unknown'
    } catch {
      return 'unknown'
    }
  }
  const trace = (): void => {
    const byPage = (g.__PROTEUS_AUTH_GATE_RENDER_BY_PAGE__ as Record<string, unknown>) || {}
    byPage[routeOf()] = { expired: expired.value, message: message.value, at: Date.now() }
    g.__PROTEUS_AUTH_GATE_RENDER_BY_PAGE__ = byPage
  }
  unsubscribe = subscribeAuthGate((state) => {
    apply(state)
    trace()
  })
  apply(authGateState())
  trace()
})

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
})

/** 点根容器：**不关**（不可取消——吞掉点击即可，唯一出口是登录态恢复） */
function onRootTap(): void {
  /* 显式空实现：`@catchtap` 已吞掉冒泡 ⇒ 页面收不到 ⇒ 模态语义成立 */
}

/** 点面板：吞冒泡（面板内点击不算"点遮罩"） */
function onPanelTap(): void {
  /* 同上（catch 语义由 @catchtap 承载） */
}

/** 点动作按钮：转达给业务（业务走既有导航）；★不在此处 markAuthRestored——
 *  登录是否真的成功由业务判定（那是"守卫的事实"），组件无权宣称已恢复。 */
function onActionTap(): void {
  const fn = props.onAction as (() => void) | null
  if (typeof fn === 'function') fn()
  else {
    // 未注入动作：给出可见指引（不静默——用户点了没反应是最坏形态）
    const g = globalThis as unknown as Record<string, unknown>
    g.__PROTEUS_AUTH_GATE_NO_ACTION__ = true
    console.warn('[proteus/auth-gate] 未注入 onAction——"重新登录"按钮无动作。请在宿主上绑定 onAction（内部走既有导航）')
  }
}

void markAuthRestored // 导出保持可见（业务在登录成功后调用它恢复状态）
void props
</script>

<style scoped>
/* 常驻全屏根（Skyline：portal 内 fixed + 四边撑满 = 视口坐标系；拦截靠 catchtap 语义）
   ★可见性用**类门控**（`--on`）而不是 v-if：S47（portal 内容条件卸载会锁死页面）+ GP4-b 的
     "display 切换在 portal 内不重排"两处结论都在此适用 ⇒ 元素常驻、只切可见性。
   ★`display: none` 不用（GP4-b 实证：portal 内不重排 ⇒ 切不回来）；用 visibility+opacity。 */
.p-auth-gate {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2000020; /* ★Overlay 域内最高（模态在浮层之上）——原 10000 < 页面层 1e6 ⇒ 弹窗被页面文字压住（外部验收实测） */
  visibility: hidden;
  opacity: 0;
}
.p-auth-gate--on {
  visibility: visible;
  opacity: 1;
}
.p-auth-gate__mask {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
}
.p-auth-gate__panel {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 280px;
  padding: 20px 20px 16px;
  border-radius: 12px;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.p-auth-gate__title {
  font-size: 17px;
  font-weight: 600;
  color: #1f2328;
}
.p-auth-gate__message {
  margin-top: 8px;
  font-size: 14px;
  color: #666666;
  text-align: center;
}
.p-auth-gate__action {
  margin-top: 18px;
  width: 100%;
  height: 40px;
  border-radius: 8px;
  /* ★2026-10-04：可主题化（外部验收实测"CTA 亮蓝与应用主色靛蓝不是同一品牌色"）
     ——默认值不变（向后兼容），应用以 `--p-auth-gate-action-bg` 覆盖为自己的品牌色。 */
  background: var(--p-auth-gate-action-bg, #1a7af8);
  display: flex;
  align-items: center;
  justify-content: center;
}
.p-auth-gate__action-text {
  color: #ffffff;
  font-size: 15px;
}
</style>

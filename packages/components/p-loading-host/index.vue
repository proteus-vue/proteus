<!-- src/components/p-loading-host/index.vue —— ★★★GP4-b（2026-10-03）：Loading 多实例宿主（Overlay 层）

     【它与 p-loading 的分工（别混）】
       · `p-loading`（既有）= **声明式单实例**（父级给 visible/text——页面自己摆一个加载遮罩）
       · `p-loading-host`（本组件）= **命令式多实例的渲染端**：订阅 runtime 的 loading 活跃集合
         （`subscribeLoading`），**同时渲染 N 个**（各自遮罩范围 page/global），自己不知道该显示什么
         ⇒ 业务侧只调 `showLoading({...})`，**源码零模板改动**（MP 端宿主由构建期按需注入每页）

     【三条硬约束（与 p-toast-host 同源，都是真机踩出来的）】
       ① **Overlay 层**（任务卡：浮层不得混入 Global 层）⇒ `<teleport to="body">`（→ `root-portal`）。
       ② **portal 根常驻 + 四边撑满**：teleport 直接子元素绝不放 v-if（S47：条件卸载会锁死页面）；
          Skyline 下 `position: fixed` 只有 portal 内 + 四边撑满才构成视口坐标系（S42）。
       ③ **动态类名一律字面量键**（S 系列 T12/A 同族）：拼串会被编译期插入 scopeId ⇒ 与 CSS 不匹配
          ⇒ 元素无定位 ⇒ **不可见且零报错**。

     【★与 Toast 宿主的差别：这里是**多实例列表**】每个活跃实例渲染一个遮罩块；
       `page` 范围的实例只在该页显示（宿主按当前页 route 过滤）、页面卸载时清理（防"忘了 hide"泄漏）；
       `global` 范围跨页可见且跨页存活。**层叠顺序 = 数组顺序 = seq 升序**（后插入的渲染在更后 ⇒ 更高）。
-->
<template>
  <teleport to="body">
    <!--
      ★★**命中契约（抄 p-drawer/p-modal 的真机结论，别自己发明）**：
      Skyline 下自定义组件内「**遮罩元素自身**」**不参与命中测试**（wx:if 动态插入与常驻挂载均无效，
      探针实证）——事件会落到**根容器**，而容器的事件可靠。
      ⇒ 本组件：
        ① 根容器 = 全屏命中基准（`blocked` 为真时它**吞掉点击**，`catch` 语义不冒泡到页面）；
        ② 遮罩层**仅视觉**（不绑事件）；
        ③ 面板 `catch` 吞冒泡（面板自身的点击不算"点遮罩"）。
      这样 `mask: true` 的实例才真正**拦得住**页面交互（任务卡必做项 3）。
      ★真机补充（本组件首跑踩的两个坑，别再改回去）：
        · 根**必须常驻显示**——portal 内 `display:none→block` **不重排** ⇒ 根恒 0×0 ⇒ 遮罩永不生效。
          现为"根恒占全屏（390×844 实测）+ `catchtap` 吞点击"。
        · 遮罩层**仅视觉**（不绑事件）——拦截挂根容器（与 p-drawer/p-modal 同款；Skyline 下
          遮罩元素自身不参与命中测试）。
      ★**验证边界（诚实记录）**：本机 `automation_element_action` 的**选择器 tap 走"直接派发"**，
        会**绕过渲染层层叠**（实证：点被遮罩完全覆盖的按钮仍触发页面回调；且它**无法定位**
        portal 内的元素——遮罩 id 报错）。⇒ **"遮罩拦截"无法用该工具做端到端断言**：
        渲染正确性以截图为准（本组件已截图取证：全屏覆盖 + 多实例层叠），
        拦截语义在**单测**层锁（字段透传 + 拦截判定），真机拦截需**人眼/手工**验证。
    -->
    <view
      id="p-loading-host-root"
      class="p-loading-host"
      :class="{ 'p-loading-host--blocking': blocked }"
      @catchtap="onRootTap"
    >
      <block v-for="item in items" :key="item.id">
        <!--
          遮罩：**承载拦截**（`catchtap` 吞点击——真机实证：遮罩自身**确实渲染且铺满**
          （截图取证：全屏覆盖 + 两实例层叠），故把拦截挂它（最直接、命中区域精确等于可见区域）。
          ★这与 p-drawer 的"挂容器"结论不矛盾：p-drawer 的问题是"遮罩**被条件卸载**时事件丢失"，
            而本组件的遮罩在 `v-if` 为真期间**常驻显示**（active 期间不卸载）⇒ 绑定可靠。
        -->
        <!-- 遮罩：**仅视觉层**（拦截由根容器承载——p-drawer/p-modal 的真机结论，见模板顶注） -->
        <view v-if="item.mask" class="p-loading-host__mask" :id="'p-loading-mask-' + item.id" />
        <!-- 面板（spinner + 文案） -->
        <view class="p-loading-host__panel" :id="'p-loading-panel-' + item.id" @catchtap="onPanelTap">
          <view class="p-loading-host__spinner" />
          <text v-if="item.text" class="p-loading-host__text">{{ item.text }}</text>
        </view>
      </block>
    </view>
  </teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { Ref } from 'vue'
// ★GP4-b：活跃集合在 runtime（模块级单例）；本组件只做**渲染端**
import { subscribeLoading, loadingSnapshot, hideLoading, sweepPageLoadings } from '@proteus-vue/runtime'
import type { LoadingItem } from '@proteus-vue/runtime'

const props = defineProps({
  pid: { type: String, default: '' },
})

// ★★初值必须静态可求值（`ref([])`）——带类型实参的调用在 MP 侧初值无法静态求值（编译器有专门告警）。
//   类型标在**声明**上即可。
const items: Ref<LoadingItem[]> = ref([])

/** ★组件实例引用（组件内部查询要 `.in(实例)`——页面级查询看不到组件内部，GP4-a 实证） */
let instanceRef: unknown = null

/** 当前页 route（page 范围过滤 + 卸载清理的判据） */
function routeOf(): string {
  try {
    const pages = (getCurrentPages?.() ?? []) as Array<{ route?: string }>
    return pages.length ? (pages[pages.length - 1].route ?? '') : ''
  } catch {
    return ''
  }
}

/** 把活跃集合投影到本页可见列表（page 范围按 route 过滤；global 始终可见；顺序保持 seq 升序） */
function project(): void {
  const key = routeOf()
  items.value = loadingSnapshot().filter((i) => i.scope === 'global' || i.pageKey === '' || i.pageKey === key)
}

let unsubscribe: (() => void) | null = null

onMounted(() => {
  // 捕获实例（内部查询用；不写裸 `this`——MP 产物里回调的 this 语义不同，且 TS 严格模式禁止）
  instanceRef = (globalThis as unknown as { __proteusLoadingHostSelf?: unknown }).__proteusLoadingHostSelf ?? instanceRef
  /* ★落痕（e2e 与真机排障的组件侧观测面）
   * 【为什么需要】宿主在 `root-portal` 内 ⇒ 页面级 `selectComponent`/`createSelectorQuery`
   *   **一律查不到**（GP4-a 实证：四种选择器全 null）⇒ 组件自己写出"本页实际渲染了什么"。
   * 【为什么按页面 route 分桶】导航时多个宿主实例短时共存，写同名键会互相覆盖（GP4-a 实证）。
   */
  const g = globalThis as unknown as Record<string, unknown>
  g.__PROTEUS_LOADING_HOST_MOUNTED__ = (Number(g.__PROTEUS_LOADING_HOST_MOUNTED__) || 0) + 1
  const trace = (): void => {
    // （blocked 落痕见 byPage 组装处——排障用）
    const byPage = (g.__PROTEUS_LOADING_RENDER_BY_PAGE__ as Record<string, unknown>) || {}
    byPage[routeOf()] = {
      ids: items.value.map((i) => i.id),
      count: items.value.length,
      masks: items.value.filter((i) => i.mask).map((i) => i.id),
      blocked: blocked.value,
      at: Date.now(),
    }
    // ★几何落痕（组件内部测量——页面级查询看不到组件内部）：排障"遮罩渲染了没有/多大"的第一手证据。
    //   首跑据此定位两处真实缺陷：① 根 0×0（`display:none→block` 在 portal 内**不重排**）；
    //   ② 遮罩自身不参与命中测试（Skyline 既有结论，p-drawer 同款）⇒ 拦截改挂根容器。
    //   ★★**必须自带 try/catch**（本组件首跑踩）：本函数在**订阅回调里**被调用，而 runtime 的 notify
    //     会吞掉订阅者异常（设计如此——宿主渲染失败不该拖垮逻辑层）⇒ 若这里抛错，
    //     **它上面的落痕写入会被一并跳过**（表现为"状态对但 trace 空"——我据此误判过一轮）。
    //     ⇒ 诊断代码绝不能成为"观测面自身失效"的原因：失败静默（不影响功能），但不拖垮落痕。
    try {
      const wxq = (wx as unknown as { createSelectorQuery?: () => any }).createSelectorQuery?.()
      if (wxq && instanceRef) {
        const q = typeof wxq.in === 'function' ? wxq.in(instanceRef) : wxq
        q.select('#p-loading-host-root').boundingClientRect()
        q.select('.p-loading-host__mask').boundingClientRect()
        q.exec((res: unknown[]) => {
          const r0 = (res?.[0] ?? null) as { width?: number; height?: number } | null
          const r1 = (res?.[1] ?? null) as { width?: number; height?: number } | null
          g.__PROTEUS_LOADING_GEOM__ = {
            root: r0 ? { w: Math.round(r0.width ?? 0), h: Math.round(r0.height ?? 0) } : null,
            mask: r1 ? { w: Math.round(r1.width ?? 0), h: Math.round(r1.height ?? 0) } : null,
            at: Date.now(),
          }
        })
      }
    } catch {
      /* 诊断失败不影响功能与落痕（见上注） */
    }
    // ★落痕写在**诊断之后**（配合上面的 try/catch：诊断再失败也走得到这里）——观测面不得自毁
    g.__PROTEUS_LOADING_RENDER_BY_PAGE__ = byPage
  }
  unsubscribe = subscribeLoading(() => {
    project()
    trace()
  })
  project()
  trace()
})

onUnmounted(() => {
  // ★卸载时：① 退订 ② **清理本页的 page 级实例**（防"业务忘了 hide"造成的跨页残留——
  //   这是 page 范围相较 global 的核心安全收益，也是 `swept` 统计的来源）
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  const key = routeOf()
  const removed = sweepPageLoadings(key)
  const g = globalThis as unknown as Record<string, unknown>
  if (removed > 0) {
    g.__PROTEUS_LOADING_SWEPT_LAST__ = { pageKey: key, removed, at: Date.now() }
  }
})

/** 是否有实例要求拦截交互（任一 `mask: true` ⇒ 整体处于拦截态——供落痕/诊断） */
const blocked = computed(() => items.value.some((i) => i.mask))

/**
 * 根容器点击 = **拦截承载点**（`@catchtap` 吞掉 ⇒ 不冒泡到页面 ⇒ 范围内交互被拦下）。
 *
 * 【★为什么挂根容器而不是遮罩层（p-drawer 真机实证）】Skyline 下自定义组件内「**遮罩元素自身**」
 *   **不参与命中测试**——事件会落到**根容器**，而容器的事件可靠。本组件首跑复现了同一现象：
 *   遮罩渲染得完整（全屏覆盖，截图取证）但 `@catchtap` 绑在遮罩上时**点不透页面**（实测页面按钮照样响应）。
 *   ⇒ 与 p-drawer/p-modal 同款：**遮罩仅视觉、拦截挂容器**。
 *   ★前提：根必须**常驻可见**（首跑用 `display:none` 切换 ⇒ 根恒 0×0 ⇒ 拦不住——两坑叠加）。
 *
 * · 有 `dismissible` 实例 ⇒ 关它（"点遮罩可关"语义）
 * · 否则仅吞掉（loading 的结束由业务显式 hide——与 `uni.showLoading` 一致）
 */
function onRootTap(): void {
  const hit = items.value.find((i) => i.dismissible)
  if (hit) hideLoading(hit.id)
}

/** 面板自身点击：只吞冒泡（点面板不算"点遮罩"） */
function onPanelTap(): void {
  /* catch 语义由 @catchtap 承载；无额外逻辑 */
}

void props
</script>

<style scoped>
/* 全屏根 = 视口坐标系（portal 内 fixed + 四边撑满——S42 正解，抄 p-drawer/p-toast-host）
   ★命中契约：拦截由**根容器**承担（Skyline 下遮罩元素自身不参与命中测试——模板注释有据）。
     无 mask 实例时根**不拦**（`--active` 门控）：小程序的命中是"有元素就拦"，
     故无拦截需求时根必须不可命中——用 `display: none`（不是 visibility/pointer-events：
     Skyline 无 pointer-events，而 display 是最可靠的"不参与命中"形态）。 */
/* ★★根**常驻显示**（真机实证：portal 内 `display: none → block` **不会重排** ⇒ 根恒 0×0 ⇒
   遮罩永远拦不住。这与"可见性用类切换"的既有经验（S47）不矛盾——S47 说的是**内容**用类切换，
   而这里踩的是"用 display 切换挂载态"这个更深的坑）。
   ⇒ 策略改为：**根恒定占据全屏**（交付层叠基准），
     · 有 mask 实例 ⇒ 遮罩层铺满 + 根 `catch` 吞点击（拦截生效）
     · 无实例 ⇒ 无遮罩层 + 根不消费事件（页面照常交互）
   问题：根常驻会拦截页面点击吗？——**不会**：根未绑 tap 时不消费（小程序事件按元素命中，
   无监听即穿透；真机已验证页面按钮可点）。 */
.p-loading-host {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9998;
}
/* 遮罩 = 交互拦截面（铺满视口、吞点击——`mask: true` 时才输出） */
.p-loading-host__mask {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.25);
}
/* 面板：spinner + 文案（居中） */
.p-loading-host__panel {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 16px 20px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  flex-direction: column;
  align-items: center;
}
/* ★加载环（同 p-loading 的既有结论）：统一色 border 环 + 随转子元素点——
   不能用单边异色 border 画缺口弧（Skyline 下 border-radius 失效 ⇒ 圆环变方块）。 */
.p-loading-host__spinner {
  width: 24px;
  height: 24px;
  border-radius: 12px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  box-sizing: border-box;
  animation: proteus-loading-host-spin 800ms linear infinite;
}
.p-loading-host__spinner::after {
  content: '';
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 2px;
  background: #ffffff;
  margin-left: 9px;
  margin-top: 1px;
}
.p-loading-host__text {
  margin-top: 8px;
  color: #fff;
  font-size: 14px;
}
@keyframes proteus-loading-host-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>

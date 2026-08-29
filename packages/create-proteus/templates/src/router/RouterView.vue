<!-- examples/router/RouterView.vue —— Web 端渲染容器（应用壳，仅 Web 构建使用）
     ★ Web 原生转场：routeType 驱动 Vue <Transition>（CSS 动画），与 MP 的 Skyline worklet 转场对应——
       同一套 routeType API（halfScreen/slideUp → 上滑、scaleDown → 缩放、默认 fade） -->
<script setup lang="ts">
import { computed, ref, defineAsyncComponent } from 'vue'
import type { Component } from 'vue'
import { routeMap } from './auto-routes'
import { adapter } from '@proteus/shared'
import { webTransitionName } from '@proteus/router'

// 懒加载全部页面（含分包页）：Web 端按页面自动 code-split
// glob 相对本文件（examples/router/）→ examples/pages 与 examples/subpackages/*/pages
const modules = import.meta.glob('../**/pages/**/*.vue')

// 页面组件缓存 + 预热：异步组件首次挂载会跳过 Transition 动画（真机/浏览器验证"第一次无下沉转场"），
// 预热使首次导航也同步挂载（chunk 已加载则 defineAsyncComponent 不再是异步 wrapper）
const pageCache = new Map<string, Component>()
for (const [key, load] of Object.entries(modules)) {
  ;(load() as Promise<{ default: Component }>).then((mod) => {
    pageCache.set(key, mod.default)
  })
}
const current = ref(adapter.getCurrentPages()[0]?.route || 'pages/index')

// 路由变化 → 转场名（★透明化：routeType → Vue Transition 映射由框架共享表 webTransitionName 提供，
//   不再 RouterView 私有硬编码；三端共用同一枚举见 packages/router/src/transforms/transform-transition.ts）
const transitionName = ref('fade')
let lastForwardName = 'fade' // 当前页进入时的转场名（后退时取其反向）
adapter.onPageLoad?.((route, _query, routeType, nav) => {
  current.value = route || 'pages/index'
  if (nav === 'back') {
    // 反向转场：用当前退出页进入时的转场名 + '-back'
    transitionName.value =
      lastForwardName && lastForwardName !== 'fade' ? `${lastForwardName}-back` : 'fade'
  } else if (nav === 'replace' || nav === 'reLaunch' || nav === 'switchTab') {
    lastForwardName = 'fade' // 无堆叠语义，后退按 fade
    transitionName.value = nav === 'replace' ? 'replace' : nav === 'reLaunch' ? 'reset' : 'tab'
  } else {
    lastForwardName = webTransitionName(routeType)
    transitionName.value = lastForwardName
  }
})

const currentRoute = computed(() => current.value || 'pages/index')

// 层叠转场（routeType 前进/后退）：新旧同屏重叠 → 绝对定位 + default 模式；
// fade / replace / reset / tab 用 out-in（先退后进）
const layeredNames = ['halfscreen', 'slide-up', 'scale', 'halfscreen-back', 'slide-up-back', 'scale-back']
const isLayered = computed(() => layeredNames.includes(transitionName.value))

// 遮罩对齐 MP barrierColor：halfScreen 0.4 / scaleDown 0.8（forward + back 都显示）；slideUp opaque 无遮罩
// 遮罩常驻但被停留页(z:2)盖住：forward 时旧页(z:0)暴露在遮罩下淡入，back 时前页(z:0)暴露在遮罩下淡出
const showBarrier = computed(() => {
  const n = transitionName.value
  return n === 'halfscreen' || n === 'scale' || n === 'halfscreen-back' || n === 'scale-back'
})
const isBack = computed(() => transitionName.value.endsWith('-back'))
const barrierOpacity = computed(() => (transitionName.value.startsWith('halfscreen') ? 0.4 : 0.8))

const view = computed<Component | null>(() => {
  // routeMap 以 name 为键，这里收到的是 path，需按 path 回退查找（同 guards.getCurrentFrom）
  const rec =
    routeMap[currentRoute.value] || Object.values(routeMap).find((r) => r.path === currentRoute.value)
  if (!rec) return null
  // rec.component 为相对 examples/router/ 的路径，与 glob 键一致；优先用缓存（同步挂载保证转场）
  const cached = pageCache.get(rec.component)
  if (cached) return cached
  const load = (modules as Record<string, () => Promise<unknown>>)[rec.component]
  return load ? defineAsyncComponent(load as () => Promise<Component>) : null
})
</script>

<template>
  <!-- routeType 转场全部层叠（default 模式 + 绝对定位重叠 → 新旧同屏）：
       halfScreen/slideUp/scaleDown 各自层叠语义；默认 fade 用 out-in 先退后进
       :key 按路由强制重挂载触发过渡 -->
  <div class="router-view" :class="{ layered: isLayered }">
    <!-- 遮罩层（对齐 MP barrierColor）：旧页/前页(z:0)之上、停留页(z:2)之下；forward 淡入压暗，back 淡出抬起 -->
    <div
      v-if="showBarrier"
      class="route-barrier"
      :class="{ 'barrier-out': isBack }"
      :style="{ '--barrier-opacity': barrierOpacity }"
    />
    <Transition :name="transitionName" :mode="isLayered ? undefined : 'out-in'">
      <component :is="view" v-if="view" :key="currentRoute" class="page" />
      <div v-else :key="'404'" class="page">404 Not Found</div>
    </Transition>
  </div>
</template>

<style>
/* 层叠容器：所有 routeType 转场时新旧页同屏绝对定位重叠 */
.router-view {
  position: relative;
  min-height: 100vh;
}
.router-view.layered .page {
  position: absolute;
  inset: 0;
  overflow-y: auto;
}

/* 遮罩层（对齐 MP barrierColor）：前/旧页(z:0)之上、停留页(z:2)之下；forward 淡入压暗、back 淡出抬起 */
.route-barrier {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: #000;
  opacity: 0;
  animation: barrier-in 0.3s ease forwards;
  pointer-events: none;
}
@keyframes barrier-in {
  from {
    opacity: 0;
  }
  to {
    opacity: var(--barrier-opacity);
  }
}
.route-barrier.barrier-out {
  animation: barrier-out 0.4s ease forwards;
}
@keyframes barrier-out {
  from {
    opacity: var(--barrier-opacity);
  }
  to {
    opacity: 0;
  }
}

/* 页面"纸片"基础样式：白色背景 + 撑满视口 + 恒在遮罩(z:1)之上(z:2)
   层叠转场时旧页被 leave 规则降为 z:0 暴露在遮罩下；停留页始终盖住遮罩 */
.page {
  background: #fff;
  min-height: 100vh;
  z-index: 2;
}

/* 默认：淡入淡出 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* halfScreen / slideUp：底部上滑（缓出曲线，与 MP 预设一致） */
.slide-up-enter-active {
  transition: transform 0.32s cubic-bezier(0.35, 0.91, 0.33, 0.97);
}
.slide-up-enter-from {
  transform: translateY(20%);
}
.slide-up-leave-active {
  transition: opacity 0.25s ease;
}
.slide-up-leave-to {
  opacity: 0;
}

/* scaleDown：层叠缩放——新页从底部滑入覆盖（z 上层），旧页同时下沉缩放（z 下层） */
.scale-enter-active {
  transition: transform 0.4s cubic-bezier(0.35, 0.91, 0.33, 0.97);
  z-index: 2;
}
.scale-enter-from {
  transform: translateY(100%);
}
.scale-leave-active {
  transition:
    transform 0.4s cubic-bezier(0.35, 0.91, 0.33, 0.97),
    opacity 0.4s ease,
    border-radius 0.4s ease;
  z-index: 0;
}
.scale-leave-to {
  transform: scale(0.92) translateY(4%);
  opacity: 0.8;
  border-radius: 12px;
}

/* slideUp：层叠推入——新页底部推入覆盖（z:2），旧页被推出视口上方（z:1，对应 MP slideUp） */
.slide-up-enter-active {
  transition: transform 0.32s cubic-bezier(0.35, 0.91, 0.33, 0.97);
  z-index: 2;
}
.slide-up-enter-from {
  transform: translateY(100%);
}
.slide-up-leave-active {
  transition:
    transform 0.32s cubic-bezier(0.35, 0.91, 0.33, 0.97),
    opacity 0.32s ease;
  z-index: 0;
}
.slide-up-leave-to {
  transform: translateY(-20%);
  opacity: 0;
}

/* halfScreen：层叠半屏——新页底部滑入覆盖（z:2），旧页保持原位淡出（对应 MP 半屏前页保持） */
.halfscreen-enter-active {
  transition: transform 0.3s cubic-bezier(0.35, 0.91, 0.33, 0.97);
  z-index: 2;
}
.halfscreen-enter-from {
  transform: translateY(100%);
}
.halfscreen-leave-active {
  transition: opacity 0.3s ease;
  z-index: 0;
}
.halfscreen-leave-to {
  opacity: 0;
}

/* ===== 反向转场（返回/后退：当前页 B 反向退出滑出底部，前页 A 恢复原态）===== */
/* scale 返回：B 滑出底部（z:2），A 从下沉态恢复 scale(0.92)→1 */
.scale-back-enter-active {
  transition:
    transform 0.4s cubic-bezier(0.35, 0.91, 0.33, 0.97),
    opacity 0.4s ease,
    border-radius 0.4s ease;
  z-index: 0; /* 低于遮罩(z:1)，恢复过程中被遮罩压暗 */
}
.scale-back-enter-from {
  transform: scale(0.92) translateY(4%);
  opacity: 0.8;
  border-radius: 12px;
}
.scale-back-leave-active {
  transition: transform 0.4s cubic-bezier(0.35, 0.91, 0.33, 0.97);
  z-index: 2;
}
.scale-back-leave-to {
  transform: translateY(100%);
}

/* slideUp 返回：B 滑出底部（z:2），A 从被推出上方恢复 */
.slide-up-back-enter-active {
  transition:
    transform 0.32s cubic-bezier(0.35, 0.91, 0.33, 0.97),
    opacity 0.32s ease;
  z-index: 1;
}
.slide-up-back-enter-from {
  transform: translateY(-20%);
  opacity: 0;
}
.slide-up-back-leave-active {
  transition: transform 0.32s cubic-bezier(0.35, 0.91, 0.33, 0.97);
  z-index: 2;
}
.slide-up-back-leave-to {
  transform: translateY(100%);
}

/* halfScreen 返回：B 滑出底部（z:2），A 轻微下沉后恢复 */
.halfscreen-back-enter-active {
  transition: transform 0.3s cubic-bezier(0.35, 0.91, 0.33, 0.97);
  z-index: 0; /* 低于遮罩(z:1) */
}
.halfscreen-back-enter-from {
  transform: translateY(8%);
}
.halfscreen-back-leave-active {
  transition: transform 0.3s cubic-bezier(0.35, 0.91, 0.33, 0.97);
  z-index: 2;
}
.halfscreen-back-leave-to {
  transform: translateY(100%);
}

/* replace（redirectTo）：替换当前页——旧页轻微缩小淡出、新页淡入（out-in） */
.replace-enter-active,
.replace-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.replace-enter-from {
  opacity: 0;
  transform: scale(0.98);
}
.replace-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

/* reLaunch：重置——淡入 */
.reset-enter-active {
  transition: opacity 0.25s ease;
}
.reset-enter-from {
  opacity: 0;
}
.reset-leave-active {
  transition: opacity 0.2s ease;
}
.reset-leave-to {
  opacity: 0;
}

/* switchTab：tab 切换——淡入淡出 */
.tab-enter-active {
  transition: opacity 0.2s ease;
}
.tab-enter-from {
  opacity: 0;
}
.tab-leave-active {
  transition: opacity 0.15s ease;
}
.tab-leave-to {
  opacity: 0;
}

/* 无障碍：减少动态偏好时关闭全部转场 */
@media (prefers-reduced-motion: reduce) {
  .fade-enter-active,
  .fade-leave-active,
  .slide-up-enter-active,
  .slide-up-leave-active,
  .halfscreen-enter-active,
  .halfscreen-leave-active,
  .scale-enter-active,
  .scale-leave-active,
  .slide-up-back-enter-active,
  .slide-up-back-leave-active,
  .halfscreen-back-enter-active,
  .halfscreen-back-leave-active,
  .scale-back-enter-active,
  .scale-back-leave-active,
  .replace-enter-active,
  .replace-leave-active,
  .reset-enter-active,
  .reset-leave-active,
  .tab-enter-active,
  .tab-leave-active {
    transition: none !important;
  }
  .fade-enter-from,
  .fade-leave-to,
  .slide-up-enter-from,
  .slide-up-leave-to,
  .halfscreen-enter-from,
  .halfscreen-leave-to,
  .scale-enter-from,
  .scale-leave-to,
  .slide-up-back-enter-from,
  .slide-up-back-leave-to,
  .halfscreen-back-enter-from,
  .halfscreen-back-leave-to,
  .scale-back-enter-from,
  .scale-back-leave-to,
  .replace-enter-from,
  .replace-leave-to,
  .reset-enter-from,
  .reset-leave-to,
  .tab-enter-from,
  .tab-leave-to {
    transform: none;
    opacity: 1;
  }
  .route-barrier {
    animation: none;
    opacity: var(--barrier-opacity);
  }
  .route-barrier.barrier-out {
    opacity: 0;
  }
}
</style>

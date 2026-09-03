<!-- src/components/p-sidebar/index.vue —— 自适应导航栏（★Fluid System S3：窄屏 bottom-bar → 宽屏 side-rail）
     容器宽 < minSidebarWidth → 底部水平导航条（移动端主场景）；≥ → 左侧垂直侧栏（平板/车机/桌面）
     按容器而非视口求解（createContainerQuery——车机分屏/多窗口按自身容器）
     ★车机：Arrow 方向键在导航项间移动焦点（d-pad 映射，Web onMounted 监听——MP 无真实 DOM 跳过）；
            drive-mode / prefers-reduced-motion → no-motion class（CSS 禁用动效）
     ★MP 安全：无 ResizeObserver → 恒 bottom-bar；焦点监听无 DOM → 跳过 -->
<template>
  <div ref="rootEl" class="p-sidebar" :class="rootClass" :style="layoutStyle">
    <!-- ★collapsed 模式（#384）：切换条常驻（side-rail 隐藏）——VitePress 同款折叠交互，业务零代码 -->
    <button
      v-if="mode !== 'side-rail'"
      type="button"
      class="p-sidebar-toggle"
      :aria-expanded="mode === 'collapsed-open'"
      @click="toggleCollapsed"
    >
      <p-text class="p-sidebar-toggle-label">☰ {{ toggleLabel }}</p-text>
    </button>
    <div ref="navEl" v-show="mode === 'side-rail' || mode === 'collapsed-open'" class="p-sidebar-nav" :style="navStyle">
      <slot name="nav" />
    </div>
    <div class="p-sidebar-main">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'
import { createContainerQuery, createDeviceEnv, shouldReduceMotion } from '@proteus-vue/fluid'
import type { FluidContext, DeviceEnv } from '@proteus-vue/fluid'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 容器宽度达到此值 → side-rail 侧栏；窄于此 → collapsed 折叠（px） */
  minSidebarWidth: { type: Number, default: 640 },
  /** side-rail 模式导航栏宽度（px） */
  navWidth: { type: Number, default: 200 },
  /** 设计稿宽度（容器断点推导基准） */
  designWidth: { type: Number, default: 375 },
  /** ★collapsed 模式切换条文案（#384） */
  toggleLabel: { type: String, default: '导航' },
})

// ★#384 三态状态机（正交设计）：isWide（容器派生）与 userExpanded（用户意图）分离——
//   RO 回调只更新 isWide，绝不覆盖用户交互状态（否则渲染→尺寸微变→RO→回写 = 点击被吞）
const isWide = ref(false)
const userExpanded = ref<boolean | null>(null) // null = 用户未表态（跟随容器默认收起）
const mode = computed(() => {
  if (isWide.value) return 'side-rail'
  return userExpanded.value === true ? 'collapsed-open' : 'collapsed'
})
function toggleCollapsed(): void {
  userExpanded.value = mode.value !== 'collapsed-open'
}
const reducedMotion = ref(false)
const rootEl = ref<HTMLElement | null>(null)
const navEl = ref<HTMLElement | null>(null)
let query: FluidContext | null = null
let env: DeviceEnv | null = null
let focusIndex = -1 // 焦点导航内部游标（不读 document.activeElement——组件审计 no-platform-api）

onMounted(() => {
  if (!rootEl.value) return // MP/无 ResizeObserver：恒 collapsed
  query = createContainerQuery(rootEl.value, { designWidth: props.designWidth })
  query.subscribe((s) => {
    isWide.value = s.width >= props.minSidebarWidth
  })
  env = createDeviceEnv()
  reducedMotion.value = shouldReduceMotion(env.get())
  env.subscribe((s) => {
    reducedMotion.value = shouldReduceMotion(s)
  })
  // ★车机 d-pad 焦点导航（Web only）：Arrow 方向键在导航项间移动焦点
  const nav = navEl.value
  if (nav) nav.addEventListener('keydown', onNavKeydown)
})
onUnmounted(() => {
  if (query) query.destroy()
  query = null
  if (env) env.destroy()
  env = null
  if (navEl.value) navEl.value.removeEventListener('keydown', onNavKeydown)
})

/** Arrow 方向键焦点移动：side-rail 纵向（上/下）、collapsed-open 横向（左/右）——内部游标 + focus() */
function onNavKeydown(e: KeyboardEvent): void {
  const nav = navEl.value
  if (!nav) return
  const step = mode.value === 'side-rail' ? (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0) : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  const items = Array.from(nav.children) as HTMLElement[]
  if (!items.length) return
  focusIndex = focusIndex < 0 ? 0 : Math.min(items.length - 1, Math.max(0, focusIndex + step))
  const target = items[focusIndex]
  if (target && typeof target.focus === 'function') {
    target.focus()
    e.preventDefault()
  }
}

// ★三态根类（页面按状态适配呈现的官方信号）：p-sidebar-side-rail / p-sidebar-collapsed / p-sidebar-collapsed-open
const rootClass = computed(() => {
  return [
    'p-sidebar-' + mode.value,
    { 'p-sidebar-no-motion': reducedMotion.value },
  ]
})

// ★断言放方法体内（MP 编译器剥离方法体 as；CSSProperties 字面量类型）
// ★#380：面板间距由组件承担（D-2：业务零布局代码）——side-rail 侧栏↔主内容列间距 32px；collapsed-open 导航↔主内容行间距 24px
const layoutStyle = computed(() => {
  const style: CSSProperties = {
    display: 'flex',
    flexDirection: (mode.value === 'side-rail' ? 'row' : 'column') as CSSProperties['flexDirection'],
    columnGap: '32px',
    rowGap: '24px',
  }
  return style as CSSProperties
})

const navStyle = computed(() => {
  const style: CSSProperties = {
    display: 'flex',
    flexDirection: (mode.value === 'side-rail' ? 'column' : 'row') as CSSProperties['flexDirection'],
  }
  if (mode.value === 'side-rail') {
    style.width = props.navWidth + 'px'
    style.flexShrink = '0'
  } else {
    style.width = '100%'
  }
  return style as CSSProperties
})
</script>

<style scoped>
.p-sidebar-main {
  flex: 1;
  min-width: 0;
}
/* ★#384 collapsed 模式：切换条（side-rail 下 v-if 已隐藏） */
.p-sidebar-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: var(--p-sidebar-toggle-bg, var(--panel, #121216));
  color: inherit;
  border: 1px solid var(--p-sidebar-toggle-line, var(--line, #26262e));
  border-radius: 10px;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 14px;
}
.p-sidebar-toggle:hover { border-color: var(--p-sidebar-toggle-line-hover, var(--brand, #7c5cff)); }
.p-sidebar-toggle-label { color: inherit; font-size: 14px; }
/* ★#383：bottom-bar 模式 nav 横排容器必须可收缩（flex item min-width:auto 会让
   nowrap 子内容撑破整页——横向滚动根因）；横向滚动收敛在 nav 自身 */
.p-sidebar-bottom-bar .p-sidebar-nav {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}
.p-sidebar-nav {
  gap: 4px;
}
/* ★drive-mode / prefers-reduced-motion：禁用动效（车机驾驶中不得有过渡动画） */
.p-sidebar-no-motion *,
.p-sidebar-no-motion {
  transition: none !important;
  animation: none !important;
}
</style>

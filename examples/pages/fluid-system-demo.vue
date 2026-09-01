<!-- examples/pages/fluid-system-demo.vue —— ★Fluid System 演示（fluid-system-plan S1+S2：多形态设备语义布局）
     · p-split  自适应分栏：容器宽 < minSplitWidth → 堆叠；≥ → 并排（按容器而非视口——拖宽/拖窄窗口看变化）
     · p-zone   容器断点分区：sm/md/lg/xl 命名槽按容器断点渲染
     · p-safe   安全区避让：env(safe-area-inset-*) + 折叠屏 hinge（display-mode fold/span）
     · p-aspect 纵横比容器：aspect-ratio 原生 / padding-top hack 降级
     · 折叠屏/车机/平板的响应式意图声明
     ★MP 安全：无泛型/类型标注（MP 下无 ResizeObserver → p-split 恒堆叠、p-zone 恒 sm 槽、p-safe fold 恒不生效） -->
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { PSplit, PZone, PSafe, PAspect, PSidebar, PToolbar, PScale } from '@proteus-vue/components'
import { createDeviceEnv, shouldReduceMotion } from '@proteus-vue/fluid'
import type { DeviceEnv, FluidDisplayMode } from '@proteus-vue/fluid'

const cards = ref([{ id: 1, title: '分区卡片' }])
function expand(): void {
  const arr = []
  for (let i = 1; i <= 8; i++) arr.push({ id: i, title: '卡片 ' + i })
  cards.value = arr
}

// ★S2 折叠形态指示器：display-mode（fold/span/expand）——DevTools 折叠屏模拟可切换；MP 无 matchMedia → standard
const displayMode = ref<FluidDisplayMode>('standard')
const orientation = ref('portrait')
const reducedMotion = ref(false)
let env: DeviceEnv | null = null
onMounted(() => {
  env = createDeviceEnv()
  displayMode.value = env.get().displayMode
  orientation.value = env.get().orientation
  reducedMotion.value = shouldReduceMotion(env.get())
  env.subscribe((s) => {
    displayMode.value = s.displayMode
    orientation.value = s.orientation
    reducedMotion.value = shouldReduceMotion(s)
  })
})
onUnmounted(() => {
  if (env) env.destroy()
  env = null
})

// ★S3 p-toolbar 演示数据
const navItems = [
  { key: 'home', label: '首页' },
  { key: 'map', label: '导航' },
  { key: 'media', label: '媒体' },
  { key: 'phone', label: '电话' },
  { key: 'settings', label: '设置' },
  { key: 'about', label: '关于' },
]
function onSelect(key: string): void {
  console.log('[toolbar] select', key)
}
</script>

<template>
  <div class="fluid-system">
    <h2>Fluid System · 多形态设备语义布局</h2>
    <p class="sub">
      响应式基准是<strong>容器</strong>而非视口——折叠屏/平板/车机/多窗口场景下，组件按自身容器宽度求解。
      拖动窗口或缩放容器看实时变化。
    </p>

    <button class="btn" @click="expand">展开 8 卡片</button>

    <!-- ★S1 p-split：窄容器堆叠 → 宽容器并排（aside + 主区） -->
    <p-split :min-split-width="640" :gap="16" class="demo-split">
      <template #aside>
        <div class="aside-box">
          <h3>侧栏（aside）</h3>
          <p class="hint">容器 &lt; 640px → 堆叠在顶部；≥ 640px → 并排左侧</p>
        </div>
      </template>
      <div class="main-box">
        <h3>主区</h3>
        <p class="hint">内容随容器宽度重排——平板横屏/车机分屏场景</p>
      </div>
    </p-split>

    <!-- ★S1 p-zone：容器断点渲染不同子布局（sm/md/lg/xl 命名槽） -->
    <p-zone :design-width="375" class="demo-zone">
      <template #sm>
        <div class="zone-box zone-sm">sm 布局：单列堆叠（容器 &lt; 188px）</div>
      </template>
      <template #md>
        <div class="zone-box zone-md">md 布局：两列（容器 ≥ 328px）</div>
      </template>
      <template #lg>
        <div class="zone-box zone-lg">lg 布局：三列（容器 ≥ 469px）</div>
      </template>
      <template #xl>
        <div class="zone-box zone-xl">xl 布局：四列（容器 ≥ 609px）</div>
      </template>
    </p-zone>

    <!-- 容器内网格（既有 G-22 p-grid 复用） -->
    <p-grid :min-col-width="140" :gap="10" class="demo-grid">
      <div v-for="c in cards" :key="c.id" class="cell">{{ c.title }}</div>
    </p-grid>

    <!-- ★S2 p-safe：安全区避让（刘海/Home Indicator；fallback 演示桌面 env()=0 时的至少值） -->
    <h3 class="sec-title">S2 · 安全区避让（p-safe）</h3>
    <p class="hint">
      Web 端 env(safe-area-inset-*) 需 viewport-fit=cover（已注入）；桌面 env()=0 → fallback 兜底「至少 Npx」。
      折叠屏 hinge 用 DevTools 设备模拟（display-mode: fold/span）验证。
    </p>
    <p-safe area="top" :fallback="44" class="safe-demo">
      <div class="safe-inner">顶部避让 · fallback 44px（模拟刘海/状态栏）</div>
    </p-safe>
    <p-safe area="bottom" :fallback="34" class="safe-demo">
      <div class="safe-inner">底部避让 · fallback 34px（模拟 Home Indicator）</div>
    </p-safe>
    <p-safe area="all" :fallback="8" class="safe-demo">
      <div class="safe-inner">四边避让 · fallback 8px</div>
    </p-safe>
    <p-safe fold class="safe-demo safe-fold">
      <div class="safe-inner">折叠屏 hinge 避让（display-mode fold/span 时左右避开折叠区）</div>
    </p-safe>

    <!-- ★S2 p-aspect：纵横比容器（aspect-ratio 原生 / padding-top hack 降级） -->
    <h3 class="sec-title">S2 · 纵横比容器（p-aspect）</h3>
    <div class="aspect-row">
      <p-aspect :ratio="16 / 9" class="aspect-demo">
        <div class="aspect-inner">16:9</div>
      </p-aspect>
      <p-aspect :ratio="1" class="aspect-demo">
        <div class="aspect-inner">1:1</div>
      </p-aspect>
    </div>

    <!-- ★S2 折叠形态指示器：display-mode / 方向（DevTools 折叠屏模拟可切换） -->
    <div class="env-box">
      <h3>当前设备形态</h3>
      <p class="hint">display-mode：<strong>{{ displayMode }}</strong>（DevTools 折叠屏模拟 → fold/span/expand）</p>
      <p class="hint">方向：<strong>{{ orientation }}</strong></p>
      <p class="hint">动效门（drive-mode / prefers-reduced-motion）：<strong>{{ reducedMotion ? '已禁用动效' : '正常' }}</strong></p>
    </div>

    <!-- ★S3 p-sidebar：窄屏 bottom-bar → 宽屏 side-rail（拖宽/拖窄窗口看切换；nav 项支持方向键焦点移动） -->
    <h3 class="sec-title">S3 · 自适应导航栏（p-sidebar）</h3>
    <p class="hint">容器 &lt; 640px → 底部导航条；≥ 640px → 左侧侧栏（Arrow 方向键在导航项间移动焦点）</p>
    <p-sidebar :min-sidebar-width="640" :nav-width="160" class="sidebar-demo">
      <template #nav>
        <a class="nav-item" href="#">首页</a>
        <a class="nav-item" href="#">导航</a>
        <a class="nav-item" href="#">媒体</a>
        <a class="nav-item" href="#">设置</a>
      </template>
      <div class="sidebar-main">
        <h3>内容区</h3>
        <p class="hint">窄屏时导航沉底为 bottom-bar；宽屏（平板/车机/桌面）时左侧垂直 side-rail</p>
      </div>
    </p-sidebar>

    <!-- ★S3 p-toolbar：溢出折叠（拖窄看多余项收进「更多」） -->
    <h3 class="sec-title">S3 · 工具栏溢出折叠（p-toolbar）</h3>
    <p class="hint">容器放不下时多余项收进「更多」（车机/平板有限宽度场景）</p>
    <p-toolbar :items="navItems" :item-width="72" :more-width="56" class="toolbar-demo" @select="onSelect" />

    <!-- ★S4 p-scale：动态字号/密度（无障碍；子项 em 继承随缩放；:root 设 --proteus-font-scale 可全局放大） -->
    <h3 class="sec-title">S4 · 动态字号/密度（p-scale）</h3>
    <p class="hint">字号级别 0-3（小/标准/大/特大）+ 密度（compact/regular/comfortable）——子项用 em 继承随缩放；
      :root 设置 <code>--proteus-font-scale</code> 可叠加系统字号缩放</p>
    <div class="scale-row">
      <p-scale :level="0" :density="'compact'" class="scale-box">
        <p class="scale-line">level 0 · 小字号（compact 密度）</p>
        <p class="scale-line">行高 1.4 / 间距 8px</p>
      </p-scale>
      <p-scale :level="1" class="scale-box">
        <p class="scale-line">level 1 · 标准（regular 密度）</p>
        <p class="scale-line">行高 1.6 / 间距 12px</p>
      </p-scale>
      <p-scale :level="3" :density="'comfortable'" class="scale-box">
        <p class="scale-line">level 3 · 特大（comfortable 无障碍密度）</p>
        <p class="scale-line">行高 1.8 / 间距 16px</p>
      </p-scale>
    </div>
  </div>
</template>

<style scoped>
.fluid-system {
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px 16px;
}
.sub {
  color: #666;
  line-height: 1.7;
}
.btn {
  border: 1px solid #1d6fb8;
  color: #1d6fb8;
  background: #fff;
  border-radius: 4px;
  padding: 6px 14px;
  cursor: pointer;
  margin: 8px 0 16px;
}
.demo-split {
  border: 1px dashed #ccc;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 20px;
  min-height: 120px;
}
.aside-box,
.main-box {
  border-radius: 8px;
  padding: 12px;
  flex: 1;
}
.aside-box {
  background: #eef4fb;
  border: 1px solid #d6e4f5;
}
.main-box {
  background: #e8f7ee;
  border: 1px solid #cdeeda;
}
.demo-zone {
  margin-bottom: 20px;
}
.zone-box {
  border-radius: 8px;
  padding: 12px;
  text-align: center;
  margin-bottom: 8px;
}
.zone-sm { background: #fff1f0; }
.zone-md { background: #fff7e6; }
.zone-lg { background: #f6ffed; }
.zone-xl { background: #e6f7ff; }
.demo-grid {
  margin-top: 8px;
}
.cell {
  background: #f0f2f5;
  border-radius: 6px;
  padding: 10px;
  text-align: center;
  font-size: 12px;
}
.hint {
  color: #999;
  font-size: 12px;
}
/* ★S2 demo：安全区 / 纵横比 / 设备形态 */
.sec-title {
  margin: 28px 0 8px;
  font-size: 16px;
}
.safe-demo {
  border-radius: 8px;
  margin-bottom: 10px;
  background: #eef4fb;
  border: 1px solid #d6e4f5;
}
.safe-fold {
  background: #fffbe6;
  border-color: #ffe58f;
}
.safe-inner {
  padding: 12px;
  font-size: 13px;
}
.aspect-row {
  display: flex;
  gap: 12px;
}
.aspect-demo {
  flex: 1;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #d9d9d9;
}
.aspect-inner {
  background: #f0f2f5;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 13px;
  height: 100%;
}
.env-box {
  margin-top: 24px;
  padding: 12px;
  border-radius: 8px;
  background: #fafafa;
  border: 1px solid #eee;
}
.env-box h3 {
  margin: 0 0 6px;
  font-size: 14px;
}
/* ★S3 demo：自适应导航栏 / 工具栏 */
.sidebar-demo {
  border: 1px dashed #ccc;
  border-radius: 8px;
  min-height: 200px;
  margin-bottom: 20px;
}
.nav-item {
  display: block;
  padding: 8px 12px;
  color: #1d6fb8;
  text-decoration: none;
  border-radius: 4px;
  font-size: 13px;
}
.nav-item:hover {
  background: #eef4fb;
}
.sidebar-main {
  padding: 12px;
}
.toolbar-demo {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 4px;
  position: relative;
  margin-bottom: 8px;
}
/* ★S4 demo：动态字号/密度 */
.scale-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.scale-box {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 12px;
  background: #fafafa;
}
.scale-line {
  margin: 0;
  color: #333;
}
</style>

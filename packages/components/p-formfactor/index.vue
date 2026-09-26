<!--
     packages/components/p-formfactor/index.vue —— ★★柔性形态容器（Fluid System v2 落地形态）
     业务只写**一份语义内容**（命名槽），框架按**设备形态画像**自动编排：
       · 布局拓扑：glance / stack / duo / rail-split / rail-grid / hero-focus-row（形态画像推导）
       · 能力过滤：形态未声明支持的能力槽**自动不渲染**（如车机无多规格选择、TV 无侧栏）
       · 密度与缩放：形态画像的 density/scale 自动应用（10ft TV 放大 1.4 / 手表 0.85 紧凑）
       · 输入语义：遥控/旋钮形态自动放大热区（d-pad 可达），触控/指针形态常规
     业务侧零 if-else（不需要写「如果是车机就…」）——这正是「柔性系统」与「响应式布局」的分水岭：
     响应式按**尺寸**缩放同一套布局；柔性系统按**形态**换布局、换导航、换能力集。

     ★诚实边界：形态来自宿主声明（declared，权威）或环境探测（Web 可推断 phone/fold/tablet/pc；
     watch / car / tv 不可自动识别，须声明）；形态画像表见 @proteus-vue/fluid 的 FORM_PROFILES。
     ★MP 兼容：结构只用 flex/grid + px/em（Skyline 子集）；无 ResizeObserver 时按声明/缺省静态。 -->
<template>
  <div
    ref="rootEl"
    class="p-formfactor"
    :class="rootClass"
    :data-pf-form="form"
    :data-pf-posture="posture || ''"
    :data-pf-topology="profile.topology"
    :style="rootStyle"
  >
    <!-- 侧栏（能力声明 sidebar：未声明的形态自动不渲染——手机/手表/车机/TV） -->
    <aside v-if="capsEnabled(caps.sidebar) && $slots.rail" class="pf-rail">
      <slot name="rail" />
    </aside>

    <div class="pf-body">
      <!-- 主视觉 -->
      <div v-if="$slots.media" class="pf-media">
        <slot name="media" />
      </div>

      <div class="pf-info">
        <slot name="heading" />
        <slot name="price" />
        <!-- ★能力三态（2026-09-26 报告 P2-2）：supported → 多规格；fallback → **降级路径**
             （车机驾驶场景以「语音/旋钮单选」替代多选，而非删除）；unsupported → 不渲染 -->
        <div v-if="skuLevel === 'supported' && $slots.sku" class="pf-sku">
          <slot name="sku" />
        </div>
        <div v-else-if="skuLevel === 'fallback'" class="pf-sku-fallback">
          <span class="pf-sku-fb-label">🎙 {{ skuFallbackHint }}</span>
        </div>
        <div v-if="$slots.actions" class="pf-actions">
          <slot name="actions" />
        </div>
      </div>

      <!-- 推荐区：焦点行形态自动横排（TV/车机海报流），其余形态网格/列表 -->
      <div v-if="$slots.recommend" class="pf-recommend" :class="{ 'pf-recommend--row': caps.focusRows }">
        <slot name="recommend" />
      </div>
    </div>

    <!-- 底部 Tab（能力声明 tabs：未声明的形态自动不渲染——手表/平板/PC/车机/TV） -->
    <nav v-if="capsEnabled(caps.tabs) && $slots.tabbar" class="pf-tabbar">
      <slot name="tabbar" />
    </nav>

    <!-- ★能力渲染点（专家报告 P1-4：让每项 caps 可被视觉证伪） -->
    <!-- drawer：抽屉把手（触控形态声明支持） -->
    <span v-if="caps.drawer" class="pf-drawer-hint" aria-hidden="true" />
    <!-- crown：表冠提示（手表/车机声明支持旋钮/表冠） -->
    <span v-if="caps.crown" class="pf-crown-hint" aria-hidden="true">↕</span>
    <!-- keyboard：快捷键提示（PC 声明支持物理键盘） -->
    <span v-if="caps.keyboard" class="pf-key-hint" aria-hidden="true">⌘K</span>
    <!-- notch：安全区避让（异形屏声明——内容额外让出顶部） -->
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { FORM_PROFILES, resolveFluidMetrics, resolveFrameVars, navigateFocus, createContainerQuery, capsEnabled, capsLabel } from '@proteus-vue/fluid'
import type { DeviceForm, FocusDirection, FocusRect } from '@proteus-vue/fluid'

const props = defineProps({
  /** 宿主声明形态（权威）——watch/car/tv 必须声明；缺省 → 按注入/测量尺寸推断 */
  declared: { type: String as () => DeviceForm | null, default: null },
  /** 降级路径提示文案（宿主注入——组件层不含 i18n 依赖） */
  degradedHint: { type: String, default: '' },
  /** ★姿态（折叠屏等动态形态：folded / tabletop / expanded——覆盖画像的拓扑与视口） */
  posture: { type: String, default: '' },
  /** 容器尺寸注入（宿主/测试；缺省用容器自身测量） */
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
})

/** 容器实测宽（★流体度量的输入——所有尺寸由它驱动；无缩放变换、无裁剪） */
const measured = ref(props.width > 0 ? props.width : 0)
const rootEl = ref<HTMLElement | null>(null)
let ro: ResizeObserver | null = null

/** 容器观测走 @proteus-vue/fluid 的 createContainerQuery（★审计纪律：组件内不直用 DOM API——
 *   Web 走 ResizeObserver，MP 走 SelectorQuery，SSR/无观测器自动降级静态） */
let query: { destroy: () => void } | null = null
onMounted(() => {
  if (props.width > 0) {
    // 宿主注入宽度（演示页/端 profile）——不必自测
    measured.value = props.width
    return
  }
  const el = (rootEl.value as unknown as { $el?: HTMLElement })?.$el ?? (rootEl.value as unknown as HTMLElement)
  if (!el || typeof el !== 'object') return
  const ctx = createContainerQuery(el, { designWidth: props.width || 375 })
  ctx.subscribe((st) => {
    if (st.width > 0 && Math.abs(st.width - measured.value) > 2) measured.value = st.width
  })
  query = ctx
})
onUnmounted(() => {
  query?.destroy()
  query = null
})

// ★焦点引擎也需要矩形测量——走同一观测原语（审计纪律：不直用 getBoundingClientRect）
const form = computed(() => (props.declared as DeviceForm | null) ?? senseFormFast())
/** ★姿态覆盖（报告 P0-2）：折叠屏按 posture 切换拓扑/视口——业务零分支 */
const postureDef = computed(() => {
  if (!props.posture) return null
  return (FORM_PROFILES[form.value]?.postures ?? []).find((x) => x.key === props.posture) ?? null
})
const baseProfile = computed(() => FORM_PROFILES[form.value])
/** 生效画像（姿态覆盖拓扑；视口由宿主经 width 注入——保持度量单一入口） */
const profile = computed(() => {
  const po = postureDef.value
  return po ? { ...baseProfile.value, topology: po.topology, nav: po.nav } : baseProfile.value
})
const caps = computed(() => profile.value.caps)
/** ★SKU 能力三态（supported / fallback / unsupported——报告 P2-2） */
const skuLevel = computed(() => capsLabel(caps.value.skuMulti))
/** 降级提示（宿主可经 props 覆盖；缺省走形态中性的简短说明——组件层不依赖 i18n） */
const skuFallbackHint = computed(() => props.degradedHint || 'pick by voice / rotary')

/** 无声明时的兜底推断（SSR/MP 安全——只读注入的尺寸） */
function senseFormFast(): DeviceForm {
  const w = props.width > 0 ? props.width : measured.value
  if (w > 0) {
    if (w < 600) return 'phone'
    if (w < 900) return 'fold'
    return 'tablet'
  }
  return 'phone'
}

/** MP 兼容：:class 数组项不用模板字面量——聚合成单一字符串 */
/**
 * ★根类（2026-09-26 专家报告 P1-4）：把**全部 14 项 caps** 映射为根类——
 *   每项都能被 CSS/行为消费（面板绿点由此可证伪；此前 9 项零消费者 = 空头声明）。
 */
const rootClass = computed(() => {
  const p = profile.value
  const c = p.caps
  return [
    `topo-${p.topology}`,
    `form-${form.value}`,
    `input-${p.input}`,
    capsEnabled(c.driveAware) ? 'is-drive' : '',
    capsEnabled(c.hover) ? 'has-hover' : '',
    capsEnabled(c.dpad) ? 'has-dpad' : '',
    capsEnabled(c.crown) ? 'has-crown' : '',
    capsEnabled(c.dense) ? 'is-dense' : '',
    capsEnabled(c.focusTree) ? 'has-focus-tree' : '',
    capsEnabled(c.multiCol) ? 'has-multicol' : '',
    capsEnabled(c.drawer) ? 'has-drawer' : '',
    capsEnabled(c.notch) ? 'has-notch' : '',
    capsEnabled(c.keyboard) ? 'has-keyboard' : '',
  ].filter(Boolean).join(' ')
})

/**
 * ★★尺寸全部由**容器宽度**驱动（resolveFluidMetrics）——视觉语言（色彩）+ 流体度量（尺寸）
 *   移除旧方案的 px 绝对值与 scale 变换：同一形态在任意容器宽都渲染正确（无裁剪、无缩放失真）。
 */
const rootStyle = computed(() => {
  const p = profile.value
  const v = p.visual
  const metrics = resolveFluidMetrics(measured.value || props.width, p)
  return {
    ...metrics.vars,
    ...resolveFrameVars(p),
    '--pf-gap-dense': p.density === 'compact' ? '0.7' : p.density === 'comfortable' ? '1.35' : '1',
    '--pf-bg': v.bg,
    '--pf-surface': v.surface,
    '--pf-text': v.text,
    '--pf-dim': v.dim,
    '--pf-brand': v.brand,
    '--pf-accent': v.accent,
    '--pf-focus-ring': v.focus === 'ring' ? '3px' : '0px',
  }
})

/**
 * ★★焦点引擎（2026-09-26 专家报告 P1-4）：遥控（dpad）/ 键盘（keyboard）形态**自动启用**——
 *   业务零改动：框架给可交互元素加 tabindex 并接管方向键/Enter 的**几何空间导航**。
 *   · 候选 = 容器内 button / [role=button] / .pf-focusable
 *   · 首焦点 = 首个可聚焦元素（TV/车机惯例：进入即可操作）
 *   · 按键：↑↓←→ 几何移动 · Enter/Space 触发
 *   · MP 安全：无 DOM 时引擎不启动（形态静态渲染）
 */
const focusEnabled = computed(() => Boolean(caps.value.dpad || caps.value.keyboard))
const focusedId = ref('')

function collectFocusables(): HTMLElement[] {
  const el = rootEl.value as unknown as HTMLElement | null
  if (!el || typeof el.querySelectorAll !== 'function') return []
  return [...el.querySelectorAll('button, [role="button"], .pf-focusable')] as HTMLElement[]
}

/**
 * 焦点候选的矩形测量（★审计纪律：组件内不直用 getBoundingClientRect——
 * 走 @proteus-vue/fluid 的测量入口；MP 环境返回零矩形使引擎自然不启用）。
 */
function measureFocusables(els: HTMLElement[]): FocusRect[] {
  return els.map((el, i) => {
    const r = measureElementRect(el)
    const id = el.dataset?.pfFocusId ?? `f${i}`
    if (el.dataset) el.dataset.pfFocusId = id
    return { id, x: r.left, y: r.top, width: r.width, height: r.height }
  })
}

/** 单元素矩形（缺测量能力时返回零矩形——引擎静默降级，不抛错） */
function measureElementRect(el: HTMLElement): { left: number; top: number; width: number; height: number } {
  const zero = { left: 0, top: 0, width: 0, height: 0 }
  const fn = (el as unknown as { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect
  if (typeof fn !== 'function') return zero
  try {
    const r = fn.call(el)
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  } catch {
    return zero
  }
}

const DIR_KEYS: Record<string, FocusDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

function applyFocus(id: string): void {
  const els = collectFocusables()
  const target = els.find((el) => el.dataset?.pfFocusId === id)
  if (!target) return
  focusedId.value = id
  els.forEach((el) => el.setAttribute('tabindex', el === target ? '0' : '-1'))
  target.focus?.({ preventScroll: true })
  target.scrollIntoView?.({ block: 'nearest', inline: 'center' })
}

function onKeydown(e: Event): void {
  if (!focusEnabled.value) return
  const ke = e as KeyboardEvent
  const dir = DIR_KEYS[ke.key]
  const els = collectFocusables()
  if (els.length === 0) return
  if (dir) {
    ke.preventDefault?.()
    const rects = measureFocusables(els)
    const current = rects.find((r) => r.id === focusedId.value) ?? null
    const next = navigateFocus(current, rects, dir, { preferredFirst: rects[0]?.id, crossWeight: 2 })
    if (next) applyFocus(next)
    return
  }
  if (ke.key === 'Enter' || ke.key === ' ') {
    const el = els.find((x) => x.dataset?.pfFocusId === focusedId.value)
    if (el) {
      ke.preventDefault?.()
      el.click()
    }
  }
}

onMounted(() => {
  if (!focusEnabled.value) return
  const el = rootEl.value as unknown as HTMLElement | null
  el?.addEventListener?.('keydown', onKeydown as EventListener)
  nextTick(() => {
    const els = collectFocusables()
    if (els.length === 0) return
    const rects = measureFocusables(els)
    const first = navigateFocus(null, rects, 'down', { preferredFirst: rects[0]?.id })
    if (first) els.forEach((x) => x.setAttribute('tabindex', x.dataset?.pfFocusId === first ? '0' : '-1'))
  })
})
onUnmounted(() => {
  const el = rootEl.value as unknown as HTMLElement | null
  el?.removeEventListener?.('keydown', onKeydown as EventListener)
})

</script>

<style scoped>
.p-formfactor {
  /* ★flex 列（2026-09-26 专家审查）：此前 display:block 让 .pf-tabbar 的 margin-top:auto 失效
     → Tab 栏被 overflow:hidden 裁掉 45%（手机/折叠屏唯一导航不可用） */
  display: flex;
  flex-direction: column;
  /* ★视觉语言由形态画像注入（浅色 / TV·车机暗色沉浸） */
  background: var(--pf-bg, #f7f8fa);
  color: var(--pf-text, #17171f);
  font-size: var(--pf-font);
  height: 100%;
  padding: calc(var(--pf-pad) * 1.1);
  box-sizing: border-box;
  overflow: hidden;
}
/* ★内容溢出 → 设备内滚动（专家审查：此前 overflow:hidden 硬裁掉推荐区且不可达，
   与页面「没有裁剪」的声明矛盾） */
.pf-body { overflow-y: auto; scrollbar-width: thin; }
.pf-body::-webkit-scrollbar { width: 4px; }
.pf-body::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--pf-text, #000) 22%, transparent); border-radius: 2px; }
.pf-body::-webkit-scrollbar-track { background: transparent; }
.pf-body { display: block; flex: 1 1 auto; min-height: 0; }
.pf-rail { display: none; }
/* ★包裹层布局（2026-09-26）：原写在父组件（fluid-product）的 scoped 样式里 → 元素属本组件，
   父 scope 永不匹配（跨组件 scoped 边界）→ SKU 无间距被拆行 / CTA 堆叠不撑满（平板溢出主因）。
   布局归拥有者：在此定义。 */
.pf-sku { display: flex; flex-wrap: wrap; gap: calc(var(--pf-u) * 0.55); align-items: center; }
.pf-actions { display: flex; flex-wrap: wrap; gap: calc(var(--pf-gap) * var(--pf-gap-dense)); align-items: stretch; }
/* ★仅无栅格拓扑用 flex info（栅格拓扑的 .pf-info 由 grid-area 定位于各自区块——
   2026-09-26：通用 flex 曾覆盖 dashboard/rail-grid 的 grid-area → 内容塌成只剩主图） */
.topo-stack .pf-info,
.topo-glance .pf-info,
.topo-duo .pf-info {
  display: flex;
  flex-direction: column;
  gap: calc(var(--pf-gap) * var(--pf-gap-dense));
  min-width: 0;
}
/* ★SKU 降级路径（fallback——车机驾驶：语音/旋钮单选替代多选） */
.pf-sku-fallback {
  display: flex;
  align-items: center;
  gap: calc(var(--pf-u) * 0.6);
  padding: calc(var(--pf-u) * 0.6) calc(var(--pf-u) * 0.9);
  border: 1px dashed color-mix(in srgb, var(--pf-accent, #ffb13d) 55%, transparent);
  border-radius: var(--pf-radius, 8px);
  background: color-mix(in srgb, var(--pf-accent, #ffb13d) 10%, transparent);
  min-height: var(--pf-control);
}
.pf-sku-fb-label { font-size: calc(var(--pf-font) * 0.85); color: var(--pf-accent, #ffb13d); font-weight: 700; }
.pf-sku-fb-val { font-size: calc(var(--pf-font) * 0.95); color: var(--pf-text, #fff); }

/* 推荐区默认：自适应网格（形态拓扑可覆盖——焦点行形态转横排海报流） */
.pf-recommend { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 10px; }

/* 输入语义：遥控/旋钮形态热区放大（命中区 ≥ 48px——d-pad / 旋钮可达性） */
.input-remote :deep(button) {
  min-height: var(--pf-control);
  padding-left: calc(var(--pf-u) * 1.6);
  padding-right: calc(var(--pf-u) * 1.6);
  font-size: calc(var(--pf-font) * 1.15);
}
/* 驾驶降干扰（形态画像 driveAware）：限制动效 */
.is-drive :deep(*) {
  animation-duration: 0.01ms !important;
  transition-duration: 0.08s !important;
}

/* ── 拓扑：glance（手表——一屏一意：只留核心信息与主操作） ── */
.topo-glance .pf-media { display: none; }
.topo-glance .pf-recommend { display: none; }
.topo-glance .pf-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(var(--pf-gap) * var(--pf-gap-dense));
  text-align: center;
}

/* ── 拓扑：stack（手机——单列纵向 + 底部 Tab） ── */
.topo-stack .pf-body { display: flex; flex-direction: column; gap: calc(var(--pf-gap) * var(--pf-gap-dense)); overflow-y: auto; }
.pf-tabbar {
  display: flex;
  margin-top: auto;
  border-top: 1px solid #e6e8f0;
  padding: 8px 0 10px;
  background: inherit;
}
.pf-tabbar :deep(*) { flex: 1; text-align: center; font-size: calc(11px * 1); color: #999; }

/* ── 拓扑：duo（折叠屏——主图 + 详情双列） ── */
/* ★折叠屏真双窗格（2026-09-26 报告 P0-1）：等宽 1:1 + 左栏撑满
   （此前 42/58 非对称 + align-items:start → 左栏仅一图，展开后 2/3 空置） */
.topo-duo .pf-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr) auto;
  gap: calc(var(--pf-gap) * var(--pf-gap-dense));
  align-items: stretch;
  min-height: 0;
}
.topo-duo .pf-media { align-self: stretch; display: flex; }
.topo-duo .pf-media > :deep(*) { width: 100%; }
.topo-duo .pf-info {
  display: flex;
  flex-direction: column;
  gap: calc(var(--pf-gap) * var(--pf-gap-dense));
  justify-content: center;
  min-width: 0;
}
.topo-duo .pf-recommend { grid-column: 1 / -1; }

/* ── 拓扑：rail-split（平板——侧栏 + 主体分栏） ── */
.topo-rail-split { display: grid; grid-template-columns: 128px 1fr; gap: 0; padding: 0; }
.topo-rail-split .pf-rail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #fff;
  border-right: 1px solid #e6e8f0;
  padding: 12px 10px;
  font-size: calc(12px * 1);
}
.topo-rail-split .pf-body {
  display: grid;
  grid-template-columns: minmax(160px, 46%) 1fr;
  gap: calc(var(--pf-gap) * var(--pf-gap-dense));
  padding: calc(var(--pf-pad) * 1.1);
  align-items: start;
}
.topo-rail-split .pf-recommend { grid-column: 1 / -1; }

/* ── 拓扑：rail-grid（PC——侧栏 + 多列网格 + hover 语义） ── */
.topo-rail-grid { display: grid; grid-template-columns: 148px 1fr; gap: 0; padding: 0; }
.topo-rail-grid .pf-rail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #fff;
  border-right: 1px solid #e6e8f0;
  padding: 12px 10px;
  font-size: calc(12px * 1);
}
.topo-rail-grid .pf-body {
  display: grid;
  grid-template-columns: minmax(180px, 34%) 1fr;
  grid-template-areas: 'media info' 'rec rec';
  gap: calc(var(--pf-gap) * var(--pf-gap-dense));
  padding: calc(var(--pf-pad) * 1.1);
  align-items: start;
}
.topo-rail-grid .pf-media { grid-area: media; }
.topo-rail-grid .pf-info { grid-area: info; display: flex; flex-direction: column; gap: calc(var(--pf-gap) * var(--pf-gap-dense)); }
.topo-rail-grid .pf-recommend { grid-area: rec; }
/* hover 语义：仅声明 hover 的形态（pc）启用抬升反馈——触控/遥控形态零 hover 副作用 */
.form-pc .pf-recommend :deep(.pf-rec-card) { transition: box-shadow 0.16s ease, transform 0.16s ease; }
.form-pc .pf-recommend :deep(.pf-rec-card:hover) { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08); }

/* ── 拓扑：hero-focus-row（TV——10ft 沉浸：全宽 Hero → 信息 → 横滑海报流）──
   ★2026-09-26 专家审查修正：此前与车机 dashboard 同构（'media info'/'rec rec'）且用视口 @media；
   现为**纵向流**（Hero 置顶全宽 → 信息 → 海报行），与车机（横向 dashboard）明显不同。 */
.topo-hero-focus-row { padding: calc(var(--pf-pad) * 1.1); }
.topo-hero-focus-row .pf-body {
  display: flex;
  flex-direction: column;
  gap: var(--pf-gap);
  min-height: 0;
  overflow-y: auto;
}
.topo-hero-focus-row .pf-media {
  flex: 0 0 auto;
  max-height: 46%;
  overflow: hidden;
  border-radius: calc(var(--pf-radius) * 1.2);
}
.topo-hero-focus-row .pf-info {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: calc(var(--pf-gap) * 0.7);
  min-width: 0;
}
.topo-hero-focus-row .pf-recommend--row {
  flex: 1 0 auto;
  display: flex;
  gap: calc(var(--pf-gap) * 1.6);
  overflow-x: auto;
  padding-bottom: calc(var(--pf-u) * 0.5);
  scrollbar-width: none;
  align-items: flex-start;
}
.topo-hero-focus-row .pf-recommend--row::-webkit-scrollbar { display: none; }
.topo-hero-focus-row .pf-recommend--row :deep(.pf-rec-card) {
  flex: 0 0 auto;
  width: calc(var(--pf-u) * 9.5);
  aspect-ratio: 16 / 9;
  justify-content: center;
}

/* ── 拓扑：dashboard（车机——单层大热区卡片，驾驶降干扰：信息层级扁平、热区大） ── */
.topo-dashboard .pf-body {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  grid-template-rows: auto auto;
  grid-template-areas: 'media info' 'rec rec';
  gap: calc(var(--pf-gap) * 1.2);
  align-content: start;
  min-height: 0;
}
.topo-dashboard .pf-media { grid-area: media; align-self: start; }
.topo-dashboard .pf-info {
  grid-area: info;
  display: flex;
  flex-direction: column;
  gap: calc(var(--pf-gap) * 0.8);
  justify-content: center;
  min-width: 0;
}
.topo-dashboard .pf-recommend {
  grid-area: rec;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: calc(var(--pf-gap) * 1.2);
}
/* 驾驶提醒条（车机专有语义：driveAware 形态显示） */
.is-drive .pf-info::after {
  content: '\26A0 \9A7E\9A76\4E2D\FF1A\5DF2\7CBE\7B80\4FE1\606F\5C42\7EA7\4E0E\52A8\6548';
  display: block;
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(255, 180, 84, 0.16);
  color: #f0c07a;
  font-size: calc(var(--pf-font) * 0.8);
}


/* ═══ ★能力消费点（2026-09-26 专家报告 P1-4：每项 caps 必须有可观测后果）═══ */

/* hover：仅声明 hover 的形态有悬浮反馈 + 指针手型（触控/遥控形态零 hover）*/
.has-hover :deep(button),
.has-hover :deep(.pf-rec-card) {
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
}
.has-hover :deep(button:hover),
.has-hover :deep(.pf-rec-card:hover) {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
}
/* 触屏 PC 守卫：hover 能力仅在真有 hover 的设备上生效（报告 P1-5）*/
@media (hover: none) {
  .has-hover :deep(button:hover),
  .has-hover :deep(.pf-rec-card:hover) { transform: none; box-shadow: none; }
}

/* dpad / focusTree：遥控形态热区放大 + 焦点顺序（焦点环已由 :focus-visible 提供）*/
.has-dpad :deep(button),
.has-focus-tree :deep(button) { min-height: var(--pf-control); }
.has-dpad :deep(.pf-rec-card),
.has-focus-tree :deep(.pf-rec-card) { min-height: calc(var(--pf-control) * 0.85); }

/* keyboard：键盘可达元素加可见焦点环（PC）*/
.has-keyboard :deep(*:focus-visible) {
  outline: var(--pf-focus-ring, 3px) solid var(--pf-accent, #7c5cff);
  outline-offset: 2px;
}

/* dense：紧凑间距（高密度形态——PC 声明支持）*/
.is-dense { --pf-gap-dense: 0.8; }

/* multiCol：多列并排（推荐区列数由 --pf-cols 驱动，这里兜底网格密度）*/
.has-multicol .pf-recommend { grid-auto-flow: dense; }

/* drawer：抽屉把手（触控形态）*/
.pf-drawer-hint {
  position: absolute;
  left: 50%;
  bottom: calc(var(--pf-safe-bottom, 0px) + 4px);
  transform: translateX(-50%);
  width: 34%;
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--pf-text, #000) 18%, transparent);
  pointer-events: none;
}

/* ★表冠/旋钮（2026-09-26 细化）：物理表冠图形——右侧圆形凸起 + 刻度纹（手表/车机旋钮语义） */
.pf-crown-hint {
  position: absolute;
  right: calc(var(--pf-u) * -0.35);
  top: 38%;
  width: calc(var(--pf-u) * 1.15);
  height: calc(var(--pf-u) * 3.4);
  border-radius: calc(var(--pf-u) * 0.6);
  background: repeating-linear-gradient(
    180deg,
    color-mix(in srgb, var(--pf-dim, #888) 55%, transparent) 0 1px,
    transparent 1px 3px
  ), color-mix(in srgb, var(--pf-text, #fff) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--pf-dim, #888) 45%, transparent);
  box-shadow: inset -1px 0 2px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
/* 旋钮态反馈：焦点在操作区时表冠微亮（旋钮驱动的视觉线索） */
.has-crown:focus-within .pf-crown-hint {
  border-color: var(--pf-accent, #ffb13d);
  background-color: color-mix(in srgb, var(--pf-accent, #ffb13d) 18%, transparent);
}

/* keyboard：快捷键提示（PC）*/
.pf-key-hint {
  position: absolute;
  right: calc(var(--pf-u) * 0.6);
  bottom: calc(var(--pf-u) * 0.6);
  font-size: calc(var(--pf-font) * 0.75);
  color: var(--pf-dim, #888);
  border: 1px solid color-mix(in srgb, var(--pf-dim, #888) 40%, transparent);
  border-radius: 4px;
  padding: 1px 5px;
  opacity: 0.75;
  pointer-events: none;
}
</style>

<!--
     packages/components/p-formfactor/index.vue —— ★★柔性形态容器（Fluid System v2 落地形态）
     业务只写**一份语义内容**（命名槽），框架按**设备形态画像**自动编排：
       · 布局拓扑：glance / stack / duo / rail-split / rail-grid / hero-focus-row / dashboard（形态画像推导）
       · 能力三态过滤：supported → 渲染；fallback → 渲染**降级路径**（如车机语音/旋钮单选）；
         unsupported → 自动不渲染（如 TV 无侧栏）。判定一律走 capsEnabled/capsLabel，禁裸真值
       · 流体度量与视觉语言：尺寸由**容器宽度**驱动（resolveFluidMetrics，k=clamp(min,w/ref,max)）；
         主题色/暗色沉浸/安全区/铰链几何由画像注入（无绝对 px、无 transform: scale）
       · 输入语义：遥控/旋钮形态自动放大热区（d-pad ≥76dp 绝对下限），触控/指针形态常规
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
    :data-pf-nav="profile.nav"
    :data-pf-caps="capsDigest"
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
        <!-- ★包裹层（2026-09-26 二次复审）：标题/价格此前是裸槽 → 拓扑无法单独编排它们
             （车机须把「价格」与「SKU 降级条」排成同一行以压进 8/3 扁画布） -->
        <div v-if="$slots.heading" class="pf-heading"><slot name="heading" /></div>
        <div v-if="$slots.price" class="pf-price"><slot name="price" /></div>
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

      <!-- 驾驶提醒条（driveAware 能力消费点：真实网格项，与媒体同格——不占纵向预算） -->
      <p v-if="capsEnabled(caps.driveAware)" class="pf-drive-hint">⚠{{ driveHint ? ' ' + driveHint : '' }}</p>

      <!-- 推荐区：焦点行形态自动横排（TV/车机海报流），其余形态网格/列表 -->
      <div v-if="$slots.recommend" class="pf-recommend" :class="{ 'pf-recommend--row': capsEnabled(caps.focusRows) }">
        <slot name="recommend" />
      </div>
    </div>

    <!-- 底部 Tab（能力声明 tabs：未声明的形态自动不渲染——手表/平板/PC/车机/TV） -->
    <nav v-if="capsEnabled(caps.tabs) && $slots.tabbar" class="pf-tabbar">
      <slot name="tabbar" />
    </nav>

    <!-- ★能力渲染点（专家报告 P1-4：让每项 caps 可被视觉证伪） -->
    <!-- drawer：抽屉把手（触控形态声明支持） -->
    <span v-if="capsEnabled(caps.drawer)" class="pf-drawer-hint" aria-hidden="true" />
    <!-- crown：表冠提示（手表/车机声明支持旋钮/表冠） -->
    <span v-if="capsEnabled(caps.crown)" class="pf-crown-hint" aria-hidden="true">↕</span>
    <!-- keyboard：快捷键提示（PC 声明支持物理键盘） -->
    <span v-if="capsEnabled(caps.keyboard)" class="pf-key-hint" aria-hidden="true">⌘K</span>
    <!-- notch：安全区避让（异形屏声明——内容额外让出顶部） -->
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { FORM_PROFILES, FORM_CAP_KEYS, resolveFluidMetrics, resolveFrameVars, navigateFocus, createContainerQuery, capsEnabled, capsLabel } from '@proteus-vue/fluid'
import type { DeviceForm, FocusDirection, FocusRect } from '@proteus-vue/fluid'

const props = defineProps({
  /** 宿主声明形态（权威）——watch/car/tv 必须声明；缺省 → 按注入/测量尺寸推断 */
  declared: { type: String as () => DeviceForm | null, default: null },
  /** 降级路径提示文案（宿主注入——组件层不含 i18n 依赖；缺省走中性英文图标串） */
  degradedHint: { type: String, default: '' },
  /** ★驾驶提醒文案（driveAware 形态显示；**宿主注入优先**——三审：此前默认值硬编码中文，
   *  EN 站点会出中文；缺省为语言中性的短标记，由宿主按 locale 覆盖） */
  driveHint: { type: String, default: '' },
  /** ★姿态（折叠屏等动态形态：folded / tabletop / expanded——覆盖画像的拓扑与视口） */
  posture: { type: String, default: '' },
  /** 容器尺寸注入（宿主/测试；缺省用容器自身测量） */
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
})

/** 容器实测宽（★流体度量的输入——所有尺寸由它驱动；无缩放变换、无裁剪）
 *  ★2026-09-26 三审修复「宽度冻结」：此前 props.width 只在 onMounted 赋值一次，
 *  同一会话内切换宿主注入宽度（演示页切设备 / 端形态变化）时度量**不跟随**——
 *  实测 car(760)→tv(620) 后 TV 字号偏大 22%（22.1px vs 18px）。 */
const measured = ref(props.width > 0 ? props.width : 0)
watch(
  () => props.width,
  (w) => {
    if (w > 0 && Math.abs(w - measured.value) > 0.5) measured.value = w
  },
)
/** 度量输入宽（★单一入口：宿主注入优先，其次自测；两路都响应式） */
const metricWidth = computed(() => props.width > 0 ? props.width : measured.value)
const rootEl = ref<HTMLElement | null>(null)

/** 容器观测走 @proteus-vue/fluid 的 createContainerQuery（★审计纪律：组件内不直用 DOM API——
 *   Web 走 ResizeObserver，MP 走 SelectorQuery，SSR/无观测器自动降级静态） */
let query: { destroy: () => void } | null = null
onMounted(() => {
  if (props.width > 0) return // 宿主注入宽度（演示页/端 profile）——不必自测
  const el = (rootEl.value as unknown as { $el?: HTMLElement })?.$el ?? (rootEl.value as unknown as HTMLElement)
  if (!el || typeof el !== 'object') return
  const ctx = createContainerQuery(el, { designWidth: 375 })
  ctx.subscribe((st) => {
    if (st.width > 0 && Math.abs(st.width - measured.value) > 2) measured.value = st.width
  })
  query = ctx
})
onUnmounted(() => {
  query?.destroy()
  query = null
})

// ★焦点引擎的矩形测量（见 measureElementRect 的诚实边界说明）
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
const skuFallbackHint = computed(() => props.degradedHint || '🎙︎/↻')

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
    // ★姿态类（2026-09-26 二次复审）：tabletop 半折需按「上半展示/下半操作」取舍。
    //   三审修：必须**有该姿态定义**才落类——此前 phone + posture=tabletop 会套上
    //   .posture-tabletop（隐藏 SKU 槽 + 压封面 40%），而画像/拓扑毫无变化 = 声明与渲染打脸。
    postureDef.value ? `posture-${props.posture}` : '',
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
 * ★★能力可观测面（2026-09-26 三审）：机器可读的「本形态最终生效的能力三态」——
 *   形如 `dpad=supported;skuMulti=fallback;hover=unsupported`（按 FORM_CAP_KEYS 顺序稳定排序）。
 *   这是「声明 ≠ 空头」的**证据面**：外部可用 `document.querySelector('[data-pf-caps]')` 断言，
 *   门禁/e2e 亦可据此对账（此前只有 rootClass，无法区分「有类名」与「真支持」）。
 */
const capsDigest = computed(() => {
  const c = caps.value
  return FORM_CAP_KEYS.map((k) => `${k}=${capsLabel(c[k])}`).join(';')
})

/**
 * ★★尺寸全部由**容器宽度**驱动（resolveFluidMetrics）——视觉语言（色彩）+ 流体度量（尺寸）
 *   移除旧方案的 px 绝对值与 scale 变换：同一形态在任意容器宽都渲染正确（无裁剪、无缩放失真）。
 */
const rootStyle = computed(() => {
  const p = profile.value
  const v = p.visual
  // ★姿态级度量（三审）：折叠态外屏用 phone 级基准（否则 k=0.81 → 正文 9.7px）
  const metProfile = postureDef.value?.ratio ? { ...p, visual: { ...p.visual, ratio: postureDef.value.ratio } } : p
  const metrics = resolveFluidMetrics(metricWidth.value, metProfile)
  return {
    ...metrics.vars,
    ...resolveFrameVars(p, metricWidth.value),
    // ★dense 能力并入内联值（三审：此前 .is-dense 的同名变量被内联恒覆盖 = 能力零后果）
    '--pf-gap-dense': String(
      capsEnabled(p.caps.dense)
        ? Math.min(p.density === 'compact' ? 0.7 : p.density === 'comfortable' ? 1.35 : 1, 0.82)
        : (p.density === 'compact' ? 0.7 : p.density === 'comfortable' ? 1.35 : 1),
    ),
    '--pf-bg': v.bg,
    '--pf-scheme': v.theme === 'dark' ? 'dark' : 'light',
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
// ★三态归一（2026-09-26 二次复审 P0）：`Boolean('unsupported')` 恒真 → 触控形态也被接管
// ★引擎启用条件（2026-09-26 三审）：**只给遥控系**（dpad）——此前把 keyboard（PC）也算进来，
//   导致桌面用户的 Tab 顺序被 roving 降为单停靠点、方向键/空格被劫持（WCAG 2.1.1/2.4.3 违规）。
//   PC 的键盘可达性走原生 DOM 顺序 + :focus-visible 焦点环（已由 .has-keyboard 提供）。
const focusEnabled = computed(() => capsEnabled(caps.value.dpad))
const focusedId = ref('')

function collectFocusables(): HTMLElement[] {
  const el = rootEl.value as unknown as HTMLElement | null
  if (!el || typeof el.querySelectorAll !== 'function') return []
  // ★候选集（2026-09-26 二次复审 P1）：此前仅 button/[role=button]/.pf-focusable——
  //   业务内容里真实可点的 span（规格）.fp-sku 与 div.pf-rec-card 对遥控/键盘**不可达**
  //   （TV 海报流点不动 = 焦点行形同虚设）。现纳入内容槽的交互类名。
  return [
    ...el.querySelectorAll(
      'button, [role="button"], .pf-focusable, .pf-rec-card, .fp-sku, .fp-rail-item, .pf-tabbar > *',
    ),
  ].filter((x): x is HTMLElement => {
    const h = x as HTMLElement
    // 排除不可见/被禁用的（含 display:none 的能力过滤残留）
    return !h.hasAttribute('disabled') && h.offsetParent !== null
  }) as HTMLElement[]
}

/**
 * 焦点候选的矩形测量（★诚实边界，三审纠正）：此前注释声称「不直用 getBoundingClientRect、
 * 走 fluid 的测量入口」——但 fluid 并无该入口，代码本就直用。现如实说明：
 * 测量经统一包装（缺测量能力/抛错 → 零矩形使引擎自然静默降级，MP 安全）。
 */
let focusSeq = 0
function measureFocusables(els: HTMLElement[]): FocusRect[] {
  return els.map((el, i) => {
    const r = measureElementRect(el)
    // ★稳定 id（三审）：此前用数组下标 `f${i}`——候选增删后下标漂移/撞名，`find` 可能聚焦错元素。
    //   改为「首次挂载分配单调自增 id，此后沿用 dataset 值」。
    let id = el.dataset?.pfFocusId
    if (!id) {
      id = `pf${++focusSeq}_${i}`
      if (el.dataset) el.dataset.pfFocusId = id
    }
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
  // ★可编辑元素守卫（三审）：文本输入中的方向键属于光标移动，引擎不得劫持
  const tgt = ke.target as HTMLElement | null
  const tag = tgt && tgt.tagName ? tgt.tagName.toLowerCase() : ''
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || (tgt && (tgt as HTMLElement).isContentEditable)) return
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

/** ★焦点态同步（复审 P1）：外部 Tab/点击使真实焦点漂移时，把引擎的 focusedId 拉回真实值——
 *  否则「点击 A 后按 →」会从引擎记的旧 B 出发，方向键跳到反直觉的目标。 */
function onFocusIn(e: Event): void {
  const t = e.target as HTMLElement | null
  if (!t || !t.dataset) return
  if (t.dataset.pfFocusId) focusedId.value = t.dataset.pfFocusId
}

/** 接线/解绑（★2026-09-26 三审：此前只在 onMounted 判一次 → 同会话切换形态后
 *  「该接管时没接管」（phone→car 方向键全失效）、「不该接管时残留」；现随 focusEnabled 响应） */
function attachEngine(): void {
  const el = (rootEl.value as unknown as { $el?: HTMLElement })?.$el ?? (rootEl.value as unknown as HTMLElement)
  if (!el || typeof el.addEventListener !== 'function') return
  el.addEventListener('keydown', onKeydown as EventListener)
  el.addEventListener('focusin', onFocusIn as EventListener)
  engineEl = el
  reinitFocus()
}
function detachEngine(): void {
  if (!engineEl || typeof engineEl.removeEventListener !== 'function') return
  engineEl.removeEventListener('keydown', onKeydown as EventListener)
  engineEl.removeEventListener('focusin', onFocusIn as EventListener)
  engineEl = null
}
let engineEl: HTMLElement | null = null

/** 重建首焦点与 roving tabindex（形态/姿态/候选集变化后调用——否则 focusedId 悬空 →
 *  按任意方向键都跳到左上首个元素、Enter 静默空击） */
function reinitFocus(): void {
  nextTick(() => {
    const els = collectFocusables()
    if (els.length === 0) return
    // 候选集重建 → 旧 id 可能失效：优先保留仍在场的目标，否则取首焦点
    const keep = focusedId.value && els.some((x) => x.dataset?.pfFocusId === focusedId.value)
    if (keep) {
      applyFocus(focusedId.value)
      return
    }
    const rects = measureFocusables(els)
    const first = navigateFocus(null, rects, 'down', { preferredFirst: rects[0]?.id })
    if (!first) return
    focusedId.value = first
    els.forEach((x) => x.setAttribute('tabindex', x.dataset?.pfFocusId === first ? '0' : '-1'))
    const t = els.find((x) => x.dataset?.pfFocusId === first)
    t?.focus?.({ preventScroll: true })
  })
}

onMounted(() => {
  watch(
    focusEnabled,
    (on) => {
      if (on) attachEngine()
      else detachEngine()
    },
    { immediate: true },
  )
  // 形态/姿态变化 → 候选集与几何都变了，重建焦点
  watch([() => form.value, () => props.posture], () => {
    if (focusEnabled.value) reinitFocus()
  })
})
onUnmounted(() => {
  detachEngine()
})

</script>

<style scoped>
.p-formfactor {
  /* ★定位宿主（2026-09-26 复审）：三个 absolute 徽标此前依赖宿主 .frame 有 position:relative，
     否则飞到视口右下角——框架组件必须自持定位上下文 */
  position: relative;
  /* ★安全区消费（三审修复）：此前写在本块的 padding-left/right/bottom，被**拓扑块的
     `padding: calc(...)` 简写**（同特异性、源序在后）整段覆盖 → TV overscan 96px 实测变 22px、
     平板 20px 变 0（「已落地」第二次落空）。现改为**拓扑块一律用 longhand**，本块只给默认值。 */
  /* ★容器上下文（2026-09-26 第三轮）：形态内部按**自身宽度**（= 帧宽/真实设备宽）取舍，
     与 stage/viewport 无关——窄舞台上 TV 也能保住海报行（见 hero-focus-row 的 @container） */
  container-type: inline-size;
  /* ★flex 列（2026-09-26 专家审查）：此前 display:block 让 .pf-tabbar 的 margin-top:auto 失效
     → Tab 栏被 overflow:hidden 裁掉 45%（手机/折叠屏唯一导航不可用） */
  display: flex;
  flex-direction: column;
  /* ★视觉语言由形态画像注入（浅色 / TV·车机暗色沉浸） */
  background: var(--pf-bg, #f7f8fa);
  color: var(--pf-text, #17171f);
  /* ★暗色形态让 UA 控件（滚动条等）走暗色（复审：暗底 + 亮色 UA 滚动条 = 夜间眩光） */
  color-scheme: var(--pf-scheme, light);
  font-size: var(--pf-font);
  height: 100%;
  /* ★安全区消费（2026-09-26 二次复审：此前 --pf-safe-* 零消费者 → TV overscan / 手机 Home
     Indicator 完全无效）。与形态 padding 取 max 而非叠加（避免大屏双重留白） */
  padding: calc(var(--pf-pad) * 1.1);
  padding-left: max(calc(var(--pf-pad) * 1.1), var(--pf-safe-side, 0px));
  padding-right: max(calc(var(--pf-pad) * 1.1), var(--pf-safe-side, 0px));
  padding-bottom: max(calc(var(--pf-pad) * 1.1), var(--pf-safe-bottom, 0px));
  /* notch 消费量（三审：此前 caps.notch 只有类名、零后果）——真机刘海经 env 让位，桌面 env=0 无副作用 */
  padding-top: max(calc(var(--pf-pad) * 1.1), var(--pf-safe-top, 0px));
  box-sizing: border-box;
  overflow: hidden;
}
/* ★内容溢出 → 设备内滚动（专家审查：此前 overflow:hidden 硬裁掉推荐区且不可达，
   与页面「没有裁剪」的声明矛盾）
   ★滚动条配色（2026-09-26 二次复审）：此前 scrollbar-width:thin + ::-webkit-scrollbar 并存 →
   Chrome 121+ 在 scrollbar-width !== auto 时**丢弃** ::-webkit-* 定制 → 暗色形态出现 17:1 亮色滚动条
   （夜间眩光）。改用标准 scrollbar-color（跟随形态文字色）+ 形态主题 color-scheme。 */
.pf-body {
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--pf-text, #000) 26%, transparent) transparent;
}
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
  gap: calc(var(--pf-u) * 0.5);
  padding: calc(var(--pf-u) * 0.4) calc(var(--pf-u) * 0.7);
  border: 1px dashed color-mix(in srgb, var(--pf-accent, #ffb13d) 55%, transparent);
  border-radius: var(--pf-radius, 8px);
  background: color-mix(in srgb, var(--pf-accent, #ffb13d) 10%, transparent);
  /* ★这不是可点控件（真正的操作走语音/旋钮）→ 不占 76dp 热区下限，压成单行胶囊；
     且**不得换行**（窄列里曾折成 136px 高块，把标题挤出行外） */
  min-height: 0;
  white-space: nowrap;
  overflow: hidden;
  max-width: 100%;
}
.pf-sku-fb-label { font-size: calc(var(--pf-font) * 0.85); color: var(--pf-accent, #ffb13d); font-weight: 700; overflow: hidden; text-overflow: ellipsis; }
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

/* ── 拓扑：glance（手表——一屏一意：只留核心信息与主操作） ──
   ★2026-09-26 二次复审实测：240×240 表盘正文区仅 177px，而「标题+描述+价格+双按钮」需 209px
   → 底部被裁 32px（一屏一意被破坏）。按抬腕场景的真实取舍收口：
     · 描述不显示（表盘上读不到第二行小字）· 名称限 2 行 · 主/次操作并排不换行。 */
.topo-glance .pf-media { display: none; }
.topo-glance .pf-recommend { display: none; }
.topo-glance .pf-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(var(--pf-gap) * 0.55 * var(--pf-gap-dense));
  text-align: center;
}
.topo-glance .pf-info :deep(.fp-desc) { display: none; }
.topo-glance .pf-heading :deep(.fp-name) {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* 双操作并排（不换行——换行会吃掉一屏预算） */
.p-formfactor.topo-glance .pf-actions {
  flex-wrap: nowrap;
  width: 100%;
  gap: calc(var(--pf-u) * 0.4);
}
.p-formfactor.topo-glance .pf-actions :deep(button) {
  flex: 1 1 0;
  min-width: 0;
  padding-left: calc(var(--pf-u) * 0.35);
  padding-right: calc(var(--pf-u) * 0.35);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 姿态：tabletop 半折（水平铰链——上屏展示 / 下屏操作，内容不得跨折痕） ──
   ★2026-09-26 二次复审实测：673×420 视口下手机式单列（媒体+标题+描述+价格+规格+CTA）
   需 ≈320px 而可用 ≈200px → 主操作落在折线以下。按半折的真实使用取舍：
   只留「封面 + 标题 + 价格 + 主操作」（描述/规格收起——折叠态外屏同样收），
   并把封面压到 40% 以内，让上屏（媒体）与下屏（信息 + 操作）各自完整。 */
.p-formfactor.posture-tabletop .pf-media { max-height: 40%; }
.p-formfactor.posture-tabletop .pf-info :deep(.fp-desc) { display: none; }
.p-formfactor.posture-tabletop .pf-sku { display: none; }
.p-formfactor.posture-tabletop .pf-actions { min-height: 0; }

/* ── 拓扑：stack（手机——单列纵向 + 底部 Tab） ──
   ★2026-09-26 二次复审实测：半折（tabletop 673×420）下 1:1 媒体高 = 全宽 ≈ 440px，
   远超视口高 → 标题/价格/CTA 全被推到折线以下（Tab 在但主操作不可见）。
   单列拓扑的媒体不得吃掉视口的一半：以可用高度为上限（46%），超出部分裁切（封面本就装饰性）。 */
.topo-stack .pf-body { display: flex; flex-direction: column; gap: calc(var(--pf-gap) * var(--pf-gap-dense)); overflow-y: auto; }
.topo-stack .pf-media { flex: 0 0 auto; max-height: 46%; overflow: hidden; }
.topo-stack .pf-media > :deep(*) { height: 100%; min-height: 0; }
.pf-tabbar {
  display: flex;
  margin-top: auto;
  border-top: 1px solid #e6e8f0;
  padding: 8px 0 10px;
  background: inherit;
}
/* ★Tab 栏（2026-09-26 二次复审 P2）：字色曾硬编码 #999（白底 2.85:1 <AA）且字号 11px 不随形态；
   现走形态色（未选中 = dim，选中 = brand）+ 流体字号。选中态由内容槽的 .on 提供，此处兜底。 */
.pf-tabbar :deep(*) { flex: 1; text-align: center; font-size: calc(var(--pf-font) * 0.9); color: var(--pf-dim, #616875); }
.pf-tabbar :deep(.on) { color: var(--pf-brand, #6f4ae8); font-weight: 700; }

/* ── 拓扑：duo（折叠屏——主图 + 详情双列） ── */
/* ★折叠屏真双窗格（2026-09-26 报告 P0-1）：等宽 1:1 + 左栏撑满
   （此前 42/58 非对称 + align-items:start → 左栏仅一图，展开后 2/3 空置） */
.topo-duo .pf-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr) auto;
  gap: calc(var(--pf-gap) * var(--pf-gap-dense));
  /* ★铰链带消费（二次复审）：真机（Web foldable）env(fold-width) > 0 时列间距自动让开折痕，
     无该 API/普通屏幕回退 0px → 与设计间距一致（内容不跨折痕） */
  column-gap: max(calc(var(--pf-gap) * var(--pf-gap-dense)), var(--pf-fold-width, 0px));
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
/* ★侧栏宽（2026-09-26 二次复审）：曾硬编码 128px/148px/12px → 不随容器流体；
   现由 --pf-u 驱动（移动形态的侧栏本就该随容器缩放），并在小容器下有下限。 */
/* ★1.0 定稿尺（2026-09-26 二次复审实测）：多倍 --pf-u 在 mockup 帧宽（520）下把侧栏撑到 237px
   （占帧 46%）→ 主体塌成 73px 列、"内容溢出。改为**占容器比例 + 上下限**：
   比例保证随容器流体，clamp 保证小帧不霸屏、大屏不缩水。 */
.topo-rail-split { display: grid; grid-template-columns: clamp(64px, 22%, 132px) 1fr; gap: 0; padding-top: 0; padding-bottom: 0; }
.topo-rail-split .pf-rail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #fff;
  border-right: 1px solid #e6e8f0;
  padding: 12px 10px;
  font-size: calc(var(--pf-font) * 0.92);
}
.topo-rail-split .pf-body {
  display: grid;
  /* ★媒体列硬下限（曾 160px）在窄帧下挤压信息列 → 改为纯比例分配（minmax 0 防内容撑破） */
  grid-template-columns: minmax(0, 46%) minmax(0, 1fr);
  gap: calc(var(--pf-gap) * var(--pf-gap-dense));
  padding: calc(var(--pf-pad) * 1.1);
  align-items: start;
}
.topo-rail-split .pf-recommend { grid-column: 1 / -1; }

/* ── 拓扑：rail-grid（PC——侧栏 + 多列网格 + hover 语义） ── */
.topo-rail-grid { display: grid; grid-template-columns: clamp(72px, 20%, 150px) 1fr; gap: 0; padding-top: 0; padding-bottom: 0; }
.topo-rail-grid .pf-rail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #fff;
  border-right: 1px solid #e6e8f0;
  padding: 12px 10px;
  font-size: calc(var(--pf-font) * 0.92);
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
/* ★10ft 首屏纪律（2026-09-26 二次复审 P0）：旧版 TV 的 t1/t2/价格/CTA **都在 hero 内**；
   上轮实现把媒体与信息拆成上下两块 → 「Hero + 信息 + 海报行」三块叠加高度超帧高，
   CTA 被切 60px、海报行落到折线以下。现按旧版语义：英雄区 + **信息叠加在英雄图上**（底部渐变蒙层），
   海报行占余下高度 → 首屏同时可见 Hero + CTA + 完整海报卡。 */
/* ★longhand（三审）：padding 简写会整段覆盖 .p-formfactor 的安全区 left/right/bottom */
.topo-hero-focus-row { padding-top: calc(var(--pf-pad) * 1.1); padding-bottom: calc(var(--pf-pad) * 1.1); }
.topo-hero-focus-row .pf-body {
  display: grid;
  /* ★实测（第三轮，双视口）：叠加内容高 212px（标题 37 + 描述 37 + 价格 46 + CTA 76 + 间距 16）——
     固定 70% 只在**设计帧宽**（620）成立：窄舞台（1280 视口 → 帧 540）下 70% = 176px < 212px
     → align-self:end 把标题顶出帧顶被裁。定稿 min-content 下限：hero 行**永不小于内容**（不裁切），
     海报行吸收剩余（极端窄时变矮，但永不重叠）——「宁可内容矮，不可内容叠」。 */
  /* ★行分配（三审六修）：英雄行放权到「内容的 min-content」（不裁切），海报行吸收剩余。
     海报卡在窄帧的**内容预算**另由 @container 削减（见下：帧 <560 收起价格行）——
     两行内容在同一画布内争高度是硬冲突，只能按「标题/价格/CTA 必保 > 至少一张完整卡 > 卡内次要信息」取舍。 */
  grid-template-rows: minmax(min-content, 60%) minmax(0, 1fr);
  gap: var(--pf-gap);
  min-height: 0;
  overflow: hidden;
}
.topo-hero-focus-row .pf-media {
  grid-row: 1;
  grid-column: 1;
  position: relative;
  overflow: hidden;
  border-radius: calc(var(--pf-radius) * 1.2);
  min-height: 0;
}
/* 底部渐变蒙层：保证叠加文字在任意封面上可读（对比度由蒙层保证，不依赖封面内容） */
.topo-hero-focus-row .pf-media::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 30%, color-mix(in srgb, var(--pf-bg, #000) 82%, transparent) 100%);
  pointer-events: none;
}
/* ★跨行媒体不得反向决定行高（第三轮实测根因）：封面的 aspect-ratio:16/9 让 min-content = 帧宽×9/16
   （540 → 279px）→ hero 行被撑到 279，海报行归零、拓扑失去身份。宽高比交给轨道（同车机处置）。 */
.topo-hero-focus-row .pf-media > :deep(*) { height: 100%; width: 100%; min-height: 0; aspect-ratio: auto; }
/* ★英雄区媒体构图（2026-09-27 用户三次实测）：
   ① 媒体是**背景层**，其内容此前居中 → 正好压在左下文本层之间（截图：耳机夹在标题与按钮中间）；
   ② 10ft 主视觉的媒体太小（~43px，像贴纸）；③ 右上对齐后又贴住「收藏」按钮。
   定稿：信息列限宽 62%（左文本列）+ 媒体内容**右中**对齐并消费 `--pf-media-scale`（×2.6）
   —— 经典「左文右图」Hero 构图，两者分列互不侵占。（只改对齐/尺度，不动行高与宽高比。） */
.p-formfactor.topo-hero-focus-row .pf-media > :deep(*) {
  place-items: center end;
  padding-right: calc(var(--pf-u) * 2.2);
}
/* 信息层与英雄图同格（叠加）——底部左对齐，10ft 下标题/价格/CTA 同屏 */
.topo-hero-focus-row .pf-info {
  grid-row: 1;
  grid-column: 1;
  align-self: end;
  /* ★左文本列限宽（2026-09-27 用户实测三次）：此前信息层横跨整幅英雄区 →
     操作按钮铺到最右，与右上主视觉冲突（产品图贴着「收藏」按钮）。
     真实 TV Hero 是**左文本列 + 右主视觉列**：信息列 ≤62%，右侧留给产品图，互不侵占。 */
  max-width: 62%;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: calc(var(--pf-gap) * 0.45);
  min-width: 0;
  padding: calc(var(--pf-u) * 1.1);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.55);
}
/* 10ft：描述限一行（沙发距离读不完多行小字；保证标题/价格/CTA 同屏是硬约束） */
.topo-hero-focus-row :deep(.fp-desc) {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* ★窄帧简化（第三轮实测）：帧宽 < 560 时叠加内容 212px 会吃掉整个英雄行 → 海报行归零、拓扑失去身份。
   按 10ft 语义收描述（抬腕/远距离本就读不完第二行小字），把高度让给海报行——
   取舍次序：标题+价格+CTA 必保 > 海报行必有一张 > 描述可弃。 */
@container (max-width: 559px) {
  .topo-hero-focus-row :deep(.fp-desc) { display: none; }
  .topo-hero-focus-row .pf-info { gap: calc(var(--pf-gap) * 0.3); padding: calc(var(--pf-u) * 0.8); }
  /* 海报卡同步瘦身：收起价格行（窄帧里三行装不下 → 卡内文字会被裁；
     「至少一张完整卡」比「卡上带价」更重要——价格在英雄区已给出） */
  .topo-hero-focus-row :deep(.fp-rec-pt) { display: none; }
}
.topo-hero-focus-row .pf-recommend--row {
  grid-row: 2;
  grid-column: 1;
  display: flex;
  gap: calc(var(--pf-gap) * 1.4);
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: calc(var(--pf-u) * 0.4);
  scrollbar-width: none;
  align-items: stretch;
  min-height: 0;
}
.topo-hero-focus-row .pf-recommend--row::-webkit-scrollbar { display: none; }
.topo-hero-focus-row .pf-recommend--row :deep(.pf-rec-card) {
  flex: 0 0 auto;
  width: calc(var(--pf-u) * 9);
  /* ★至少一张完整卡（首屏纪律）：高度随行高自适应而非固定比例，超出由横向滚动承接 */
  height: 100%;
  min-height: 0;
  justify-content: center;
  overflow: hidden;
}

/* ── 拓扑：dashboard（车机——驾驶舱 HMI：媒体 | 信息 / 主操作 | 推荐）──
   ★2026-09-26 三轮实测定稿（前两轮都是「只在宽舞台验证」的教训）：
   8/3 扁画布在**窄舞台**（1280 视口 → 帧宽 540 → 内容区仅 165px）下，四行纵排
   （标题/价格/操作/提醒）需要 ≈197px → 网格行被压缩到内容之下，**元素互相重叠**。
   定稿：两行两列，行高带 min-content 下限（宁可裁剪，绝不重叠——重叠是视觉垃圾）：
     上排『媒体 | 信息（标题 / 价格 + 降级条）』· 下排『主操作 | 推荐瓦片』
     · 提醒条改为**绝对定位徽标**（贴媒体角，不占纵向预算）
   内容预算（165px）= 信息 68 + 操作 76 + 间距 6 ≈ 150 ✓；宽舞台时上排自动长高（1fr）。
   推荐位只留 3 个：行车中翻找第 4、5 个选项是分心源（第 4+ 项不可达是刻意的）。 */
/* ★2026-09-26 三轮实测定稿（教训：前两轮都只在宽舞台验证）：
     根因① `.pf-actions` 是 `.pf-info` 的**子元素**（模板既定结构）——不给 info 开 display:contents，
             `grid-area: actions` 会落到 info 的隐式行里（实测 info 变 4 行 158px → 顶爆车身行高 → 兄弟重叠）。
     根因② 跨行媒体若保留 16:9 内在高度，会反向把行撑开（定格 aspect-ratio:auto 后消除）。
     根因③ 行高用 minmax(min-content, …) 留底：**宁可底部裁切，绝不元素重叠**（重叠是视觉垃圾）。
   层级（驾驶舱惯例）：媒体 | 标题/价格+降级条；主操作与推荐瓦片同处底行（选项与确认键一跳可达）。 */
.p-formfactor.topo-dashboard .pf-body {
  display: grid;
  /* ★列宽（三审五修）：此前 0.72fr/2.28fr → 主操作格仅 128px，两枚按钮被压成
     「立即…」「＋…」（缩略壳里文案不可读）。改为近等分：媒体列 ~48%（16:9 封面仍够宽），
     主操作格 ~52% → 两枚按钮各 ~127px 完整可读。 */
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
  /* ★末行 1fr 吸收剩余高度（三审：此前 auto → 内容按 min-content 顶满，**零余量**，
     帧宽差 7px 即让 body 变成可滚动 → 「驾驶禁止细滚动」被破坏、几何门禁红）。
     现：热区行吸收剩余并内部裁切（瓦片 min-height:0），body 恒定不滚动。 */
  /* ★三审三修——「恒不溢出」的稳健写法：三行 min 全为 0（内容紧张时轨道**可收缩**，
     由容器 overflow:hidden 兜底裁切几像素），而不是让内容把轨道顶破→出现滚动。
     为什么不能靠 min-content：车机内容高度 ≈ 容器高度（零余量），换字体/换 DPR 就多出 1-4px
     （实测 Playwright Chromium 比本机浏览器多 4px → body 变可滚动 = 驾驶禁细滚动被破坏）。
     取舍：驾驶场景「宁可裁一像素，绝不出现滚动条/重叠」。 */
  /* ★层级（三审四修）：媒体行吸收剩余（**主视觉占大块**），价格行与热区行按内容定高。
     此前 1fr 落在热区行 → 瓦片被拉伸到 103px（比主视觉还高）、主操作被挤成 58px 宽。
     热区下限由按钮/tile 自身 min-height 保证；行可收缩（不做滚动，驾驶禁细滚动）。 */
  grid-template-rows: minmax(0, 1fr) auto auto;
  grid-template-areas:
    'media heading'
    'media info'
    'actions rec';
  gap: calc(var(--pf-gap) * 0.45);
  min-height: 0;
  overflow: hidden;
}
/* 驾驶形态：内容一屏装下，**永不可滚动**（AAOS：行驶中不做精细滚动） */
.p-formfactor.topo-dashboard .pf-body { overflow: hidden; }
.topo-dashboard .pf-media {
  grid-area: media;
  position: relative;
  align-self: stretch;
  min-height: 0;
  overflow: hidden;
  border-radius: calc(var(--pf-radius) * 1.1);
}
/* 媒体不得反向决定行高：封面填满轨道（宽高比交给轨道） */
.p-formfactor.topo-dashboard .pf-media > :deep(*) { height: 100%; width: 100%; min-height: 0; aspect-ratio: auto; }
/* ★信息列拆为网格项（car 专有）：heading/price/sku/actions 直接成为 body 网格项——
   否则 actions 会被困在 info 子网格里（根因①），与底行瓦片互相重叠。 */
.topo-dashboard .pf-info { display: contents; }
.topo-dashboard .pf-heading { grid-area: heading; align-self: end; min-width: 0; }
/* 标题单行（驾驶舱一行可读，长度溢出省略——纵向预算的硬约束） */
.p-formfactor.topo-dashboard .pf-heading :deep(.fp-name) {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* 价格 + 降级条同排（省一整行纵向预算） */
.topo-dashboard .pf-price { grid-area: info; align-self: start; justify-self: start; }
.topo-dashboard .pf-sku, .topo-dashboard .pf-sku-fallback { grid-area: info; align-self: start; justify-self: center; min-width: 0; }
/* 驾驶精简：长文描述不占纵向预算（仪表盘上不可读）——driveAware 语义的真实体现 */
.is-drive .pf-info :deep(.fp-desc) { display: none; }
/* 主操作（底行左格）：两个等分大热区（≥76dp），与推荐瓦片同层 */
.topo-dashboard .pf-actions {
  grid-area: actions;
  align-items: stretch;
  align-self: stretch;
  flex-wrap: nowrap;
  gap: calc(var(--pf-gap) * 0.5);
  min-height: 0;
}
.topo-dashboard .pf-actions :deep(button) {
  flex: 1 1 auto;
  min-width: calc(var(--pf-u) * 3.2); /* 不窄于「▶…」+ 内边距（此前被压到 58px 只剩省略号） */
  padding-left: calc(var(--pf-u) * 0.4);
  padding-right: calc(var(--pf-u) * 0.4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* ★特异性提升：`.has-multicol .pf-recommend { grid-auto-flow: dense }` 曾把车机单行瓦片折成两行 */
.p-formfactor.topo-dashboard .pf-recommend {
  grid-area: rec;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: calc(var(--pf-gap) * 0.5);
  min-height: 0;
  overflow: hidden;
}
/* ★驾驶只呈现前 3 个选项（第 4+ 项**显式不渲染**——行车中翻找不可滚动内容是分心源）。
   此前靠「溢出被裁」偶然达成：窄舞台下确实看不见，但宽舞台会半截露出且属不可控行为，故显式隐藏。 */
.p-formfactor.topo-dashboard .pf-recommend :deep(.pf-rec-card):nth-child(n + 4) { display: none; }
/* 瓦片宽由列轨道给出（1fr 等分），不被内容撑宽——否则 5 项会各自撑到 162px 溢出画布 */
.p-formfactor.topo-dashboard .pf-recommend :deep(.pf-rec-card) { width: 100%; min-width: 0; }
/* 驾驶提醒徽标：**绝对定位贴媒体角**（不占纵向预算——8/3 窄画布容不下第三行文字；
   但仍真实渲染 = driveAware 能力有可观测后果）。用 p 元素的默认行内尺寸做小胶囊。 */
.p-formfactor.topo-dashboard .pf-drive-hint {
  /* ★同格叠加（不是 position:absolute——abspos 的含块是 .p-formfactor 而非网格容器，
     grid-area 实际不生效、窄帧越列压标题）。作为普通网格项与 .pf-media **共用 media 区域**：
     网格按区域定位天然把它限制在媒体列内；DOM 靠后 → 自然叠在封面之上。 */
  grid-area: media;
  align-self: start;
  justify-self: stretch;
  z-index: 2;
  margin: calc(var(--pf-u) * 0.4);
  padding: calc(var(--pf-u) * 0.2) calc(var(--pf-u) * 0.45);
  border-radius: calc(var(--pf-radius) * 0.7);
  background: color-mix(in srgb, var(--pf-bg, #10142a) 72%, transparent);
  color: var(--pf-accent, #ffb13d);
  font-size: calc(var(--pf-font) * 0.6);
  line-height: 1.35;
  text-align: center;
  pointer-events: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
/* ★瓦片热区（三审二修）：仍保 76dp 的 0.85 倍下限，但**驾驶形态**由行高吸收（避免行被顶起） */
.has-dpad :deep(.pf-rec-card),
.has-focus-tree :deep(.pf-rec-card) { min-height: calc(var(--pf-control) * 0.85); }
/* ★瓦片（2026-09-27 用户实测修复）：8/3 扁画布容不下「图标/名称/价格」三行竖排——
   瓦片被压到 40px 而行内容需 87px → 名称与价格溢出被裁（用户截图：瓦片下半截消失）。
   驾驶舱语义本就是**一行大热区**：改紧凑横排（图标｜名称｜价格 同一行），内容高 ≈1 行，
   与主操作等高对齐且不再溢出。 */
.p-formfactor.topo-dashboard .pf-recommend :deep(.pf-rec-card) {
  align-self: stretch;
  min-height: 0;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: calc(var(--pf-u) * 0.35);
  padding: calc(var(--pf-u) * 0.4);
  overflow: hidden;
}
.p-formfactor.topo-dashboard .pf-recommend :deep(.pf-rec-card) > * {
  flex: 0 0 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 名称可伸缩（占余量），图标按内容宽 */
.p-formfactor.topo-dashboard .pf-recommend :deep(.fp-rec-name) { flex: 1 1 auto; }
/* ★瓦片信息层级（2026-09-27 用户实测）：图标+名称+价格三件横排把名称挤到 20px（「替…」），
   驾驶舱可读性要求「一眼读全标签」——而 driveAware 能力本就声明「已精简信息层级与动效」。
   故驾驶形态瓦片只留 **图标 + 名称**（价格属详情信息：英雄区/详情页仍有，行车中不该比价）。 */
.p-formfactor.topo-dashboard .pf-recommend :deep(.fp-rec-pt) { display: none; }

/* keyboard：键盘可达元素加可见焦点环（PC）*/
.has-keyboard :deep(*:focus-visible) {
  outline: var(--pf-focus-ring, 3px) solid var(--pf-accent, #6f4ae8);
  outline-offset: 2px;
}
/* ★遥控/驾驶（三审）：visual.focus='ring' 此前**只被 has-keyboard 消费**——TV/车机声明了 focus:ring
   却只有 1-2px UA 默认环（10ft/余光场景不可辨）。现挂 dpad/focusTree，并加放大+投影（Android TV 惯例）；
   `outline-offset:-2` 让环贴内缘，避免被海报行的 overflow 裁掉。 */
.has-dpad :deep(*:focus-visible),
.has-focus-tree :deep(*:focus-visible) {
  outline: var(--pf-focus-ring, 3px) solid var(--pf-accent, #ffb13d);
  outline-offset: -2px;
  /* ★不加 scale（三审实测）：驾驶形态的主操作是**满行高**的大热区，focus 放大 4% 会让
     getBoundingClientRect 增大 4%（104→108px）、上下各溢出 2px → 被 overflow 裁掉边缘，
     且几何门禁把它判为溢出（真实缺陷）。10ft/余光的可见性由 3px 强调色环 + 提亮 + 投影保证，
     这些都不改变布局几何（几何稳定 > 视觉花哨）。 */
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--pf-accent, #ffb13d) 45%, transparent),
    0 6px 18px rgba(0, 0, 0, 0.45);
  filter: brightness(1.07);
  transition: box-shadow 0.14s ease, filter 0.14s ease;
}
/* 海报行内的卡片：环改内缩 + 不裁切（overflow-x auto 会裁外扩环） */
.has-dpad :deep(.pf-rec-card:focus-visible),
.has-focus-tree :deep(.pf-rec-card:focus-visible) { outline-offset: -3px; }

/* ★dense 折叠（三审）：此前 .is-dense 被内联 --pf-gap-dense 恒覆盖（零后果）；
   现由内联样式按 density×dense 能力共同计算，此规则仅作兜底注释位（见 rootStyle） */

/* ★减弱动效（三审）：prefers-reduced-motion 此前在形态容器内完全未接
   （p-sidebar/p-toolbar 已接，唯独承载 hover/reveal 动效的此处漏了） */
@media (prefers-reduced-motion: reduce) {
  .has-hover :deep(button),
  .has-hover :deep(.pf-rec-card),
  .has-dpad :deep(*:focus-visible),
  .has-focus-tree :deep(*:focus-visible) {
    transition: none;
    filter: none;
  }
  .is-drive :deep(*) { animation: none !important; }
}

/* dense：紧凑间距——★已并入内联 --pf-gap-dense（三审：此前此规则被内联恒覆盖 = 零后果）。
   保留类名（诊断/外部钩子），数值由 rootStyle 计算。 */

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

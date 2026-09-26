<!-- packages/components/p-formfactor/index.vue —— ★★柔性形态容器（Fluid System v2 落地形态）
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
    :style="rootStyle"
  >
    <!-- 侧栏（能力声明 sidebar：未声明的形态自动不渲染——手机/手表/车机/TV） -->
    <aside v-if="caps.sidebar && $slots.rail" class="pf-rail">
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
        <!-- ★能力过滤：形态未声明 skuMulti（车机驾驶分心风险）→ 多规格槽自动不渲染 -->
        <div v-if="caps.skuMulti && $slots.sku" class="pf-sku">
          <slot name="sku" />
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
    <nav v-if="caps.tabs && $slots.tabbar" class="pf-tabbar">
      <slot name="tabbar" />
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { FORM_PROFILES, resolveFluidMetrics, resolveFrameVars } from '@proteus-vue/fluid'
import type { DeviceForm } from '@proteus-vue/fluid'

const props = defineProps({
  /** 宿主声明形态（权威）——watch/car/tv 必须声明；缺省 → 按注入/测量尺寸推断 */
  declared: { type: String as () => DeviceForm | null, default: null },
  /** 容器尺寸注入（宿主/测试；缺省用容器自身测量） */
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
})

/** 容器实测宽（★流体度量的输入——所有尺寸由它驱动；无缩放变换、无裁剪） */
const measured = ref(props.width > 0 ? props.width : 0)
const rootEl = ref<HTMLElement | null>(null)
let ro: ResizeObserver | null = null

onMounted(() => {
  // 宿主未注入 → 用容器自身测量（Web ResizeObserver；MP 无 → 保持注入值/护栏中位）
  if (props.width > 0) return
  const g = globalThis as { ResizeObserver?: typeof ResizeObserver }
  const el = (rootEl.value as unknown as { $el?: HTMLElement })?.$el ?? (rootEl.value as unknown as HTMLElement)
  if (!el || typeof g.ResizeObserver !== 'function') return
  ro = new g.ResizeObserver((entries) => {
    const w = entries[0]?.contentRect?.width ?? 0
    if (w > 0 && Math.abs(w - measured.value) > 2) measured.value = w
  })
  ro.observe(el)
})
onUnmounted(() => {
  ro?.disconnect()
  ro = null
})

const form = computed(() => (props.declared as DeviceForm | null) ?? senseFormFast())
const profile = computed(() => FORM_PROFILES[form.value])
const caps = computed(() => profile.value.caps)

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
const rootClass = computed(() => {
  const p = profile.value
  return `topo-${p.topology} form-${form.value} input-${p.input}` + (p.caps.driveAware ? ' is-drive' : '')
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

defineExpose({ form, profile, caps })
</script>

<style scoped>
.p-formfactor {
  display: block;
  /* ★视觉语言由形态画像注入（浅色 / TV·车机暗色沉浸） */
  background: var(--pf-bg, #f7f8fa);
  color: var(--pf-text, #17171f);
  font-size: var(--pf-font);
  height: 100%;
  overflow: hidden;
  padding: calc(var(--pf-pad) * 1.1);
  box-sizing: border-box;
}
.pf-body { display: block; height: 100%; }
.pf-rail { display: none; }
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
.topo-duo .pf-body { display: grid; grid-template-columns: minmax(150px, 42%) 1fr; gap: calc(var(--pf-gap) * var(--pf-gap-dense)); align-items: start; }
.topo-duo .pf-info { display: flex; flex-direction: column; gap: calc(var(--pf-gap) * var(--pf-gap-dense)); }
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

/* ── 拓扑：hero-focus-row（TV——10ft 沉浸：大 Hero + 横滑海报胶囊 + 焦点环） ── */
.topo-hero-focus-row { padding: calc(var(--pf-pad) * 1.1); }
.topo-hero-focus-row .pf-media { aspect-ratio: 16 / 7; }
.topo-hero-focus-row .pf-info > :deep(strong:first-child) { font-size: calc(20px * 1) !important; }
.topo-hero-focus-row .pf-body { display: flex; flex-direction: column; gap: calc(var(--pf-gap) * var(--pf-gap-dense)); overflow: hidden; }
.topo-hero-focus-row .pf-media { flex: 0 0 auto; }
.topo-hero-focus-row .pf-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: calc(calc(var(--pf-gap) * var(--pf-gap-dense)) * 0.7); justify-content: center; }
.topo-hero-focus-row .pf-recommend--row { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 6px; }
.topo-hero-focus-row .pf-recommend--row :deep(.pf-rec-card) {
  flex: 0 0 auto;
  width: calc(150px * 1);
  aspect-ratio: 16 / 9;
  justify-content: center;
  backdrop-filter: blur(6px);
}
/* 车机：大热区瓦片（3 列等宽，驾驶员余光可辨；焦点环粗） */
.topo-dashboard .pf-recommend :deep(.pf-rec-card) {
  min-height: calc(92px * 1);
  justify-content: center;
}
/* 宽容器：Hero 与信息并排（大屏横置——电视/车机常态） */
@media (min-width: 760px) {
  .topo-hero-focus-row .pf-body {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    grid-template-rows: auto 1fr;
    grid-template-areas: 'media info' 'rec rec';
  }
  .topo-hero-focus-row .pf-media { grid-area: media; }
  .topo-hero-focus-row .pf-info { grid-area: info; }
  .topo-hero-focus-row .pf-recommend { grid-area: rec; }
}
/* ── 拓扑：dashboard（车机——单层大热区卡片，驾驶降干扰：信息层级扁平、热区大） ── */
.topo-dashboard .pf-body {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  grid-template-rows: auto auto;
  grid-template-areas: 'media info' 'rec rec';
  gap: calc(calc(var(--pf-gap) * var(--pf-gap-dense)) * 1.2);
  align-content: start;
}
.topo-dashboard .pf-media { grid-area: media; }
.topo-dashboard .pf-info { grid-area: info; display: flex; flex-direction: column; gap: calc(calc(var(--pf-gap) * var(--pf-gap-dense)) * 0.8); justify-content: center; }
.topo-dashboard .pf-recommend { grid-area: rec; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
/* 驾驶提醒条（车机专有语义：driveAware 形态显示，非车机不渲染） */
.is-drive .pf-info::after {
  content: '⚠ 驾驶中：已精简信息层级与动效';
  display: block;
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: calc(var(--pf-radius) * 0.8);
  background: rgba(255, 180, 84, 0.16);
  color: #a06a1f;
  font-size: calc(10.5px * 1);
}

/* ★焦点可见（遥控/键盘形态）：首个操作元素带焦点环（真实焦点转移由宿主 d-pad / Tab 驱动） */
.input-remote .pf-actions :deep(> :first-child),
.form-pc .pf-actions :deep(> :first-child) {
  box-shadow: 0 0 0 var(--pf-focus-ring, 0px) var(--pf-brand, #7c5cff);
  outline: none;
}
/* 暗色主题（TV/车机）：卡片与文字用形态视觉语言变量 */
.form-tv :deep(.pf-rec-card),
.form-car :deep(.pf-rec-card) {
  background: var(--pf-surface, rgba(255, 255, 255, 0.12));
  border-color: rgba(255, 255, 255, 0.14);
  color: var(--pf-text, #fff);
}
.form-tv :deep(.pf-rec-name),
.form-car :deep(.pf-rec-name),
.form-tv :deep(.pf-rec-pt),
.form-car :deep(.pf-rec-pt) { color: var(--pf-dim, #bcd0e8); }
.form-tv :deep(.pf-rec-pt),
.form-car :deep(.pf-rec-pt) { color: var(--pf-accent, #ffb13d); font-weight: 800; }
</style>

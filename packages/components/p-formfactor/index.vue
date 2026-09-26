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
import { computed } from 'vue'
import { FORM_PROFILES } from '@proteus-vue/fluid'
import type { DeviceForm } from '@proteus-vue/fluid'

const props = defineProps({
  /** 宿主声明形态（权威）——watch/car/tv 必须声明；缺省 → 环境探测（Web 可推断 phone/fold/tablet/pc） */
  declared: { type: String as () => DeviceForm | null, default: null },
  /** 容器尺寸注入（宿主/测试；缺省读 window） */
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
})

// ★MP 编译兼容（G-29 约束）：形态主源 = declared 宿主声明（形态画像权威源——watch/car/tv 必须声明）；
//   Web 端响应式探测由宿主/页面注入 width 或 declared 变化驱动（组件内零 window/零顶层副作用）
const form = computed(() => (props.declared as DeviceForm | null) ?? senseFormFast())
const profile = computed(() => FORM_PROFILES[form.value])
const caps = computed(() => profile.value.caps)
/** MP 兼容：:class 数组项不用模板字面量（编译器 MVP 不支持）——聚合成单一字符串 */
const rootClass = computed(() => {
  const p = profile.value
  return `topo-${p.topology} form-${form.value} input-${p.input}` + (p.caps.driveAware ? ' is-drive' : '')
})

/** 无声明时的兜底探测（SSR/MP 安全——只读注入的尺寸，不碰 window） */
function senseFormFast(): DeviceForm {
  if (props.width > 0) {
    if (props.width < 600) return 'phone'
    if (props.width < 900) return 'fold'
    return 'tablet'
  }
  return 'phone'
}

/** 形态驱动的视觉变量（★Web 用对象、MP 端由编译器转字符串——与 p-zone 同口径） */
const rootStyle = computed(() => {
  const p = profile.value
  const gap = p.density === 'compact' ? '8px' : p.density === 'comfortable' ? '18px' : '12px'
  return {
    '--pf-scale': String(p.scale),
    '--pf-gap': gap,
    '--pf-pad': p.input === 'remote' ? '20px' : '14px',
  }
})

// 诊断出口（宿主/演示页可读；MP 端仅可访问方法——已按编译约束收窄）
defineExpose({ form, profile, caps })
</script>

<style scoped>
.p-formfactor {
  display: block;
  background: #f7f8fa;
  color: #17171f;
  font-size: calc(13px * var(--pf-scale, 1));
  height: 100%;
  overflow: hidden;
  padding: var(--pf-pad, 14px);
  box-sizing: border-box;
}
.pf-body { display: block; height: 100%; }
.pf-rail { display: none; }
/* 推荐区默认：自适应网格（形态拓扑可覆盖——焦点行形态转横排海报流） */
.pf-recommend { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 10px; }

/* 输入语义：遥控/旋钮形态热区放大（命中区 ≥ 48px——d-pad / 旋钮可达性） */
.input-remote :deep(button) {
  min-height: 48px;
  padding-left: 22px;
  padding-right: 22px;
  font-size: calc(15px * var(--pf-scale, 1));
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
  gap: var(--pf-gap);
  text-align: center;
}

/* ── 拓扑：stack（手机——单列纵向 + 底部 Tab） ── */
.topo-stack .pf-body { display: flex; flex-direction: column; gap: var(--pf-gap); overflow-y: auto; }
.pf-tabbar {
  display: flex;
  margin-top: auto;
  border-top: 1px solid #e6e8f0;
  padding: 8px 0 10px;
  background: inherit;
}
.pf-tabbar :deep(*) { flex: 1; text-align: center; font-size: calc(11px * var(--pf-scale, 1)); color: #999; }

/* ── 拓扑：duo（折叠屏——主图 + 详情双列） ── */
.topo-duo .pf-body { display: grid; grid-template-columns: minmax(150px, 42%) 1fr; gap: var(--pf-gap); align-items: start; }
.topo-duo .pf-info { display: flex; flex-direction: column; gap: var(--pf-gap); }
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
  font-size: calc(12px * var(--pf-scale, 1));
}
.topo-rail-split .pf-body {
  display: grid;
  grid-template-columns: minmax(160px, 46%) 1fr;
  gap: var(--pf-gap);
  padding: var(--pf-pad, 14px);
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
  font-size: calc(12px * var(--pf-scale, 1));
}
.topo-rail-grid .pf-body {
  display: grid;
  grid-template-columns: minmax(180px, 34%) 1fr;
  grid-template-areas: 'media info' 'rec rec';
  gap: var(--pf-gap);
  padding: var(--pf-pad, 14px);
  align-items: start;
}
.topo-rail-grid .pf-media { grid-area: media; }
.topo-rail-grid .pf-info { grid-area: info; display: flex; flex-direction: column; gap: var(--pf-gap); }
.topo-rail-grid .pf-recommend { grid-area: rec; }
/* hover 语义：仅声明 hover 的形态（pc）启用抬升反馈——触控/遥控形态零 hover 副作用 */
.form-pc .pf-recommend :deep(.pf-rec-card) { transition: box-shadow 0.16s ease, transform 0.16s ease; }
.form-pc .pf-recommend :deep(.pf-rec-card:hover) { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08); }

/* ── 拓扑：hero-focus-row（TV / 车机——大 Hero + 焦点海报行） ── */
.topo-hero-focus-row .pf-body { display: flex; flex-direction: column; gap: var(--pf-gap); overflow: hidden; }
.topo-hero-focus-row .pf-media { flex: 0 0 auto; }
.topo-hero-focus-row .pf-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: calc(var(--pf-gap) * 0.7); justify-content: center; }
.topo-hero-focus-row .pf-recommend--row { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 6px; }
.topo-hero-focus-row .pf-recommend--row :deep(.pf-rec-card) { flex: 0 0 116px; }
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
  gap: calc(var(--pf-gap) * 1.2);
  align-content: start;
}
.topo-dashboard .pf-media { grid-area: media; }
.topo-dashboard .pf-info { grid-area: info; display: flex; flex-direction: column; gap: calc(var(--pf-gap) * 0.8); justify-content: center; }
.topo-dashboard .pf-recommend { grid-area: rec; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
/* 驾驶提醒条（车机专有语义：driveAware 形态显示，非车机不渲染） */
.is-drive .pf-info::after {
  content: '⚠ 驾驶中：已精简信息层级与动效';
  display: block;
  margin-top: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(255, 180, 84, 0.16);
  color: #a06a1f;
  font-size: calc(10.5px * var(--pf-scale, 1));
}

/* 焦点态：遥控形态首个操作元素高亮（焦点树视觉基线——真实焦点转移由宿主 d-pad 驱动） */
.input-remote .pf-actions :deep(> :first-child) { box-shadow: 0 0 0 3px rgba(124, 92, 255, 0.3); }
</style>

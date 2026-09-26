<script setup lang="ts">
// website/src/pages/MultiDevice.vue —— 多端同屏（★2026-09-26 按柔性系统方向重建）
//
// ★故事（对齐设计本意）：一套代码打通**差异化的多端平台** —— 大屏 / 车机 / 手表差异极大，
//   渲染出的形态完全不同、能力声明也完全不同。这就是**柔性系统**要演示的东西。
//
// ★零伪造：左栏展示的就是本页正在执行的**同一份源码**（?raw 直读 fluid-product/index.vue），
//   中栏七端全部在页面上**真渲染**——
//     · 设备框是**真实 mockup**（比例/圆角/刘海/状态栏/折痕由画像 frame 驱动，居中完整呈现）；
//       内容度量宽 = 帧显示宽（≤ 画像上限宽与舞台可用宽），无 transform: scale、无裁剪；
//     · 形态画像（FORM_PROFILES）驱动拓扑/导航/能力/视觉语言/流体度量——同一份内容槽换形态即换形态，
//       与响应式布局的分水岭：不是按尺寸缩放同一套布局，而是按形态换布局、换导航、换能力集；
//     · 能力声明（tabs/rail/focusRows）真实驱动降级分支（v-if）——车机声明无 SKU 多选、
//       手表声明无底部 Tab，源码里能看到分支，页面上能看到差异。
//
// ★诚实边界：端能力表（TARGETS.caps）在本页按端注入——真实项目里它来自端 profile
//   （与组件文档「双端兼容进度表」同源协议：supported / fallback / unsupported 三态）。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { locale } from '../i18n'
import FluidProduct from '../components/fluid-product/index.vue'
// ★★Fluid System v2：形态画像 SSOT（本页所有形态信息都从这里读——页面不重复定义能力/拓扑）
import { FORM_PROFILES, FORM_CAP_KEYS, capsLabel } from '@proteus-vue/fluid'
import type { DeviceForm, FormProfile } from '@proteus-vue/fluid'
// ★SSOT：左栏源码 = 正在执行的这份文件（vite ?raw——零双源，不存在「展示的源码 ≠ 跑的源码」）
import fluidSource from '../components/fluid-product/index.vue?raw'

const isEn = computed(() => locale.value === 'en')
const showSource = ref(true)

/** ★端清单 = FORM_PROFILES 的形态 SSOT（布局/导航/能力/缩放全部从画像读，页面不重复定义） */
interface Target {
  key: DeviceForm
  ic: string
  profile: FormProfile
}
const ICONS: Record<DeviceForm, string> = {
  watch: '⌚', phone: '📱', fold: '📖', tablet: '📐', pc: '💻', car: '🚗', tv: '📺',
}
const TARGETS: Target[] = (Object.keys(FORM_PROFILES) as DeviceForm[]).map((k) => ({
  key: k,
  ic: ICONS[k],
  profile: FORM_PROFILES[k],
}))

/**
 * ★展示模型（解决「真实设备宽度差 10 倍 → 等比缩放后大屏内容看不清」）：
 *   渲染视口 = 真实设备尺寸（p-formfactor 据此判定形态，形态语义真实）
 *   展示切片 cropW = 只截取该端**代表性区域**（如 PC 取「侧栏+主区」、TV 取「Hero+信息区」），
 *   使每端缩放在 0.4~0.85 之间 → 内容可读、形态差异可辨（业界设计稿展示的通行手法）。
 */
/** 窄→宽排序（切换器稳定顺序） */
const ordered = computed(() => [...TARGETS].sort((a, b) => a.profile.viewport.width - b.profile.viewport.width))

/** 内容层度量输入宽（★与帧显示宽同一口径——展示缩放系数已移除，不再污染流体解算） */
const contentWidth = computed(() => frameWidth.value)
/** ★帧高（真实视口高——内容层据此判定首屏/安全区；此前页面把宽当高传，height 是死参数） */
const frameHeight = computed(() => {
  const po = activePosture.value
  if (po && target.value.key === 'fold') return po.viewport.height
  return target.value.profile.viewport.height
})

/** 舞台可用宽（帧宽的约束来源——ResizeObserver 实测） */
const stageWidth = ref(640)
const stageEl = ref<HTMLElement | null>(null)
let stageRo: ResizeObserver | null = null
onMounted(() => {
  const g = globalThis as { ResizeObserver?: typeof ResizeObserver }
  if (typeof g.ResizeObserver !== 'function' || !stageEl.value) return
  stageRo = new g.ResizeObserver((entries) => {
    const w = entries[0]?.contentRect?.width ?? 0
    if (w > 0) stageWidth.value = w
  })
  stageRo.observe(stageEl.value)
})
onUnmounted(() => {
  stageRo?.disconnect()
  stageRo = null
})

/** ★帧宽（展示宽）= min(画像上限宽, 舞台可用宽, 姿态视口宽)——真实 mockup 的尺寸约束。
 *  ★2026-09-26 二次复审 P1：此前折叠态乘 0.62「展示缩放系数」→ 该系数泄漏进流体解算
 *  （折叠态度量宽仅 211px → k 被 clamp 到 min 0.70 → 字号恒为下限，与真机不符），
 *  且 frame.maxWidth 被姿态分支绕过。现统一「展示宽 = 度量宽」：无魔法系数、无缩放变换。 */
const frameWidth = computed(() => {
  const base = Math.round(Math.min(target.value.profile.frame.maxWidth, stageWidth.value))
  const po = activePosture.value
  if (po && target.value.key === 'fold') return Math.round(Math.min(base, po.viewport.width))
  return base
})

/** ★设备帧样式（真实 mockup：比例 + 帧宽 + 圆角——由画像 frame 驱动，代码零硬编码） */
const frameStyle = computed(() => {
  const f = target.value.profile.frame
  const v = target.value.profile.visual
  const po = activePosture.value
  // ★折叠屏姿态：帧比例与宽度随姿态（报告 P0-2 连续性——视口变化即重排）
  const ar = po && target.value.key === 'fold'
    ? `${po.viewport.width} / ${po.viewport.height}`
    : f.ar.replace('/', ' / ')
  const w = frameWidth.value
  return {
    aspectRatio: ar,
    width: `${w}px`,
    borderRadius: `${f.radius}px`,
    // ★帧/内容底色随画像（暗色形态不露浅色底——专家审查：车机/TV 沉浸被破坏）
    background: v.bg,
    // ★顶部让位仅在声明状态栏时生效
    '--frame-top': f.statusBar ? '24px' : '0px',
  }
})

const route = useRoute()
const router = useRouter()

// ★形态也可经 URL 直达（?device=fold——与 ?posture=folded 组合即「折叠屏 × 折叠态」可分享链接）
const active = ref<DeviceForm>(
  (TARGETS.some((t) => t.key === route.query.device) ? (route.query.device as DeviceForm) : 'car'),
)

/** ★折叠屏姿态（报告 P0-2）：折叠 / 半折 / 展开——切换即演示「连续性」（视口与拓扑随之变化） */
const postureKey = ref<'folded' | 'tabletop' | 'expanded'>(
  (['folded', 'tabletop', 'expanded'] as const).includes(route.query.posture as never)
    ? (route.query.posture as 'folded' | 'tabletop' | 'expanded')
    : 'expanded',
)
watch([postureKey, active], ([po, dev]) => {
  void router.replace({
    query: {
      ...route.query,
      device: dev === 'car' ? undefined : dev,
      posture: po === 'expanded' ? undefined : po,
    },
  })
})
const foldPostures = computed(() => FORM_PROFILES.fold.postures ?? [])
const activePosture = computed(() => foldPostures.value.find((x) => x.key === postureKey.value) ?? null)
/** 当前生效的形态画像（折叠屏时按姿态覆盖拓扑/视口） */
const effectiveProfile = computed(() => {
  const base = target.value.profile
  const po = activePosture.value
  if (!po || target.value.key !== 'fold') return base
  return { ...base, topology: po.topology, nav: po.nav, viewport: po.viewport }
})

/** 形态筛选（按输入族聚焦查看——触控系 / 指针系 / 遥控系；默认全部） */
type FilterKey = 'all' | 'touch' | 'cursor' | 'remote'
// ★URL query 驱动（?form=remote）——筛选状态可分享、可直达、可复现（与 Playground 分享链接同思路）

const initial = (route.query.form as string) ?? 'all'
const filter = ref<FilterKey>(initial === 'touch' || initial === 'cursor' || initial === 'remote' ? initial : 'all')
watch(filter, (f) => {
  void router.replace({ query: f === 'all' ? {} : { form: f } })
})
const FILTERS: Array<{ k: FilterKey; zh: string; en: string }> = [
  { k: 'all', zh: '全部形态', en: 'All forms' },
  { k: 'touch', zh: '触控系（表/手机/折叠/平板）', en: 'Touch (watch/phone/fold/tablet)' },
  { k: 'cursor', zh: '指针系（PC）', en: 'Pointer (PC)' },
  { k: 'remote', zh: '遥控系（车机 / TV）', en: 'Remote (car / TV)' },
]
const visibleTargets = computed(() => {
  const list = ordered.value
  if (filter.value === 'all') return list
  if (filter.value === 'touch') return list.filter((t) => t.profile.input === 'touch')
  if (filter.value === 'cursor') return list.filter((t) => t.profile.input === 'cursor')
  return list.filter((t) => t.profile.input === 'remote')
})
const target = computed(() => TARGETS.find((t) => t.key === active.value) ?? TARGETS[0]!)

/** 右侧推导行（★全部来自生效画像——非页面硬编码；折叠屏姿态覆盖后同步反映） */
const rows = computed(() => {
  const p = effectiveProfile.value
  return [
    { k: 'TARGET', v: isEn.value ? p.label.en : p.label.zh },
    { k: 'FORM', v: p.topology },
    { k: 'INPUT', v: p.input },
    { k: 'NAV', v: p.nav },
    { k: 'DISTANCE', v: p.distance },
    { k: 'VISUAL', v: `${p.visual.theme} · ${p.visual.accent}` },
  ]
})

/** 能力清单（★画像 SSOT 全量 14 项——顺序与文案由 FORM_CAP_KEYS 派生，页面不手工维护清单） */
const CAP_TEXT: Record<string, { zh: string; en: string }> = {
  hover: { zh: '指针悬停态', en: 'pointer hover' },
  skuMulti: { zh: '多规格选择', en: 'multi-SKU picker' },
  tabs: { zh: '底部 Tab 栏', en: 'bottom tabs' },
  sidebar: { zh: '持久侧栏', en: 'persistent sidebar' },
  dpad: { zh: '遥控 / 方向键焦点', en: 'd-pad focus' },
  crown: { zh: '表冠 / 旋钮', en: 'crown / rotary' },
  focusTree: { zh: '焦点树导航', en: 'focus tree' },
  focusRows: { zh: '横向焦点行', en: 'focus rows' },
  multiCol: { zh: '多列并排', en: 'multi-column' },
  dense: { zh: '高密度信息', en: 'dense info' },
  drawer: { zh: '抽屉 / 侧滑弹层', en: 'drawer / sheet' },
  notch: { zh: '异形屏安全区', en: 'notch safe area' },
  keyboard: { zh: '物理键盘', en: 'hardware keyboard' },
  driveAware: { zh: '驾驶降干扰', en: 'drive-aware' },
}
const CAP_LABELS = FORM_CAP_KEYS.map((k) => ({ k, ...(CAP_TEXT[k] ?? { zh: k, en: k }) }))

/** ★能力三态（报告 P2-2）：supported 绿 / fallback 琥珀（降级路径）/ unsupported 灰 */
function capsLevelOf(k: keyof FormProfile['caps']): 'supported' | 'fallback' | 'unsupported' {
  return capsLabel(effectiveProfile.value.caps[k])
}
function capsTextOf(k: keyof FormProfile['caps']): string {
  const lv = capsLevelOf(k)
  if (lv === 'supported') return isEn.value ? 'supported' : '声明支持'
  if (lv === 'fallback') return isEn.value ? 'fallback path' : '降级路径'
  return isEn.value ? 'unsupported' : '未支持'
}

const sourceLines = computed(() => fluidSource.split('\n').length)
</script>

<template>
  <p-view class="six-root">
    <header class="hero">
      <h1>
        {{ isEn ? 'One source, ' : '同一份源码，' }}<em>{{ isEn ? 'seven form factors' : '七种设备形态' }}</em>
      </h1>
      <p>
        {{
          isEn
            ? 'The same semantic content slots render into a watch / phone / foldable / tablet / PC / in-car / TV. Form drives layout topology, navigation, visual language and capability set; container width drives every dimension (fluid). No scaling tricks, no cropping.'
            : '同一份语义内容槽，渲染成手表 / 手机 / 折叠屏 / 平板 / PC / 车机 / TV。形态决定布局拓扑、导航、视觉语言与能力集；容器宽度决定一切尺寸（流体）。没有缩放花招、没有裁剪。'
        }}
      </p>
      <p-view class="honest">
        <p-text class="honest-text">
          {{
            isEn
              ? '✅ Real: FORM_PROFILES (SSOT) + p-formfactor orchestration + fluid metrics from the container. 🟡 Forms are declared by the host (a browser cannot auto-detect watch / car / TV) — the profile is a declarative table, exactly like the component compatibility tables.'
              : '✅ 真实：FORM_PROFILES（形态画像 SSOT）+ p-formfactor 自动编排 + 尺寸由容器宽度流体求解。🟡 形态由宿主声明（浏览器无法自动识别手表/车机/TV）——画像表是声明式的，与组件兼容进度表同一套协议。'
          }}
        </p-text>
      </p-view>
    </header>

    <section class="work">
      <!-- 左：内容槽源码（?raw = 正在执行的这份文件） -->
      <div class="col col--src">
        <div class="col-title">
          <span class="dot" />
          {{ isEn ? 'Content slots · this exact file runs' : '内容槽 · 运行的就是这份文件' }}
          <button type="button" class="mini" @click="showSource = !showSource">{{ showSource ? (isEn ? 'hide' : '收起') : (isEn ? 'show' : '展开') }}</button>
        </div>
        <pre v-if="showSource" class="src"><code>{{ fluidSource }}</code></pre>
        <div class="src-foot">
          <span class="eq">✓</span>
          {{ isEn ? 'zero per-device branching — the framework derives everything' : '零形态分支——全部由框架推导' }}
        </div>
      </div>

      <!-- 中：设备舞台（真实 mockup：居中 · 完整 · 无裁剪） -->
      <div class="col col--stage">
        <div class="col-title"><span class="dot" /><span class="live">LIVE</span> {{ isEn ? 'Device stage · real render' : '设备舞台 · 真实渲染' }}</div>

        <!-- 设备切换器（旧版形态：一排设备按钮 + 形态/输入/导航/后端摘要） -->
        <div class="switcher">
          <button
            v-for="t in visibleTargets"
            :key="t.key"
            type="button"
            class="dev-btn"
            :class="{ active: t.key === active }"
            @click="active = t.key"
          >
            <span class="dev-ic">{{ t.ic }}</span>
            <span class="dev-nm">{{ isEn ? t.profile.label.en : t.profile.label.zh }}</span>
            <span class="dev-meta">{{ t.profile.input }}</span>
          </button>
        </div>

        <!-- ★折叠屏姿态切换（报告 P0-2：折叠/半折/展开——演示 app continuity） -->
        <div v-if="target.key === 'fold' && foldPostures.length" class="postures">
          <button
            v-for="po in foldPostures"
            :key="po.key"
            type="button"
            class="posture-btn"
            :class="{ on: postureKey === po.key }"
            @click="postureKey = po.key"
          >
            {{ isEn ? po.label.en : po.label.zh }}
            <span class="posture-dim">{{ po.viewport.width }}×{{ po.viewport.height }}</span>
          </button>
        </div>

        <!-- 形态摘要条 -->
        <div class="device-meta">
          <span><b>{{ isEn ? 'Current' : '当前端' }}：</b>{{ isEn ? target.profile.label.en : target.profile.label.zh }}</span>
          <span class="backend-tag">{{ target.profile.topology }} · {{ target.profile.nav }}</span>
          <span class="dm-dist">{{ target.profile.distance }}</span>
        </div>

        <!-- ★真实设备帧：居中 + 比例外框 + 刘海/状态栏 + 完整呈现（不裁剪、不缩放） -->
        <div ref="stageEl" class="frame-host">
          <div
            class="frame"
            :class="{ 'has-notch': target.profile.frame.notch }"
            :style="frameStyle"
          >
            <span v-if="target.profile.frame.notch" class="notch" aria-hidden="true" />
            <!-- ★折叠屏铰链折痕（报告 P1-2 + 二次复审：方向随姿态——tabletop 是水平铰链，
                 此前恒定竖折痕 → 折痕方向与真实铰链矛盾） -->
            <span
              v-if="target.profile.frame.hinge"
              class="hinge"
              :class="{ 'hinge--h': activePosture?.hinge === 'horizontal' }"
              aria-hidden="true"
            />
            <div v-if="target.profile.frame.statusBar" class="statusbar" :class="{ 'statusbar--watch': target.profile.frame.watchFace }">
              <span>{{ target.profile.frame.watchFace ? '10:24' : '9:41' }}</span>
              <span>{{ target.profile.frame.watchFace ? '❤️ 72' : '▮▮▮ ⌁' }}</span>
            </div>
            <div class="app-body">
              <FluidProduct
                :form="target.key"
                :posture="target.key === 'fold' ? postureKey : ''"
                :width="contentWidth"
                :height="frameHeight"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 右：渲染决策 + 能力声明（对齐旧版：TARGET/FORM/INPUT/NAV/BACKEND + 能力勾选） -->
      <div class="col col--panel">
        <div class="col-title"><span class="dot" />{{ isEn ? 'Render decision / capabilities' : '渲染决策 / 能力' }}</div>
        <div class="ir">
          <div v-for="r in rows" :key="r.k" class="row">
            <span class="k">{{ r.k }}</span>
            <span class="v">{{ r.v }}</span>
          </div>
        </div>
        <h4 class="cap-title">{{ isEn ? 'Capability declarations' : '能力声明（按端勾选）' }}</h4>
        <div class="cap-table">
          <div
            v-for="c in CAP_LABELS"
            :key="c.k"
            class="cap-row"
            :class="`cap-${capsLevelOf(c.k)}`"
          >
            <span class="cap-dot" />
            <span class="cap-nm">{{ isEn ? c.en : c.zh }}</span>
            <span class="cap-v">{{ capsTextOf(c.k) }}</span>
          </div>
        </div>
        <p-view class="cap-note">
          <p-text class="cap-note-text">
            {{
              isEn
                ? 'Green = Backend declares support · Orange = the source degrades conditionally (e.g. no multi-SKU on car, no dense info on TV).'
                : '绿 = Backend 已声明支持 · 橙 = 源码走条件降级（如车机无 SKU 多选、TV 无高密度信息）。'
            }}
          </p-text>
        </p-view>
      </div>
    </section>
  </p-view>
</template>

<style scoped>
.six-root { max-width: 1440px; margin: 0 auto; padding: 6px 0 44px; }
.hero h1 { color: var(--ink); font-size: 26px; font-weight: 800; margin: 6px 0 10px; }
.hero h1 em { color: var(--brand-ink); font-style: normal; }
.hero > p { color: var(--muted); font-size: 13.5px; line-height: 1.75; max-width: 820px; }
.honest {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-left: 3px solid var(--brand);
  border-radius: 8px;
  max-width: 900px;
}
.honest-text { font-size: 12px; color: var(--muted); line-height: 1.7; }

.work { margin-top: 22px; display: grid; grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.5fr) minmax(0, 0.75fr); gap: 16px; }
.col { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px; min-width: 0; }
.col--stage { display: flex; flex-direction: column; }
.col-title { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: var(--muted); margin-bottom: 12px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--brand); }
.live { font-size: 10px; font-weight: 800; letter-spacing: 0.6px; color: var(--ok, #3ddc97); }
.mini {
  margin-left: auto; font-size: 10.5px; color: var(--muted);
  background: transparent; border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; cursor: pointer;
}
.src {
  margin: 0; background: var(--panel2); border: 1px solid var(--line-soft); border-radius: 10px;
  padding: 12px; font-family: var(--mono); font-size: 10px; line-height: 1.6; color: var(--ink);
  overflow: auto; max-height: 640px; white-space: pre;
}
.src-foot { margin-top: 10px; font-size: 11px; color: var(--dim); }
.eq { color: var(--ok, #3ddc97); font-weight: 800; }

/* 形态筛选 pills */
.filters { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
.filter-pill {
  font-size: 11px; font-weight: 700; color: var(--muted);
  background: var(--panel2); border: 1px solid var(--line);
  border-radius: 999px; padding: 5px 12px; cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.filter-pill:hover { color: var(--ink); }
.filter-pill.on { color: var(--brand-ink); border-color: rgba(124, 92, 255, 0.55); background: var(--brand-soft); }

/* ★设备切换器（旧版形态：一排设备按钮） */
.switcher { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-bottom: 12px; }
.dev-btn {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 9px 4px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--panel2); color: var(--muted); cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.dev-btn:hover { border-color: rgba(124, 92, 255, 0.5); }
.dev-btn.active { border-color: var(--brand); background: var(--brand-soft); color: var(--ink); }
.dev-ic { font-size: 17px; }
.dev-nm { font-size: 11.5px; font-weight: 700; }
.dev-meta { font-size: 9.5px; opacity: 0.75; }

/* ★折叠屏姿态切换（连续性演示）*/
.postures { display: flex; gap: 7px; margin-bottom: 10px; flex-wrap: wrap; }
.posture-btn {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 5px 11px;
  cursor: pointer;
}
.posture-btn:hover { color: var(--ink); }
.posture-btn.on { color: var(--brand-ink); border-color: rgba(124, 92, 255, 0.55); background: var(--brand-soft); }
.posture-dim { font-family: var(--mono); font-size: 9.5px; color: var(--dim); }

/* 形态摘要条 */
.device-meta {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  font-size: 12px; color: var(--muted);
  margin-bottom: 12px; padding-bottom: 9px;
  border-bottom: 1px dashed var(--line);
}
.device-meta b { color: var(--ink); }
.backend-tag {
  font-size: 10px; padding: 2px 8px; border-radius: 6px;
  background: var(--brand-soft); color: var(--brand-ink); font-weight: 700;
}
.dm-dist { font-family: var(--mono); font-size: 10.5px; color: var(--dim); }

/* ★★设备帧（真实 mockup：居中 + 比例外框 + 完整呈现——不裁剪不缩放） */
.frame-host {
  width: 100%; display: flex; align-items: flex-start; justify-content: center;
  min-height: 420px; padding: 4px;
}
.frame {
  position: relative; width: 100%; margin: 0 auto;
  transition: max-width 0.3s ease, aspect-ratio 0.3s ease;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
  border: 2px solid var(--line);
  overflow: hidden;
  background: #f7f8fa;
}
.hinge {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 10px;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.06), rgba(0, 0, 0, 0.16), rgba(0, 0, 0, 0.06));
  z-index: 4;
  pointer-events: none;
}
/* ★水平铰链（tabletop 半折）：横贯折痕 */
.hinge--h {
  top: 50%;
  bottom: auto;
  left: 0;
  right: 0;
  transform: translateY(-50%);
  width: auto;
  height: 10px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.06), rgba(0, 0, 0, 0.16), rgba(0, 0, 0, 0.06));
}
.notch {
  position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 96px; height: 20px; background: #000;
  border-radius: 0 0 12px 12px; z-index: 5;
}
.statusbar--watch {
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  background: #000;
  color: #f5f6fa;
  border-bottom-color: #26262d;
}
.statusbar {
  height: 24px; background: #fff; display: flex; align-items: center; justify-content: space-between;
  padding: 0 12px; font-size: 9.5px; color: #556; border-bottom: 1px solid #eef0f6; flex-shrink: 0;
}
/* ★帧顶偏移条件化（2026-09-26 专家审查）：此前三条规则全为 top:24px（无条件）→
   无状态栏形态（PC/车机/TV/手表）白吃 24px 并在暗色形态露出浅色帧底（破坏沉浸）。
   改为：仅当画像声明 statusBar 时才让出顶部位。 */
.app-body { position: absolute; inset: 0; top: var(--frame-top, 0px); }
/* 帧内滚动由内容层（p-formfactor 的 .pf-body）负责，外层不叠加滚动容器 */
.frame .app-body > * { height: 100%; }

/* 右侧面板 */
.ir { display: grid; gap: 7px; }
.row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 7px 10px; background: var(--panel2); border: 1px solid var(--line-soft); border-radius: 8px; }
.row .k { font-size: 10.5px; color: var(--dim); font-weight: 700; flex-shrink: 0; }
.row .v { font-family: var(--mono); font-size: 11px; color: var(--ink); text-align: right; word-break: break-word; }
.cap-title { margin: 16px 0 8px; font-size: 12.5px; color: var(--muted); }
.cap-table { display: grid; gap: 6px; }
.cap-row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; background: rgba(255, 180, 84, 0.07); border: 1px solid rgba(255, 180, 84, 0.22); }
/* ★三态视觉（报告 P2-2）：supported 绿 / fallback 琥珀 / unsupported 灰 */
.cap-row.cap-supported { background: rgba(61, 220, 151, 0.08); border-color: rgba(61, 220, 151, 0.28); }
.cap-row.cap-fallback { background: rgba(255, 180, 84, 0.14); border-color: rgba(255, 180, 84, 0.45); }
.cap-row.cap-unsupported { background: rgba(255, 255, 255, 0.02); border-color: var(--line); opacity: 0.6; }
.cap-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dim, #6a6a78); }
.cap-row.cap-supported .cap-dot { background: var(--ok, #3ddc97); }
.cap-row.cap-fallback .cap-dot { background: var(--warn, #ffb454); }
.cap-row.cap-unsupported .cap-dot { background: var(--dim, #6a6a78); }
.cap-nm { flex: 1; font-size: 11.5px; color: var(--ink); }
.cap-v { font-size: 10px; color: var(--dim); }
.cap-note { margin-top: 12px; }
.cap-note-text { font-size: 11px; color: var(--dim); line-height: 1.6; }

@media (max-width: 1240px) {
  .work { grid-template-columns: 1fr; }
}
</style>

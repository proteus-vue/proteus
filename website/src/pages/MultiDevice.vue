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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { locale } from '../i18n'
import FluidProduct from '../components/fluid-product/index.vue'
// ★自绘图标集（2026-09-29 风格统一）：emoji 由系统字体渲染、跨平台字形不一 → 全站改线性图标
import DemoIcon from '../components/DemoIcon.vue'
// ★★Fluid System v2：形态画像 SSOT（本页所有形态信息都从这里读——页面不重复定义能力/拓扑）
import { FORM_PROFILES, FORM_CAP_KEYS, capsLabel, resolveAspectClass, vendorSizeClass } from '@proteus-vue/fluid'
import type { DeviceForm, FormProfile, FormPosture } from '@proteus-vue/fluid'
// ★SSOT：左栏源码 = 正在执行的这份文件（vite ?raw——零双源，不存在「展示的源码 ≠ 跑的源码」）
import fluidSource from '../components/fluid-product/index.vue?raw'
// ★2026-09-27（用户实测）：源码区此前是**纯文本**（无高亮）——而站点已有零依赖高亮器
// （@proteus-vue/docs 的 highlight，文档站与 Playground 都在用同一套）。直接复用，不另造。
import { highlight } from '@proteus-vue/docs'

const isEn = computed(() => locale.value === 'en')
const showSource = ref(true)

/** ★端清单 = FORM_PROFILES 的形态 SSOT（布局/导航/能力/缩放全部从画像读，页面不重复定义） */
interface Target {
  key: DeviceForm
  /** ★自绘图标名（DemoIcon 的键——不再是 emoji：emoji 跨平台字形不一，与线性图标语言冲突） */
  ic: string
  profile: FormProfile
}
/** 形态 → 自绘图标（DemoIcon 同名键；设备剪影与 FORM_PROFILES 一一对应） */
const ICONS: Record<DeviceForm, string> = {
  watch: 'watch', phone: 'phone', flip: 'flip', fold: 'fold', tablet: 'tablet', pc: 'pc', car: 'car', tv: 'tv',
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
  if (po && activePostures.value.length) return po.viewport.height
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
  if (po && activePostures.value.length) return Math.round(Math.min(base, po.viewport.width))
  return base
})

/** ★设备帧样式（真实 mockup：比例 + 帧宽 + 圆角——由画像 frame 驱动，代码零硬编码） */
const frameStyle = computed(() => {
  const f = target.value.profile.frame
  const v = target.value.profile.visual
  const po = activePosture.value
  // ★折叠屏姿态：帧比例与宽度随姿态（报告 P0-2 连续性——视口变化即重排）
  const ar = po && activePostures.value.length
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
// ★2026-09-28：姿态键改为**从画像 SSOT 派生**（不再硬编码三元组）——
//   两类折叠各有半折键（fold=book · flip=tabletop），硬编码会让新姿态无法直达。
type PostureKey = FormPosture['key']
const ALL_POSTURES: PostureKey[] = ['folded', 'tabletop', 'book', 'expanded']
const postureKey = ref<PostureKey>(
  ALL_POSTURES.includes(route.query.posture as PostureKey)
    ? (route.query.posture as PostureKey)
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
// ★2026-09-28：姿态集来源从前端硬编码 fold → **当前形态的画像**（两类折叠各有姿态集）
const activePostures = computed(() => target.value.profile.postures ?? [])
const activePosture = computed(() => activePostures.value.find((x) => x.key === postureKey.value) ?? null)
/** 当前生效的形态画像（折叠屏时按姿态覆盖拓扑/视口） */
const effectiveProfile = computed(() => {
  const base = target.value.profile
  const po = activePosture.value
  if (!po || !activePostures.value.length) return base
  return { ...base, topology: po.topology, nav: po.nav, viewport: po.viewport }
})

/**
 * ★★折叠专区（2026-09-29 计划 03 · S3）：把「厂商理念 → 框架机制 → 演示可见 → 门禁可验证」
 *   落到一个面板里——理念不能只停在文档，否则「研究白做」。
 *   面板四段：① 姿态几何（含半开占比）② 铰链与折痕（三区域规则）③ 厂商档位对照（ITGSA 600/840dp）
 *   ④ 端注入几何入口（机型几何/折痕宽度由端上报——这是「不只按三星一家」的机制保证）。
 */
const isFoldable = computed(() => activePostures.value.length > 0)
/** ① 姿态几何：应用区尺寸 + 占比（半开 = 内屏的一半）+ 宽高比分类 */
const postureGeom = computed(() => {
  const po = activePosture.value
  const full = activePostures.value.find((x) => x.key === 'expanded')
  if (!po) return null
  const ar = po.viewport.width / po.viewport.height
  const share = full ? (po.viewport.width * po.viewport.height) / (full.viewport.width * full.viewport.height) : 0
  return {
    size: `${po.viewport.width}×${po.viewport.height}`,
    ar: ar.toFixed(2),
    aspect: resolveAspectClass(po.viewport.width, po.viewport.height),
    sharePct: Math.round(share * 100),
    isHalf: po.key === 'book' || po.key === 'tabletop',
    topo: po.topology,
  }
})
/** ② 铰链与折痕：设备固有轴（hinge）vs 屏幕上的折痕走向（crease）——两者是不同的量 */
const hingeInfo = computed(() => {
  const po = activePosture.value
  if (!po) return null
  const crease = po.crease
  return {
    hinge: po.hinge ?? '—',
    crease: crease ? `${crease.axis === 'horizontal' ? '水平' : '竖直'} · ${crease.at === 'bottom' ? '窗口底缘' : '贯穿中部'}` : isEn.value ? 'none (cover screen — no crease visible)' : '无（外屏看不到折痕）',
    bandVisible: !!crease && crease.at === 'bottom',
  }
})
/** ③ 厂商档位对照（ITGSA / 小米 600-840dp 宽度断点 + 480/900 高度断点） */
const vendorInfo = computed(() => {
  const vp = activePosture.value?.viewport ?? target.value.profile.viewport
  const v = vendorSizeClass(vp.width, vp.height)
  const ZH: Record<string, string> = { compact: 'Compact', medium: 'Medium', expanded: 'Expanded' }
  return {
    width: `${v.width}`,
    height: `${v.height}`,
    label: `${ZH[v.width]} (${vp.width}dp) · ${ZH[v.height]} (${vp.height}dp)`,
  }
})
/** ④ 端注入的折痕带宽度（px）——真机由端上报；0 = 用演示壳默认（流体单位） */
const injectedCreaseBand = ref(0)
const CREASE_PRESETS = [
  { px: 0, zh: '演示壳默认', en: 'mock default' },
  { px: 8, zh: '窄铰链 8px', en: 'narrow 8px' },
  { px: 24, zh: '宽铰链 24px', en: 'wide 24px' },
]
/** ⑤ 功能对照（Apple「跨姿态保持同样功能」）：当前姿态下哪些槽被收起 + 理由（不得静默丢失） */
const functionCompare = computed(() => {
  const po = activePosture.value
  if (!po) return []
  const half = po.key === 'book' || po.key === 'tabletop'
  const rows: Array<{ name: string; on: boolean; why: string }> = [
    { name: isEn.value ? 'multi-SKU picker' : '多规格选择', on: true, why: isEn.value ? 'purchase path — never hidden' : '购买路径——任何姿态都不隐藏' },
    { name: isEn.value ? 'primary action (buy)' : '主操作（购买）', on: true, why: isEn.value ? 'purchase path' : '购买路径' },
    {
      name: isEn.value ? 'secondary action (save)' : '次操作（收藏）',
      on: !half,
      why: half ? (isEn.value ? 'collapsed in half-open (space); reachable when folded/expanded' : '半开空间不足时收起；折叠态/展开态仍可达') : (isEn.value ? 'available' : '可用'),
    },
    {
      name: isEn.value ? 'long description' : '长描述',
      on: !half,
      why: half ? (isEn.value ? 'secondary text — collapsed in half-open' : '次要信息——半开收起') : (isEn.value ? 'available' : '可用'),
    },
    {
      name: isEn.value ? 'recommendations' : '推荐区',
      on: true,
      why: isEn.value ? 'kept (compact row in half-open)' : '保留（半开时降为紧凑行）',
    },
  ]
  return rows
})

/**
 * ★★连续性可视化（2026-09-29 · S4）：切换姿态**前后**的业务状态对照。
 *   取值来自**真实渲染**的 `data-biz-*`（不是另存一份影子状态）——切换前快照 → 切换后回读，
 *   两者必须完全相同（「状态不丢」的可见 + 可断言证据）。
 *   诚实边界：这是「同一实例重排」的演示层证据；框架级连续性契约（onFormChange / 端姿态事件）
 *   仍属 OS 路线图（02），本页不外宣称。
 */
const bizNote = ref('耳机')
const bizBefore = ref('')
const bizAfter = ref('')
function readBiz(): string {
  const el = document.querySelector('.frame .p-formfactor') as HTMLElement | null
  if (!el) return ''
  return [el.dataset.bizSku ?? '', el.dataset.bizCount ?? '', el.dataset.bizNote ?? ''].join('|')
}
function fmtBiz(s: string): string {
  const [sku, count, note] = s.split('|')
  if (!sku) return isEn.value ? '(no state yet)' : '（暂无状态）'
  return `SKU=${sku} · ${isEn.value ? 'count' : '计数'}=${count} · ${isEn.value ? 'note' : '备注'}「${note}」`
}
/** 切入点选在切换之后回读（nextTick + 一帧）——避免读到重排中途的瞬时值 */
async function snapshotBiz(): Promise<void> {
  bizAfter.value = readBiz()
}
watch([postureKey, active], async (_nv, ov) => {
  if (bizBefore.value === '' || (ov && ov.length)) bizBefore.value = readBiz()
  await nextTick()
  requestAnimationFrame(() => void snapshotBiz())
})
const bizPreserved = computed(() => bizBefore.value !== '' && bizAfter.value !== '' && bizBefore.value === bizAfter.value)

/** 形态筛选（按输入族聚焦查看——触控系 / 指针系 / 遥控系；默认全部） */
type FilterKey = 'all' | 'touch' | 'cursor' | 'remote'
// ★URL query 驱动（?form=remote）——筛选状态可分享、可直达、可复现（与 Playground 分享链接同思路）

const initial = (route.query.form as string) ?? 'all'
const filter = ref<FilterKey>(initial === 'touch' || initial === 'cursor' || initial === 'remote' ? initial : 'all')
watch(filter, (f) => {
  // ★三审修：此前 `{ form: f }` 整体替换 query → 会清掉 device/posture（切筛选即丢当前端）；
  //   与 active/postureKey 的 watcher 一样保留其余字段。
  void router.replace({
    query: {
      ...route.query,
      form: f === 'all' ? undefined : f,
    },
  })
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
// ★三审：筛选后当前端可能不在可见列表（切换器只剩一个按钮且无法恢复）→ 自动落到首个可见端
// 切形态时把姿态重置为该形态的缺省（否则会带着上一个形态的姿态键）
watch(active, () => {
  const list = activePostures.value
  if (list.length && !list.some((x) => x.key === postureKey.value)) {
    postureKey.value = (list.find((x) => x.key === 'expanded') ?? list[list.length - 1]!).key
  }
})
watch(visibleTargets, (list) => {
  if (list.length && !list.some((t) => t.key === active.value)) active.value = list[0]!.key
})

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
/** 高亮后的源码（highlight 内部已 escapeHtml——v-html 安全；vue 语言走 SFC 拆块） */
const sourceHtml = computed(() => highlight(fluidSource, 'vue'))
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
        <!-- ★v-html：内容由 docs 引擎 highlight() 生成（已 escapeHtml，见 style.css 的 docs-tok-* 取色） -->
        <pre v-if="showSource" class="src"><code v-html="sourceHtml" /></pre>
        <div class="src-foot">
          <span class="eq">✓</span>
          {{ isEn ? 'zero per-device branching — the framework derives everything' : '零形态分支——全部由框架推导' }}
        </div>
      </div>

      <!-- 中：设备舞台（真实 mockup：居中 · 完整 · 无裁剪） -->
      <div class="col col--stage">
        <div class="col-title"><span class="dot" /><span class="live">LIVE</span> {{ isEn ? 'Device stage · real render' : '设备舞台 · 真实渲染' }}</div>

        <!-- 形态族筛选（按输入族聚焦：触控系 / 指针系 / 遥控系——?form= 可分享直达） -->
        <div class="filters">
          <button
            v-for="ff in FILTERS"
            :key="ff.k"
            type="button"
            class="filter-pill"
            :class="{ on: filter === ff.k }"
            @click="filter = ff.k"
          >
            {{ isEn ? ff.en : ff.zh }}
          </button>
        </div>

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
            <DemoIcon class="dev-ic" :name="t.ic" />
            <span class="dev-nm">{{ isEn ? t.profile.label.en : t.profile.label.zh }}</span>
            <span class="dev-meta">{{ t.profile.input }}</span>
          </button>
        </div>

        <!-- ★★折叠专区（2026-09-29 计划 03 · S3）：轴 1 设备类型（由切换器承担）· 轴 2 姿态 -->
        <div v-if="isFoldable" class="fold-zone">
          <div class="fold-head">
            <span class="fold-title">{{ isEn ? 'Foldable zone' : '折叠专区' }}</span>
            <span class="fold-sub">{{ isEn ? 'postures are one continuous device, not fixed sizes' : '姿态是同一台设备的连续过程，不是又一个固定尺寸' }}</span>
          </div>
          <!-- 轴 2：姿态（含几何摘要） -->
          <div class="postures">
            <button
              v-for="po in activePostures"
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
          <!-- 端注入·折痕几何（机型几何由端注入——「不只按三星一家」的机制保证） -->
          <div class="inject-row">
            <span class="inject-label">{{ isEn ? 'End-injected crease band' : '端注入折痕带' }}</span>
            <button
              v-for="p in CREASE_PRESETS"
              :key="p.px"
              type="button"
              class="inject-btn"
              :class="{ on: injectedCreaseBand === p.px }"
              @click="injectedCreaseBand = p.px"
            >
              {{ isEn ? p.en : p.zh }}
            </button>
          </div>
        </div>

        <!-- 形态摘要条 -->
        <div class="device-meta">
          <span><b>{{ isEn ? 'Current' : '当前端' }}：</b>{{ isEn ? target.profile.label.en : target.profile.label.zh }}</span>
          <span class="backend-tag">{{ effectiveProfile.topology }} · {{ effectiveProfile.nav }}</span>
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
            <!-- ★★折痕（2026-09-29 用户实测纠错）：此前帧上恒画一条（按 frame.hinge）→
                 折叠态（外屏根本看不到折痕）也在画 = **假折痕**；且方向只看 activePosture.hinge，
                 与「折痕在窗口内何处」无关。
                 现折痕由内容层（p-formfactor）按**姿态几何**渲染：只在半开（铰链在窗口底缘）画带，
                 展开态不画带（平坦态折痕是浅痕、不构成布局区域），折叠态不画。
                 帧层不再绘制任何折痕。 -->
            <div v-if="target.profile.frame.statusBar" class="statusbar" :class="{ 'statusbar--watch': target.profile.frame.watchFace }">
              <span>{{ target.profile.frame.watchFace ? '10:24' : '9:41' }}</span>
              <!-- ★状态栏图标同源自绘（原 ❤️ / ▮▮▮ ⌁ 为 emoji 与几何字符） -->
              <span class="sb-icons">
                <template v-if="target.profile.frame.watchFace">
                  <DemoIcon class="sb-ic" name="heart" />72
                </template>
                <template v-else>
                  <DemoIcon class="sb-ic" name="signal" />
                  <DemoIcon class="sb-ic" name="battery" />
                </template>
              </span>
            </div>
            <div class="app-body">
              <FluidProduct
                :form="target.key"
                :posture="activePostures.length ? postureKey : ''"
                :width="contentWidth"
                :height="frameHeight"
                :note="bizNote"
                :crease-band="injectedCreaseBand"
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

        <!-- ★★折叠面板（2026-09-29 计划 03 · S3/S4）：理念 → 机制 → 可见物 → 判据 的四段闭环 -->
        <template v-if="isFoldable && postureGeom">
          <h4 class="cap-title">{{ isEn ? 'Foldable · posture geometry' : '折叠 · 姿态几何' }}</h4>
          <div class="ir">
            <div class="row"><span class="k">{{ isEn ? 'POSTURE' : '姿态' }}</span><span class="v">{{ activePosture ? (isEn ? activePosture.label.en : activePosture.label.zh) : '' }}</span></div>
            <div class="row"><span class="k">{{ isEn ? 'APP AREA' : '应用区' }}</span><span class="v">{{ postureGeom.size }} · {{ postureGeom.ar }}</span></div>
            <div class="row"><span class="k">{{ isEn ? 'ASPECT' : '宽高比档' }}</span><span class="v">{{ postureGeom.aspect }}</span></div>
            <div class="row">
              <span class="k">{{ isEn ? 'SHARE OF INNER' : '占内屏' }}</span>
              <span class="v" :class="{ 'v--ok': postureGeom.isHalf && postureGeom.sharePct >= 40 && postureGeom.sharePct <= 75 }">
                {{ postureGeom.sharePct }}%{{ postureGeom.isHalf ? (isEn ? ' (= half of inner screen)' : '（≈ 内屏的一半）') : '' }}
              </span>
            </div>
            <div class="row"><span class="k">{{ isEn ? 'TOPOLOGY' : '拓扑' }}</span><span class="v">{{ postureGeom.topo }}</span></div>
          </div>

          <h4 class="cap-title">{{ isEn ? 'Hinge & crease (three-region rule)' : '铰链与折痕（三区域规则）' }}</h4>
          <div class="ir">
            <div class="row"><span class="k">{{ isEn ? 'HINGE AXIS' : '铰链轴' }}</span><span class="v">{{ hingeInfo?.hinge }}</span></div>
            <div class="row"><span class="k">{{ isEn ? 'CREASE ON SCREEN' : '屏幕上折痕' }}</span><span class="v">{{ hingeInfo?.crease }}</span></div>
            <div class="row">
              <span class="k">{{ isEn ? 'BAND' : '折痕带' }}</span>
              <span class="v">{{ hingeInfo?.bandVisible ? (isEn ? 'visible · no elements inside' : '可见 · 带内无元素') : (isEn ? 'not drawn' : '未绘制') }}</span>
            </div>
          </div>

          <h4 class="cap-title">{{ isEn ? 'Vendor size class (ITGSA 600/840dp)' : '厂商档位（ITGSA 600/840dp）' }}</h4>
          <div class="ir">
            <div class="row"><span class="k">{{ isEn ? 'WIDTH CLASS' : '宽度档' }}</span><span class="v">{{ vendorInfo.width }}</span></div>
            <div class="row"><span class="k">{{ isEn ? 'HEIGHT CLASS' : '高度档' }}</span><span class="v">{{ vendorInfo.height }}</span></div>
          </div>

          <h4 class="cap-title">{{ isEn ? 'Same functionality across postures' : '跨姿态功能一致' }}</h4>
          <div class="fn-table">
            <div v-for="f in functionCompare" :key="f.name" class="fn-row" :class="{ 'fn-off': !f.on }">
              <span class="fn-dot" />
              <span class="fn-nm">{{ f.name }}</span>
              <span class="fn-why">{{ f.why }}</span>
            </div>
          </div>

          <h4 class="cap-title">{{ isEn ? 'Continuity: state before ⇄ after' : '连续性：切换前后业务状态' }}</h4>
          <div class="biz">
            <div class="row"><span class="k">{{ isEn ? 'BEFORE' : '切换前' }}</span><span class="v">{{ fmtBiz(bizBefore) }}</span></div>
            <div class="row"><span class="k">{{ isEn ? 'AFTER' : '切换后' }}</span><span class="v">{{ fmtBiz(bizAfter) }}</span></div>
            <div class="biz-verdict" :class="{ 'biz-ok': bizPreserved }">
              {{ bizPreserved ? (isEn ? '✓ identical — state preserved (same instance re-layout, no remount)' : '✓ 完全一致——状态保留（同一实例重排，未重新挂载）') : (isEn ? 'switch a posture to verify' : '切换一个姿态以验证') }}
            </div>
          </div>
          <label class="biz-input">
            <span>{{ isEn ? 'type here, then switch posture' : '在此输入，再切姿态' }}</span>
            <input v-model="bizNote" type="text" :placeholder="isEn ? 'business note' : '业务备注'" />
          </label>
        </template>
      </div>
    </section>
  </p-view>
</template>

<style scoped>
.six-root {
  /* ★容器上下文（2026-09-26 D-2）：.work 的断点由**容器宽**判定（非视口） */
  container-type: inline-size; max-width: 1440px; margin: 0 auto; padding: 6px 0 44px; }
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
.filters { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
.switcher { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-bottom: 12px; }
.dev-btn {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 9px 4px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--panel2); color: var(--muted); cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.dev-btn:hover { border-color: rgba(124, 92, 255, 0.5); }
.dev-btn.active { border-color: var(--brand); background: var(--brand-soft); color: var(--ink); }
.dev-ic { font-size: 17px; color: var(--muted); }
.dev-btn.active .dev-ic { color: var(--brand-ink); }
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
.notch {
  position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 96px; height: 20px; background: #000;
  border-radius: 0 0 12px 12px; z-index: 5;
}
.sb-icons { display: inline-flex; align-items: center; gap: 3px; }
.sb-ic { font-size: 11px; }
.statusbar--watch .sb-ic { font-size: 12px; }
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

/* ★★折叠专区（姿态轴 + 端注入入口）*/
.fold-zone {
  margin-bottom: 12px; padding: 10px 12px;
  border: 1px solid rgba(124, 92, 255, 0.28); border-radius: 12px;
  background: linear-gradient(180deg, rgba(124, 92, 255, 0.07), transparent);
}
.fold-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.fold-title { font-size: 12px; font-weight: 800; color: var(--ink); }
.fold-sub { font-size: 10.5px; color: var(--dim); }
.inject-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.inject-label { font-size: 10.5px; color: var(--dim); }
.inject-btn {
  font-size: 10.5px; color: var(--muted); background: var(--panel2);
  border: 1px solid var(--line); border-radius: 999px; padding: 3px 9px; cursor: pointer;
}
.inject-btn.on { color: var(--brand-ink); border-color: rgba(124, 92, 255, 0.55); background: var(--brand-soft); }

/* 折叠面板：功能对照 */
.fn-table { display: grid; gap: 6px; }
.fn-row { display: grid; grid-template-columns: 8px minmax(84px, auto) 1fr; align-items: baseline; gap: 8px; padding: 6px 9px; border-radius: 8px; background: rgba(61, 220, 151, 0.07); border: 1px solid rgba(61, 220, 151, 0.22); }
.fn-row.fn-off { background: rgba(255, 180, 84, 0.12); border-color: rgba(255, 180, 84, 0.38); }
.fn-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok, #3ddc97); }
.fn-row.fn-off .fn-dot { background: var(--warn, #ffb454); }
.fn-nm { font-size: 11px; font-weight: 700; color: var(--ink); }
.fn-why { font-size: 10.5px; color: var(--dim); line-height: 1.5; }

/* 连续性对照 */
.biz { display: grid; gap: 6px; }
.biz-verdict { font-size: 10.5px; color: var(--dim); padding: 6px 9px; border-radius: 8px; background: var(--panel2); border: 1px dashed var(--line); }
.biz-verdict.biz-ok { color: var(--ok, #3ddc97); border-style: solid; border-color: rgba(61, 220, 151, 0.35); background: rgba(61, 220, 151, 0.08); }
.biz-input { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 10.5px; color: var(--dim); }
.biz-input input { flex: 1; min-width: 0; font-size: 11px; padding: 5px 8px; color: var(--ink); background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; }
.row .v.v--ok { color: var(--ok, #3ddc97); }

/* ★2026-09-26 D-2：原 @media 视口断点 → @container 容器查询（.work 自身即容器——
   窄容器（分栏容器变窄）落单栏，与页面宽度解耦：嵌入卡片/分栏容器里同样正确） */
@container (max-width: 1240px) {
  .work { grid-template-columns: 1fr; }
}
</style>

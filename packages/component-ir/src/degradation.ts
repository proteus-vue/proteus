// packages/component-ir/src/degradation.ts
// ★批次 4（M6）· 属性降级声明（EA-5 / G-31.2 / CMP006）
//   「每一个组件属性都必须声明其在各端下的降级行为（supported / fallback / unsupported）」——
//   消除「属性在 A 端支持、B 端不支持时静默失败」这一异端（对齐 G-31.2）。
//
// ★端轴（诚实边界，★与 03-degradation-tiers.md §3 的 5 端表有意不同）：
//   本表只列**真有 Backend 实现**的端：`mp`（微信小程序：skyline + 编译器 → 原生标签）与
//   `web`（vue-dom 模拟层）。文档 §3 的 ios/android/harmony 列在 `BackendId` 中虽存在，但
//   `packages/render-backend` 仅 vue-dom/headless/flutter 有具体实现，native-* 只出现在参考映射表
//   （SEMANTIC_BACKEND_MAP）里——为 249 个属性声明 `ios: supported` 属**凭空捏造**
//   （违反项目「诚实边界/诚实声明」原则）。故本表按 2 端落地，端轴设计为可扩展 record：
//   新增端只需 (a) 补 DegradationEnd 联合 (b) 补规则表列 (c) 门禁自动要求全属性补齐（gap=0）。
//
// ★fallback 的反黑盒要求（§4）：`fallback` 必须给**可观察的降级行为**，不能只是「不报错」。
//   故本表每条 fallback/unsupported 都强制填 `behavior`（降级行为描述），
//   `auditDegradation` 对「有状态无行为」直接判 FAIL——这是本门禁的实质约束（非纸面）。
import { PRIMITIVE_CATALOG } from './primitives'
import type { PrimitiveDef } from './primitives'

/** 端轴：仅「真有 Backend 实现」的端（见文件头诚实边界） */
export type DegradationEnd = 'mp' | 'web'

/** 降级三态（§2） */
export type DegradationTier = 'supported' | 'fallback' | 'unsupported'

/** 单属性降级声明 */
export interface DegradationEntry {
  mp: DegradationTier
  web: DegradationTier
  /** 降级行为（任一端非 supported 时必填——EA-5 §4 反黑盒） */
  behavior?: string
}

export type DegradationMap = Record<string, DegradationEntry>

/* ---------- 规则表（证据驱动；新增须给理由） ---------- */

/**
 * T3 平台私有属性（官方宿主私有语义，Web 无原生等价）→ web: fallback。
 * 依据 §3 表 T3 行；fallback 行为 = 触发**同名事件** + 明确提示（已验证先例：Web p-button open-type）。
 */
const PRIVATE_WEB_FALLBACK: Record<string, string> = {
  openType: 'Web 触发同名事件（如 @contact）+ console 提示自定义对应交互（参考 Web p-button open-type）',
  appId: 'Web 无跨应用跳转能力，仅回显参数并提示',
  shortLink: 'Web 无短链跳转能力，仅回显参数并提示',
  unitId: 'Web 无宿主广告位，渲染占位并提示（不静默）',
  adType: 'Web 无宿主广告类型，忽略并提示',
  adTheme: 'Web 无宿主广告主题，忽略并提示',
  adIntervals: 'Web 无宿主广告自动刷新，忽略并提示',
}

/**
 * 样式类属性（§3 表「样式」行）→ web: fallback（映射 CSS 伪类）。
 */
const STYLE_WEB_FALLBACK: Record<string, string> = {
  hoverClass: '映射 CSS :active/:hover 类（框架默认类恒在，自定义类作附加——T3）',
  hoverStartTime: 'Web 用 CSS transition-delay 近似按压起始延时',
  hoverStayTime: 'Web 用 CSS transition-duration 近似按压停留时长',
  hoverStopPropagation: 'Web 用 CSS pointer-events 阻断子级反馈近似',
}

/**
 * ★MP 宿主透传属性（2026-09-18 批次外收口新增）→ web: fallback。
 * 这些属性由小程序宿主（键盘/同层渲染/安全键盘/formId）实现，Web 无对应能力 → no-op + 提示。
 * ★诚实边界：其中部分在 Web **存在近似实现**（cursorColor→CSS caret-color、
 *   selectionStart/End→setSelectionRange），但当前 p-input 未接线 → 如实标 fallback，
 *   behavior 中写明可用的 Web 近似（不假装已实现，也不假装做不到）。
 */
const MP_HOST_WEB_FALLBACK: Record<string, string> = {
  alwaysEmbed: 'Web 无同层/非同层切换概念（input 始终在文档流），忽略并提示',
  confirmHold: 'Web 无法控制软键盘收起时机（由浏览器/系统决定），忽略并提示',
  adjustPosition: 'Web 由浏览器自身处理键盘弹起时的视口滚动，忽略并提示',
  holdKeyboard: 'Web 无法在失焦点击时保持键盘（浏览器行为），忽略并提示',
  cursorColor: 'Web 近似：CSS caret-color（当前未接线，忽略并提示）',
  selectionStart: 'Web 近似：setSelectionRange（当前未接线，忽略并提示）',
  selectionEnd: 'Web 近似：setSelectionRange（当前未接线，忽略并提示）',
  placeholderClass: 'Web 无「占位符专用类名」通道（::placeholder 不可承接任意类），忽略并提示',
  safePasswordCertPath: 'Web 无小程序安全键盘（宿主级加密键盘），忽略并提示',
  safePasswordLength: 'Web 无小程序安全键盘，忽略并提示',
  safePasswordTimeStamp: 'Web 无小程序安全键盘，忽略并提示',
  safePasswordNonce: 'Web 无小程序安全键盘，忽略并提示',
  safePasswordSalt: 'Web 无小程序安全键盘，忽略并提示',
  safePasswordCustomHash: 'Web 无小程序安全键盘，忽略并提示',
  reportSubmit: 'formId 是小程序模板消息宿主能力，Web 无对应 → 忽略并提示',
  reportSubmitTimeout: 'formId 是小程序模板消息宿主能力，Web 无对应 → 忽略并提示',
}

/**
 * T2 宿主组件族（camera/map/video/ad/canvas/web-view/live 等）→ web: fallback。
 * 依据 §3 表 T2 行：宿主能力在 Web 端由模拟层提供**语义等价降级**（可观察：占位容器 + 提示）。
 * 按 tag 限定——避免同名属性（如 loop/size/mode）在非宿主组件上被误判。
 */
const HOST_TAGS: Record<string, string> = {
  'p-map': 'Web 模拟层渲染静态占位容器，忽略该地图显示参数并提示',
  'p-media': 'Web 用原生 <video>，忽略该播放器外观/专有参数并提示',
  'p-camera': 'Web 无摄像头宿主，忽略该采集参数并提示（可退化 getUserMedia 时另行实现）',
  'p-ad': 'Web 无宿主广告，忽略该广告参数并提示',
  'p-canvas': 'Web 用 HTMLCanvasElement，忽略该小程序渲染上下文专有参数并提示',
  'p-webview': 'Web 用 <iframe>，忽略该小程序 web-view 专有参数并提示',
}

/**
 * 框架在 Web 端的**扩展属性**（小程序无对应语义）→ mp: fallback。
 * 判定依据：仅存在于 Web 实现、官方属性清单无该名（如响应式密度/设计稿宽度）。
 * ★注意：`customStyle` **不在此列**——p-page-container 的 `customStyle` 即官方 `custom-style`（mp: supported）；
 *   「同名不同义」不得进全局规则表（同 `SEMANTIC_ALIAS_BY_TAG` 纪律）。
 * ★2026-09-18 清理 2 条陈旧规则：`open`（架构设想，无组件声明）、`clearable`
 *   （原记于 catalog 的 p-input，但源码 p-input 并未声明该 prop）——以源码为基准后自动暴露。
 */
const WEB_EXTENSION_MP_FALLBACK: Record<string, string> = {
  density: '小程序无 DPI 密度概念，忽略并提示（rpx 已按设计稿宽度换算）',
  designWidth: '小程序用 rpx 基准（750），该 Web 专用基准忽略并提示',
  searchable: '小程序无内建搜索语义，忽略并提示（由业务侧自绘）',
}

/**
 * ★按 tag 限定的 mp: fallback（2026-09-19 新增机制）：属性在 Web 有实现、MP 无平台对等。
 *
 * 与 STYLE_WEB_FALLBACK 等「按属性名全局」的表不同——这里**按 tag 限定**，因为本仓存在
 * **跨组件同名属性**（实测：`loop` 是 `<video>/<audio>` 的官方属性、`snap` 是 `<draggable-sheet>`
 * 的官方属性，而框架的 `p-stack` 另有自己的语义 `loop`/`snap`）——按属性名全局判 fallback 会误伤。
 *
 * 依据：`p-stack` 的 `snap`/`loop` 是「轮播」语义消灭形态（G-31 §2.2、rules.md 拒绝 `<p-swiper>`），
 *   但 MP 端容器滚动本身不成立——**Skyline 的 view 不滚动（CSS overflow 无效）**，这是本仓已实测
 *   的结论（skyline-pitfalls S14 + `p-scroll` 同款告警：「小程序 view 不滚动——请改用 p-scroll-view」）。
 *   容器不滚动 ⇒ 吸附/回环无载体（CSS scroll-snap 亦然）。
 *   fallback 行为 = 普通排列 + `capabilityWarnOnce` 控制台提示（可观察，非静默失效）。
 *   ★MP 端如需真轮播：用 `p-scroll-view` 的 `paging-enabled`（官方 Skyline 翻页属性，原生支持）。
 */
const TAG_PROP_MP_FALLBACK: Record<string, Record<string, string>> = {
  'p-stack': {
    snap: '小程序 view 不滚动（Skyline 无 CSS overflow 滚动，S14 实测）→ 吸附无载体，降级为普通排列 + 可观察提示；需翻页请用 p-scroll-view 的 paging-enabled',
    loop: '回环依赖吸附容器，而小程序 view 不滚动（S14）→ 一并降级为普通排列 + 可观察提示',
  },
}

/** ★导出供降级门禁做「显式登记的 tag 限定 fallback」豁免（区别于跨组件同名导致的误报） */
export const TAG_SCOPED_MP_FALLBACK: typeof TAG_PROP_MP_FALLBACK = TAG_PROP_MP_FALLBACK

/* ---------- 判定 ---------- */

/** 规则表登记的全部「非缺省判定」属性名（供门禁做**陈旧规则**检测——规则指向不存在的属性即失效） */
export const RULE_REGISTERED_PROPS: string[] = [
  ...Object.keys(PRIVATE_WEB_FALLBACK),
  ...Object.keys(STYLE_WEB_FALLBACK),
  ...Object.keys(WEB_EXTENSION_MP_FALLBACK),
  ...Object.keys(MP_HOST_WEB_FALLBACK),
  ...Object.values(TAG_PROP_MP_FALLBACK).flatMap((m) => Object.keys(m)),
]

/** 宿主组件族 tag（web:fallback 的来源） */
export const HOST_FALLBACK_TAGS: string[] = Object.keys(HOST_TAGS)

/** 对单个属性判定降级三元组（端轴可扩展） */
export function degradeProp(tag: string | undefined, prop: string): DegradationEntry {
  const style = STYLE_WEB_FALLBACK[prop]
  if (style) return { mp: 'supported', web: 'fallback', behavior: style }

  const priv = PRIVATE_WEB_FALLBACK[prop]
  if (priv) return { mp: 'supported', web: 'fallback', behavior: priv }

  const mpHost = MP_HOST_WEB_FALLBACK[prop]
  if (mpHost) return { mp: 'supported', web: 'fallback', behavior: mpHost }

  if (tag && HOST_TAGS[tag]) {
    return { mp: 'supported', web: 'fallback', behavior: HOST_TAGS[tag] }
  }

  // ★tag 限定（先于属性名全局表判——更具体者优先）
  const tagProp = tag ? TAG_PROP_MP_FALLBACK[tag] : undefined
  const tagPropBehavior = tagProp ? tagProp[prop] : undefined
  if (tagPropBehavior) return { mp: 'fallback', web: 'supported', behavior: tagPropBehavior }

  const webExt = WEB_EXTENSION_MP_FALLBACK[prop]
  if (webExt) return { mp: 'fallback', web: 'supported', behavior: webExt }

  // 缺省：框架语义属性——两端均由同一组件实现（跨端单实现 + 各端 Backend 映射）→ supported
  return { mp: 'supported', web: 'supported' }
}

/** 组件原语（有 tag 者）的属性降级表：tag → { prop → entry } */
export function degradationOf(prim: PrimitiveDef): DegradationMap {
  const out: DegradationMap = {}
  for (const p of prim.props ?? []) out[p] = degradeProp(prim.tag, p)
  return out
}

/** 全量降级表（SSOT：PRIMITIVE_CATALOG 中所有带 tag 的原语） */
export const DEGRADATION_TABLE: Record<string, DegradationMap> = (() => {
  const out: Record<string, DegradationMap> = {}
  for (const prim of PRIMITIVE_CATALOG) {
    if (!prim.tag) continue
    out[prim.tag] = degradationOf(prim)
  }
  return out
})()

/**
 * ★性能预计算（2026-09-18）：tag → { kebab 属性名 → true }，**只收 `mp: unsupported` 的属性**。
 *
 * 编译器编译每个元素都要判「该属性在 mp 端是否 unsupported」。此前编译器在 `serializeElement`
 * 里**逐元素**新建 Map 并对每个属性名跑 kebabCase → 实测 `compile-vue-sfc` 基准从 0.573ms
 * 涨到 0.765ms（+33%，推过 1.2x 警告线）。改为模块加载时预计算一次：
 * 每元素仅剩 **一次 kebabCase + 一次 Set.has**，零分配。
 *
 * 语义等价：诊断只关心 `mp === 'unsupported'`（`fallback` 有意降级、不报），故只需该子集。
 */
export const MP_UNSUPPORTED_PROPS: Record<string, Set<string>> = (() => {
  const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  const out: Record<string, Set<string>> = {}
  for (const [tag, table] of Object.entries(DEGRADATION_TABLE)) {
    const set = new Set<string>()
    for (const [prop, entry] of Object.entries(table)) {
      if (entry.mp === 'unsupported') set.add(kebab(prop))
    }
    if (set.size) out[tag] = set
  }
  return out
})()

/* ---------- 门禁（EA-5 验收 §6） ---------- */

export interface DegradationIssue {
  tag: string
  prop: string
  /**
   * missing = 空白格（保留以兼容既有消费方；表由规则构建后不再产生）；
   * behavior-gap = 非 supported 但无可观察行为；table-divergence = 表与规则判定不一致。
   */
  kind: 'missing' | 'behavior-gap' | 'table-divergence'
  detail: string
}

export interface DegradationReport {
  /** 组件原语数 */
  components: number
  /** 已声明属性数 */
  props: number
  /** 各端各态计数 */
  counts: Record<DegradationEnd, Record<DegradationTier, number>>
  /** fallback 已声明可观察行为数 / 需要行为数（反黑盒） */
  behaviorDeclared: number
  behaviorNeeded: number
  issues: DegradationIssue[]
  ok: boolean
}

/**
 * 降级门禁（EA-5）：
 *  ① 每个 props 里的属性都必须在降级表中有声明（缺格 = 违反 EA-5，对齐 03 §3「不允许空白格」）；
 *  ② 任一端为 fallback/unsupported 时必须有 behavior（可观察降级行为，§4 反黑盒）——
 *     「只有状态、无行为」视为不诚实降级，判 FAIL。
 *
 * ★作用域（诚实说明）：默认审计 PRIMITIVE_CATALOG 的组件原语属性（62 组件）。
 *   组件库实际有 73 个 p-* 组件（`packages/components/*`）——其中 11 个（p-button、p-view、
 *   p-scroll-view、p-nav-bar、p-list-view、p-safe、p-sidebar、p-location、p-pick-photo、
 *   p-scan-qr、p-svg-canvas）尚未登记进 catalog。传 `extraSpecs` 可把这批也纳入审计，
 *   由 CLI 脚本（scripts/audit-degradation.mjs）从组件源码提供，从而与端对齐标尺同口径（全 73 组件）。
 */
export function auditDegradation(extraSpecs?: Array<{ tag: string; props: string[] }>): DegradationReport {
  const issues: DegradationIssue[] = []
  const counts: Record<DegradationEnd, Record<DegradationTier, number>> = {
    mp: { supported: 0, fallback: 0, unsupported: 0 },
    web: { supported: 0, fallback: 0, unsupported: 0 },
  }
  let props = 0
  let components = 0
  let behaviorDeclared = 0
  let behaviorNeeded = 0

  /**
   * 待审计的 (tag, props[])。
   * ★2026-09-18 修正（批次外收口实测发现）：**优先用 extraSpecs（组件源码）**，仅在无源码规格时
   *   回退 catalog 的 props。此前实现是「catalog 优先、extraSpecs 只补 catalog 没有的 tag」——
   *   而 catalog 的 props 与组件源码**存在历史脱节**（如 p-input 在 catalog 记 4 项而源码 26 项），
   *   导致 catalog 内 62 个 tag 的降级审计**基于陈旧属性表**，源码新增属性对门禁不可见
   *   （实测：p-input 新增 14 项后总属性数只从 417→418，暴露此缺陷）。
   *   组件属性的**真值来源是源码** defineProps（与端对齐标尺 audit-component-attrs 同口径）。
   */
  const specs: Array<{ tag: string; props: string[] }> = []
  const sourceByTag = new Map((extraSpecs ?? []).map((s) => [s.tag, s.props]))
  const emitted = new Set<string>()
  for (const prim of PRIMITIVE_CATALOG) {
    if (!prim.tag) continue
    // 源码优先（真值）；catalog 仅作无源码时的回退
    specs.push({ tag: prim.tag, props: sourceByTag.get(prim.tag) ?? prim.props ?? [] })
    emitted.add(prim.tag)
  }
  for (const s of extraSpecs ?? []) {
    if (emitted.has(s.tag)) continue
    specs.push({ tag: s.tag, props: s.props })
    emitted.add(s.tag)
  }

  for (const { tag, props: propList } of specs) {
    components++
    for (const p of propList) {
      props++
      // 逐属性按**规则**判定（degradeProp 是唯一判定来源）。
      // ★2026-09-18 修正：此前用 DEGRADATION_TABLE[tag][prop] 做「空白格检查」，但 DEGRADATION_TABLE
      //   由 catalog props 构建，与组件源码 props 脱节 → 源码属性被误报「未声明」（172 项假红）。
      //   且该检查本身是循环的（表由同一批 props 生成，不可能遗漏）——属「按构造必然通过」的假检查。
      //   现在改为：审计恒用规则判定（完整、可证伪），并另设「表↔规则一致性」检查（见下）捕获真实漂移。
      const entry = degradeProp(tag, p)
      counts.mp[entry.mp]++
      counts.web[entry.web]++
      const needsBehavior = entry.mp !== 'supported' || entry.web !== 'supported'
      if (needsBehavior) {
        behaviorNeeded++
        if (entry.behavior && entry.behavior.trim().length > 0) behaviorDeclared++
        else {
          issues.push({
            tag,
            prop: p,
            kind: 'behavior-gap',
            detail: `声明了 ${entry.mp === 'supported' ? '' : `mp:${entry.mp} `}${entry.web === 'supported' ? '' : `web:${entry.web}`} 但无 behavior（降级须可观察，§4 反黑盒）`,
          })
        }
      }
    }
  }

  // ★表 ↔ 规则一致性：DEGRADATION_TABLE（对外导出、编译器消费）与其构建规则 degradeProp 必须同判定。
  //   捕获「规则改了但表未同步构建」「表被手工编辑」等真实漂移（这才是有效的完整性检查）。
  for (const [tag, table] of Object.entries(DEGRADATION_TABLE)) {
    for (const [prop, entry] of Object.entries(table)) {
      const fresh = degradeProp(tag, prop)
      if (fresh.mp !== entry.mp || fresh.web !== entry.web) {
        issues.push({
          tag,
          prop,
          kind: 'table-divergence',
          detail: `DEGRADATION_TABLE=${entry.mp}/${entry.web} 与规则判定=${fresh.mp}/${fresh.web} 不一致（表须由规则构建）`,
        })
      }
    }
  }

  return { components, props, counts, behaviorDeclared, behaviorNeeded, issues, ok: issues.length === 0 }
}

/** 人类可读报告 */
export function formatDegradationReport(r: DegradationReport): string {
  const lines = [
    `降级声明覆盖：${r.components} 组件 / ${r.props} 属性`,
    `  mp  端：supported ${r.counts.mp.supported} · fallback ${r.counts.mp.fallback} · unsupported ${r.counts.mp.unsupported}`,
    `  web 端：supported ${r.counts.web.supported} · fallback ${r.counts.web.fallback} · unsupported ${r.counts.web.unsupported}`,
    `  fallback 可观察行为：${r.behaviorDeclared}/${r.behaviorNeeded}`,
  ]
  if (r.issues.length) {
    lines.push(`  ❌ ${r.issues.length} 项问题：`)
    for (const i of r.issues.slice(0, 20)) lines.push(`    - [${i.tag}] ${i.prop}：${i.detail}`)
    if (r.issues.length > 20) lines.push(`    …另有 ${r.issues.length - 20} 项`)
  }
  return lines.join('\n')
}

/* ---------- 编译期诊断（M6：PROP_NO_DEGRADATION） ---------- */

/** 编译期诊断码（对齐 03-degradation-tiers.md §6） */
export const PROP_NO_DEGRADATION = 'PROP_NO_DEGRADATION'

export interface PropDiagnostic {
  code: typeof PROP_NO_DEGRADATION
  tag: string
  prop: string
  end: DegradationEnd
  message: string
}

/**
 * ★M6 编译期门禁：目标端**无法实现**的属性被业务侧使用时产生 fail-closed 诊断。
 * 依据 03-degradation-tiers.md §2「unsupported = 本端无法实现 → 编译期警告/报错（fail-closed）」与 §6。
 *
 * `fallback` **不**产生诊断——降级是有意的可观察行为（行为已在表中声明）；
 * 只有 `unsupported` 才是「无论如何都会静默失败」，必须由编译器拦住。
 *
 * @param table 可选降级表（缺省 = 模块级 DEGRADATION_TABLE）。注入用以便测试无 unsupported 现状下的诊断路径。
 * @returns 命中 unsupported 时返回诊断；否则 null。
 */
export function checkPropDegradation(
  tag: string,
  prop: string,
  end: DegradationEnd,
  table: Record<string, DegradationMap> = DEGRADATION_TABLE,
): PropDiagnostic | null {
  const entry = table[tag]?.[prop]
  if (!entry) return null // 未声明属性由 auditDegradation 的「空白格」门禁负责，非本诊断职责
  if (entry[end] !== 'unsupported') return null
  return {
    code: PROP_NO_DEGRADATION,
    tag,
    prop,
    end,
    message:
      `[${PROP_NO_DEGRADATION}] <${tag}> 的属性 "${prop}" 在 ${end} 端为 unsupported（本端无法实现）` +
      `——继续使用会静默失败（违反 G-31.2）。请改用 @conditional 显式分支或移除该属性。`,
  }
}

/** 扫描一个元素的全部属性，返回所有 unsupported 诊断（供编译器批量收集） */
export function collectPropDiagnostics(
  tag: string,
  props: string[],
  end: DegradationEnd,
  table: Record<string, DegradationMap> = DEGRADATION_TABLE,
): PropDiagnostic[] {
  const out: PropDiagnostic[] = []
  for (const p of props) {
    const d = checkPropDegradation(tag, p, end, table)
    if (d) out.push(d)
  }
  return out
}

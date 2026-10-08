// packages/contracts/src/layers.ts
// ★★LY0（2026-10-02）：**页面层级契约**——四层语义模型 + 跨端映射表（单一来源）
//
// 【依据】《Proteus 页面层级规范与多端一致性方案》§3（采用 WeUI 四层**语义模型**，
//   **不采用其数值**——数值各端语义不同，直接搬 1000/100/10/1 没有意义）。
//
// 【为什么语义化而不是数值】（规范 §3.1 三条理由）
//   ① 数值无跨端意义：CSS 的 z-index 需要 position 上下文、鸿蒙 zIndex 不跨容器、
//      Android elevation 会带阴影、iOS 层序由 sublayer 顺序决定——同一个 1000 语义不同；
//   ② 数值是收敛模型的漏洞：任意数值 = 又一个逃生口（会毁掉 conformance 与 AI 可校验）；
//   ③ 语义可编译期校验：能判「Popout 在 Content 之下」「Mask 单独使用」这类结构错误，数值不能。
//
// 【本文件的定位】**唯一事实来源**：编译期校验（LY1）、各端映射（LY2）、
//   一致性校验（LY6）都从这里取值——三处各写一份必分叉（本仓铁律 #9 同源）。
//
// 【零运行时依赖】（与 contracts/style.ts 同款）——纯数据 + 纯类型，可被编译期与运行时共用。

/**
 * 层级原语（**封闭集**，规范 §3.2）。
 * ★不可扩展（规范 §3.5）：新增层 = 改规范 + 改本文件 + 改映射表（三处一处不可少）。
 * ★`layer-transition` **不在开发者可用集合内**（框架内部——转场用，规范 §4.6），
 *   它由宿主在转场期间内部提升/复位，开发者声明它会被编译期拒绝（见 LY0_FORBIDDEN_LAYERS）。
 */
export const LAYER_PRIMITIVES = ['layer-content', 'layer-navigation', 'layer-mask', 'layer-popout'] as const

export type LayerPrimitive = (typeof LAYER_PRIMITIVES)[number]

/** 各端标识（与 style-safety 的 StylePlatform 同源取值 + 端内细分） */
export type LayerPlatform = 'web' | 'mp-skyline' | 'mp-webview' | 'android' | 'ios'

/**
 * 层级映射值（**各端内部常量**，规范 §3.4 映射表的机器可读形态）。
 *
 * 【诚实边界（重要）】本表是**目标映射**——其中 `android.translationZ` 与 `ios.zPosition`
 *   的「真源」当前是**树序**（本仓内核尚无 zOrder 字段，层序 = 声明顺序）；
 *   本表的数值供**未来内核接入 zOrder 时**使用，以及 web/mp 端**现在就可直接生效**
 *   （CSS z-index：layer-content=1 / navigation=10 / mask=100 / popout=1000）。
 *   ⇒ 「映射表存在的意义」当前 = ① 编译期语义校验的基准；② web/mp 实际生效值；
 *     ③ 内核接入时的既定契约（不是"已全端生效"——那是不实表述）。
 *   ★Android 用 `translationZ` 不用 `elevation`：后者会**同时产生阴影**（规范 §4.4）。
 */
export interface LayerMapping {
  /** CSS z-index 值（web / mp；需配合 position ≠ static——规范 §4.3） */
  cssZIndex: number
  /** HarmonyOS ArkUI `.zIndex()` 值（规范 §3.4；鸿蒙端待落地，值先定契约） */
  harmonyZIndex: number
  /** Android `translationZ`（**不是** elevation——规范 §4.4） */
  androidTranslationZ: number
  /** iOS `layer.zPosition` */
  iosZPosition: number
}

/**
 * 跨端映射表（规范 §3.4 的机器可读形态；**数值由框架内部常量定义，不暴露给开发者**）。
 * ★区间下沿（Content 1 / Navigation 10 / Mask 100 / Popout 1000）——同层内由**声明顺序**
 *   与**弹层栈**决定先后（规范 §3.3；栈见 §6），不在这里再分档。
 * ★Popout 的栈偏移：弹层栈深度 d 的分配值是 `layer-popout` 基值 + d
 *   （见 `popoutStackValue`——栈管理器唯一可用的推导入口，开发者不可指定）。
 */
export const LAYER_MAPPING: Record<LayerPrimitive, LayerMapping> = {
  'layer-content': { cssZIndex: 1, harmonyZIndex: 1, androidTranslationZ: 0, iosZPosition: 0 },
  'layer-navigation': { cssZIndex: 10, harmonyZIndex: 10, androidTranslationZ: 10, iosZPosition: 10 },
  'layer-mask': { cssZIndex: 100, harmonyZIndex: 100, androidTranslationZ: 100, iosZPosition: 100 },
  'layer-popout': { cssZIndex: 1000, harmonyZIndex: 1000, androidTranslationZ: 1000, iosZPosition: 1000 },
}

/** 各端取值（一致性校验用：同一原语在任一端取同一语义键） */
export function layerValueFor(layer: LayerPrimitive, platform: LayerPlatform): number {
  const m = LAYER_MAPPING[layer]
  switch (platform) {
    case 'web':
    case 'mp-skyline':
    case 'mp-webview':
      return m.cssZIndex
    case 'android':
      return m.androidTranslationZ
    case 'ios':
      return m.iosZPosition
    default:
      return m.cssZIndex
  }
}

/**
 * 弹层栈值（规范 §6.2）：栈深 d（0 基）→ `layer-popout` 基值 + d。
 * ★为什么必须有栈（规范 §4.5 的已知实证）：WeUI 的 actionSheet 用**固定 z-index**，
 *   嵌套/快速连点时会**后弹的被先弹的遮挡**——固定数值无法表达栈序。
 * ★调用点唯一：栈管理器（LY3）。开发者不可指定层级（规范 §6.3）。
 */
export function popoutStackValue(stackDepth: number): number {
  if (!Number.isInteger(stackDepth) || stackDepth < 0) {
    throw new Error(`popoutStackValue: 栈深必须是非负整数（收到 ${String(stackDepth)}）`)
  }
  return LAYER_MAPPING['layer-popout'].cssZIndex + stackDepth
}

/** 弹层栈深上限（规范 §6.2 硬约束：超过 ⇒ 报错，防递归弹层把值推向溢出） */
export const POPOUT_STACK_LIMIT = 16

/* ═══════════════════════════════════════════════════════════════════════════
 * ★★★批 A④（2026-10-08 · 决策 #658）：**z-index 数值 → 语义层区间映射**（用户选定策略）。
 *
 * 【为什么需要（缺口实证）】`:style` 内联裸 z-index 被 LY001 拦（规范 §3.5 立场不变），
 *   但**类样式**（`<style>` 块 / CSS 文件）里的 z-index 是**合法且语料在用**的写法
 *   （superapp 66 处：路由层叠 z:0/1/2 · Tab 栏 z:2/3 · 壳骨架 1.5e6）——
 *   而 App 三端此前**静默丢**（折叠面无该字段、applier drop、宿主无 z 序）⇒ Web/MP 正常、
 *   App 端按声明序画（碰巧对时才看起来对）。
 *
 * 【映射口径（规范 §3.4 区间表，机器可读形态）】数值落在哪个区间 = 该元素属于哪个**语义层**：
 *   `1–9` content · `10–99` navigation · `100–999` mask · `1000+` popout。
 *   ★**区间内保留数值序**（这正是 Web 行为：100 < 1000 ⇒ 数值越大越靠上；
 *     1 < 2 ⇒ 同层内数值序）——映射的用途是①诊断/迁移指引（"你写的 1000 是 Popout 语义，
 *     可改用 layer="popout" 获得跨端层容器语义"）②越界拦截（负值/异常大值）。
 *   ★**跨容器不生效**（与 CSS stacking context 一致）：z-index 只重排**同一父节点内**的兄弟
 *     绘制序——实现见三端宿主（宿主层排序，内核零改动；树序仍是缺省真源）。
 *
 * 【诚实边界（v1 具名）】
 *   · 负 z-index 不在支持面（CSS 的负 z 呈现在容器背景**之后**——各端自绘管线无"容器背景层
 *     与子内容分层"概念，收紧为**不支持并诊断**，不静默当 0）；
 *   · `z-index: auto` = 未声明（按声明序参与，与 CSS 同语义）；
 *   · stacking context 的完整语义（父 z 隔离子 z、opacity/transform 创建新上下文）**不实现**——
 *     v1 语义 = "同父兄弟按 (z, 声明序) 稳定排序"，覆盖语料全部形态（绝对定位兄弟层叠）。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 语义层区间（含下沿、不含上沿；popout 上界为 `Z_INDEX_MAX`） */
export const Z_INDEX_RANGES: ReadonlyArray<{ layer: LayerPrimitive; min: number; maxExclusive: number | null }> = [
  { layer: 'layer-content', min: 1, maxExclusive: 10 },
  { layer: 'layer-navigation', min: 10, maxExclusive: 100 },
  { layer: 'layer-mask', min: 100, maxExclusive: 1000 },
  { layer: 'layer-popout', min: 1000, maxExclusive: null },
]

/**
 * 数值上沿（越界诊断用；不拦截编译——框架自身在挂载层域用到 1.5e6 级别，
 * 该值是**壳骨架**的内部用法，业务代码超此值提示"疑似异常"）。
 */
export const Z_INDEX_MAX = 100_000

export interface ZIndexVerdict {
  /** 合法（v1 支持面内：n ≥ 0 的有限数） */
  ok: boolean
  /** 映射到的语义层（0 归 content——CSS 里 z:0 与正 z 同属"定位层序"） */
  layer: LayerPrimitive
  /** 层内序（区间内偏移；0 与 auto 归 0） */
  inLayerRank: number
  /** 不合法原因（ok=false 时给人类可读理由；调用方决定 severity——本仓编译期用诊断不阻断） */
  reason?: string
  /** 迁移指引（诊断用；语义层非 content 时提示可改用 layer= 属性获得跨端层容器语义） */
  hint?: string
  /** 疑似异常值（ok=true 但超 Z_INDEX_MAX——**仍然发射**（排序权重本身有效），仅诊断提示） */
  suspicious?: boolean
}

/**
 * 数值 → 语义层判定（**唯一判据**：编译器折叠面 / 宿主 / 诊断共用，铁律 #9 同源）。
 *
 * @param n 解析出的 z-index 数值（应为整数；非整数先四舍五入——CSS 里 z-index 取整）
 */
export function zIndexOf(n: number): ZIndexVerdict {
  if (!Number.isFinite(n)) {
    return { ok: false, layer: 'layer-content', inLayerRank: 0, reason: `z-index 非有限数（收到 ${String(n)}）` }
  }
  const v = Math.round(n)
  if (v < 0) {
    return {
      ok: false,
      layer: 'layer-content',
      inLayerRank: 0,
      reason: `负 z-index（${v}）不在 App 支持面（CSS 负 z 呈现在容器背景之后——自绘管线无该分层概念）`,
      hint: '改用正数（1 起）表达层序；确需"垫底"请调整声明顺序',
    }
  }
  if (v > Z_INDEX_MAX) {
    return {
      ok: true,
      layer: 'layer-popout',
      inLayerRank: v - 1000,
      suspicious: true,
      reason: `z-index ${v} 超出 ${Z_INDEX_MAX}（疑似异常值；框架壳骨架的内部用法除外）`,
      hint: '业务层序用 1–1000 区间（content 1-9 / navigation 10-99 / mask 100-999 / popout 1000+）',
    }
  }
  // 区间查表（v=0 与 auto 同档 ⇒ content 层内 0）
  for (const r of Z_INDEX_RANGES) {
    if (v >= r.min && (r.maxExclusive === null || v < r.maxExclusive)) {
      const rank = v - r.min
      const hint =
        r.layer === 'layer-content'
          ? undefined
          : `数值 ${v} 落在 ${r.layer.slice('layer-'.length)} 语义区间——需要跨端层容器语义时可用 \`layer="${r.layer}"\` 声明`
      return { ok: true, layer: r.layer, inLayerRank: rank, ...(hint ? { hint } : {}) }
    }
  }
  // v === 0
  return { ok: true, layer: 'layer-content', inLayerRank: 0 }
}


/**
 * `layer` 属性的**合法值集合**（编译期校验用）。
 * ★`layer-transition` 是**框架内部层**（规范 §4.6：高于 popout、转场期间由宿主提升、
 *   结束必须复位）——开发者声明它 ⇒ 编译期拒绝（不是"允许但效果看端"）。
 */
export const LAYER_ATTR_VALUES = LAYER_PRIMITIVES

/** 框架内部保留层名（开发者不可用；编译期拒绝并给出替代指引） */
export const LAYER_RESERVED = ['layer-transition'] as const

/** WeUI 层语义描述（**对外表述与文档用**；规范 §5：说"遵循 WeUI 层级模型"，
 *  不说"用了 WeUI 的 z-index"——我们不用数值） */
export const LAYER_SEMANTICS: Record<LayerPrimitive, { weui: string; zh: string }> = {
  'layer-content': { weui: 'Content', zh: '内容层：承载页面主要内容' },
  'layer-navigation': { weui: 'Navigation', zh: '导航层：固定导航（navbar/吸顶栏/tabbar），滑动内容时保持不动' },
  'layer-mask': { weui: 'Mask', zh: '蒙层：配合 Popout 使用，锁定下层交互（不可单独使用）' },
  'layer-popout': { weui: 'Popout', zh: '弹出层：弹窗/操作菜单/Toast/表单报错等' },
}

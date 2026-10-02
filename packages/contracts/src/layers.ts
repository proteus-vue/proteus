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

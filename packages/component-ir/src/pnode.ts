// packages/component-ir/src/pnode.ts
// ★★M0（App 端高性能渲染 · IR 扩展）：**渲染 IR（PNode）**——语义 IR 之下的「怎么画」层。
//
// 为什么需要单独一层（与既有 IR 的关系）：
//   · `ComponentIR`（schema.ts）= **语义层**：p-view → layout.box（是什么）
//   · `IRNode`（render-backend/spi.ts）= **后端消费的运行时节点**（props 仍是任意 Record）
//   · **`PNode`（本文件）= 渲染层**：样式已**归一化 + 单位已折叠**、携带编译期判定的 flags
//     ——它是 NativeVapor 后端（C++ 排版核心 / 平台绘制层）的输入契约。
//
// ★设计纪律（对齐本仓「同数据两形态」惯例，见 compiler/src/ir/build.ts）：
//   本层是**新增**的，不修改 ComponentIR/IRNode 的既有形状——既有五后端零影响
//   （计划 §11.3「IR 扩展不得破坏既有五后端」）。
//
// ★与 CSS Profile 的关系：PProps 就是 `Proteus_CSS_Profile规格.md` §4.5 的 `ComputedStyle`——
//   样式在**编译期**完成折叠（解析/层叠/继承/单位换算），运行时零解析（Profile §8.3 门禁）。
//
// ★与已核实的内存/性能实测的关系（本层承载这些结论，见 proteus-performance-plan/10-ios-memory.md）：
//   · `PaintHint.isMonochrome` → 文本层可用紧凑 `contentsFormat`（实测 −39% 内存）
//   · `PaintHint.isPureBackground` → 纯色背景走 `backgroundColor` 通道（不分配 backing store）
//   · `PFlags.flattenEligible` → **拍平是主路径**（实测 −91% 内存 / −32% 耗时）
//   · `PaintHint.needsCompositingLayer` → L3 特性（z-index/fixed/filter/shadow）会各占一块
//     backing store，须计入合成层预算（CSS Profile §6 强制联动）

/** 渲染节点类型（比语义层粗——绘制层只区分「怎么画」） */
export type PKind =
  /** 盒子（背景/边框/圆角——可含子节点） */
  | 'view'
  /** 文本（单个文本节点，内容来自 text-content 槽或静态字面量） */
  | 'text'
  /** 图像 */
  | 'image'
  /** 列表（复用池管理，M3） */
  | 'list'
  /** 富文本（平台文本引擎，L4） */
  | 'rich-text'
  /** 原生组件宿主（map/webview/广告——必须原生嵌入，CSS Profile §0.2 非目标） */
  | 'native-host'

/**
 * 归一化长度（**单位已在编译期折叠**——运行时不做单位换算，Profile §3.2）。
 * · `absolute`：px → dp（App 端 1px = 1dp；密度缩放由平台层处理）
 * · `ratio`：`%` / `vw` / `vh` / `rpx` / `em` / `rem` → 保留比例系数 + 基准，运行时按基准求值
 */
export type ResolvedLength =
  | { kind: 'absolute'; dp: number }
  | {
      kind: 'ratio'
      ratio: number
      base: 'parentWidth' | 'parentHeight' | 'viewportWidth' | 'viewportHeight' | 'fontSize' | 'rootFontSize'
    }

/** 四边值（margin / padding / border-radius 等） */
export interface Edges<T> {
  top: T
  right: T
  bottom: T
  left: T
}

/** 布局属性（flex 为主——Profile L2；grid 待定，不在此层） */
export interface LayoutProps {
  display?: 'flex' | 'none' | 'block' | 'inline-block'
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse'
  justifyContent?: string
  alignItems?: string
  alignSelf?: string
  alignContent?: string
  flexGrow?: number
  flexShrink?: number
  flexBasis?: ResolvedLength | 'auto'
  gap?: ResolvedLength
  rowGap?: ResolvedLength
  columnGap?: ResolvedLength
  width?: ResolvedLength
  height?: ResolvedLength
  minWidth?: ResolvedLength
  maxWidth?: ResolvedLength
  minHeight?: ResolvedLength
  maxHeight?: ResolvedLength
  margin?: Partial<Edges<ResolvedLength>>
  padding?: Partial<Edges<ResolvedLength>>
  /** ★fixed / sticky 属 L3（独立合成层）——此处只接受 static/relative/absolute（Profile L2） */
  position?: 'static' | 'relative' | 'absolute'
  top?: ResolvedLength
  right?: ResolvedLength
  bottom?: ResolvedLength
  left?: ResolvedLength
  overflow?: 'visible' | 'hidden' | 'scroll' | 'auto'
}

/** 2D 变换（L1）。3D 变换属 L3（会创建合成层）——由 diagnostics 拦下 */
export interface Transform2D {
  translateX?: number
  translateY?: number
  scale?: number
  rotate?: number
}

/** 绘制属性 */
export interface PaintProps {
  backgroundColor?: string
  /** 线性渐变（Profile L1；实测 Skyline 亦接受该属性） */
  backgroundImage?: string
  borderRadius?: Partial<Edges<ResolvedLength>>
  borderWidth?: Partial<Edges<ResolvedLength>>
  borderColor?: string
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none'
  opacity?: number
  transform?: Transform2D
}

/** 文本属性（**字体族/BiDi/emoji 均不在本层**——L4 复用平台文本栈，Profile §L4） */
export interface TextProps {
  fontSize?: ResolvedLength
  fontWeight?: number | 'normal' | 'bold'
  lineHeight?: ResolvedLength | number
  letterSpacing?: ResolvedLength
  color?: string
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  /** 截断行数（依赖平台文本度量——Profile L2 标 🟡） */
  maxLines?: number
  textOverflow?: 'clip' | 'ellipsis'
  whiteSpace?: 'normal' | 'nowrap' | 'pre-wrap'
}

/**
 * 绘制提示（编译期推导，**禁止运行时判断**——Profile §12.4）。
 * 每一条都对应一条已实测的绘制/内存策略：
 * · `isMonochrome`：单色内容（纯色文本/纯色块）→ 可用紧凑 backing store 格式（**实测 −39%**）
 * · `isPureBackground`：只有背景色、无其它绘制 → 走 backgroundColor 通道（**不分配 backing store**）
 * · `staticSubtree`：整棵子树无动态绑定 → 可拍平 / 可光栅化缓存
 * · `needsCompositingLayer`：L3 特性（z-index / fixed / filter / shadow / 3D）→ 各占一块 backing store
 * · `shareableContent`：可共享图形的资源标识（同图多层共享内存，M2 消费）
 */
export interface PaintHint {
  isMonochrome: boolean
  isPureBackground: boolean
  staticSubtree: boolean
  needsCompositingLayer: boolean
  shareableContent?: string
}

/** 归一化后的属性集（= CSS Profile §4.5 的 ComputedStyle 的渲染子集） */
export interface PProps {
  layout: LayoutProps
  paint: PaintProps
  text?: TextProps
  paintHint: PaintHint
}

/** 编译期判定的节点标志（供后端/代码生成直接消费，运行时零判断） */
export interface PFlags {
  /** 整棵子树无动态绑定（**含自身与所有后代**） */
  isStatic: boolean
  /**
   * 可拍平（编译期判定，见 D4 与 §12.3）——
   * 判定条件：kind ∈ view/text/image ∧ 无事件 ∧ 无 transform ∧ 非动画目标 ∧ 非自定义组件根
   *          ∧ 静态子树 ∧ 不创建合成层
   */
  flattenEligible: boolean
  /** 布局边界：自身尺寸变化不影响父级（可跳过向上传播重排） */
  isLayoutBoundary: boolean
  hasEvent: boolean
  isNativeHost: boolean
}

/** 渲染节点（稳定整数 id——编译期分配，非字符串，便于二进制序列化） */
export interface PNode {
  id: number
  kind: PKind
  /** 语义标签（诊断用——`layout.box` / `ui.text`；不参与绘制决策） */
  semantic?: string
  props: PProps
  children: PNode[]
  flags: PFlags
  /** 文本节点的静态字面量（动态文本走 bindings 的 text-content 槽） */
  text?: string
  /** 源码定位（诊断/trace 用） */
  source?: { tag: string; line?: number }
}

/** 动态绑定更新种类（运行时按种类走特化写值函数，避免运行时类型判断） */
export type UpdateKind = 'attr' | 'style' | 'text-content' | 'list-data' | 'visibility'

/** 动态绑定（编译期分配的槽位——运行时只「按槽位写值」，**不存在 VNode diff**，D1） */
export interface DynamicBinding {
  /** 槽位索引（编译期连续分配） */
  slotId: number
  /** 目标节点 id */
  nodeId: number
  /** 目标属性键（归一化名，如 `text.color` / `layout.width`） */
  propKey: string
  /** 更新表达式标识（指向编译期生成的更新表达式） */
  exprId: string
  updateKind: UpdateKind
}

/** 编译期诊断（Profile「超出 Profile 即编译期报错，不留到运行时静默降级」） */
export interface PDiagnostic {
  severity: 'error' | 'warn'
  code: string
  message: string
  /** 源码定位（tag / 行号） */
  nodeId?: number
  source?: { tag: string; line?: number }
}

/** 渲染 IR 树（M0 产物；M1/M2 将其序列化为 LayoutTemplate + PatchTable） */
export interface PTree {
  roots: PNode[]
  bindings: DynamicBinding[]
  diagnostics: PDiagnostic[]
  /** 统计（trace / perf-ratchet 消费） */
  stats: {
    /** 节点总数 */
    nodeCount: number
    /** 可拍平节点数（拍平率 = flattenable / nodeCount） */
    flattenableCount: number
    /** 需合成层的节点数（预算监控） */
    compositingCount: number
  }
}

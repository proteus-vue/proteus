// packages/layout-core/src/types.ts
// ★★M1（App 端高性能渲染 · 排版核心）：**布局核心的类型契约**。
//
// 定位：`layout-core` 是「渲染 IR（PNode）→ 布局结果（几何）」的求解器。
//   · M1（当前）：**Node 侧参考实现**（纯 TS、零依赖、可单测、可进 CI）——先证明布局正确性
//   · M2+：移植到 C++（三端共享），本参考实现作为**语义基准**（Golden 对拍）
//   ★为何先 Node 后 C++（用户已确认）：坑位 #9「不要提前优化」——
//     布局正确性未达标时谈性能无意义；Node 侧的反馈环最快（单测毫秒级），
//     且能与既有 VueDom 后端**逐像素对拍**（出口条件）。
//
// ★设计依据（`Proteus_App端高性能渲染落地方案.md`）：
//   · D2 排版核心跨端共享：布局算法与平台无关 → 本层不引用任何平台 API
//   · D3 布局协议约束：**约束自顶向下、尺寸自底向上、严格单次测量**（禁父子多轮 measure）
//   · §5.3 性能硬约束：单次测量 · 无运行时字符串解析 · 节点分配池化 · 文本度量可缓存
//
// ★与 CSS Profile 的关系：输入是 `PNode.props.layout`（已归一化、单位已折叠），
//   故本层**不做任何 CSS 解析/单位换算**（Profile §8.3 门禁「运行时零解析」）。

/** 尺寸（布局结果——逻辑像素 dp） */
export interface Size {
  width: number
  height: number
}

/** 矩形（节点在坐标系中的位置与尺寸） */
export interface Rect extends Size {
  x: number
  y: number
}

/** 边距（已折叠为绝对值；`ratio` 由调用方在传入前解算——见 resolveEdges） */
export interface EdgeValues {
  top: number
  right: number
  bottom: number
  left: number
}

/** 布局约束（自顶向下传入） */
export interface Constraints {
  /** 可用宽（NaN = 不约束，由内容决定） */
  availableWidth: number
  /** 可用高（NaN = 不约束） */
  availableHeight: number
  /**
   * 是否为**紧约束**（父级强制尺寸——如 `width: 100%`）。
   * 紧约束下子节点必须等于 available*；松约束下子节点可取更小值（内容自适应）。
   */
  tightWidth: boolean
  tightHeight: boolean
}

/** 布局节点（与 PNode 一一对应——由布局核心构建，携带求解中间态） */
export interface LayoutNode {
  /** 对应 PNode.id（稳定整数——便于与渲染 IR/指令流对账） */
  id: number
  /** 语义/诊断标签 */
  tag: string
  /* ── 输入（来自 PNode.props.layout，已归一化） ── */
  width?: number | 'auto'
  height?: number | 'auto'
  /**
   * ★百分比尺寸：**必须由求解器解析，不能在适配层解析**。
   * CSS 语义：`width: 50%` 的基准是父级**内容盒**（不含父 padding），而适配层拿不到父的最终内容盒
   * （父尺寸本身可能还要等布局/拉伸）。故适配层只留下比例，由求解器在已知父内容盒时解算。
   */
  widthRatio?: number
  heightRatio?: number
  /** flex-basis 的百分比形式（同上：基准 = 父内容盒主轴尺寸） */
  flexBasisRatio?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  margin: EdgeValues
  padding: EdgeValues
  /** 主轴方向 */
  flexDirection: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  flexWrap: 'nowrap' | 'wrap' | 'wrap-reverse'
  justifyContent: string
  alignItems: string
  alignSelf?: string
  alignContent?: string
  flexGrow: number
  flexShrink: number
  flexBasis?: number | 'auto'
  gap: number
  rowGap?: number
  columnGap?: number
  display: 'flex' | 'none' | 'block' | 'inline-block'
  position: 'static' | 'relative' | 'absolute'
  top?: number
  right?: number
  bottom?: number
  left?: number
  overflow: 'visible' | 'hidden' | 'scroll' | 'auto'
  /** 文本度量钩子（叶子节点：由调用方注入的平台文本度量；无则视为空内容） */
  measureText?: (maxWidth: number) => Size
  /** 该节点是否可拍平（M0 判定结果——**布局仍然要算**，只是不产生独立绘制对象；见计划 D4） */
  flattenEligible?: boolean
  /* ── 输出（求解后填充） ── */
  rect?: Rect
  /** 内容盒尺寸（不含 margin） */
  contentSize?: Size
  children: LayoutNode[]
  parent?: LayoutNode
  /** 脏标记（M1-3：最小重排）——自身尺寸需重算 */
  dirty?: boolean
  /**
   * 子树内含脏节点（M1-3）——祖先**尺寸可能不变**（边界之内），但**必须被遍历到**，
   * 否则脏节点到达不了。故与 `dirty` 分开：一个是「要算」，一个是「要走到」。
   */
  hasDirtyDescendant?: boolean
  /**
   * 上次测量所用约束（M1-3 布局边界）——作用域重排时复用它，
   * 使「只重排边界子树」与「全量重排」结果**逐像素等价**。
   */
  lastConstraints?: Constraints
  /**
   * 布局边界（§5.4，M1 出口条件 T2）：自身尺寸与子级无关（宽高均为显式值）。
   * 语义：边界内的变更**不可能改变边界的对外尺寸** → 重排范围可收窄到边界子树。
   */
  isLayoutBoundary?: boolean
}

/** 布局诊断（Profile「编译期/求解期可诊断」） */
export interface LayoutDiagnostic {
  severity: 'error' | 'warn'
  code: string
  message: string
  nodeId?: number
}

/** 布局结果（含统计——perf-ratchet / trace 消费） */
export interface LayoutResult {
  /** id → 绝对矩形（已含 padding/margin 偏移） */
  rects: Map<number, Rect>
  diagnostics: LayoutDiagnostic[]
  stats: {
    /** 参与求解的节点数 */
    nodeCount: number
    /** **测量调用次数**（单次测量的判据：应 ≈ nodeCount，远小于多轮 measure 的实现） */
    measureCalls: number
    /** 命中度量缓存的次数（M1-3 增量重排的读数：未变子树不下钻） */
    measureReused: number
    /** 精化测量次数（主轴尺寸变化后对子树的二次排布）——每节点至多一次，故 measureCalls ≤ 2×nodeCount */
    refineCalls: number
    /** 发生重排的节点数（脏区域传播结果） */
    relayoutCount: number
  }
}

/** 无约束哨兵（`NaN` 表达「由内容决定」——避免用 -1/Infinity 这类易误判的值） */
export const UNBOUNDED = Number.NaN

/** 是否无约束 */
export function isUnbounded(v: number): boolean {
  return Number.isNaN(v)
}

/** 紧约束构造（父级强制尺寸） */
export function tight(width: number, height: number): Constraints {
  return { availableWidth: width, availableHeight: height, tightWidth: true, tightHeight: true }
}

/** 松约束构造（子级可小于可用尺寸） */
export function loose(width = UNBOUNDED, height = UNBOUNDED): Constraints {
  return { availableWidth: width, availableHeight: height, tightWidth: false, tightHeight: false }
}

/** 空边距 */
export const ZERO_EDGES: EdgeValues = { top: 0, right: 0, bottom: 0, left: 0 }

/** 数值夹取（NaN 安全——无约束时不夹取） */
export function clampSize(v: number, min?: number, max?: number): number {
  let out = v
  if (min !== undefined && Number.isFinite(min)) out = Math.max(out, min)
  if (max !== undefined && Number.isFinite(max)) out = Math.min(out, max)
  return out
}

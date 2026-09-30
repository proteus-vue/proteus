// packages/animation/src/types.ts
// ★★Morpheus（MA1）—— **声明式动画的类型面**（封闭集：只有这些能声明）
//
// 【设计原则（Morpheus §4.2 / §9）】
//   · **不开放任意 JS 动画函数**——那是"在第一王炸上开口子"（与"不开放任意原生调用"同理）；
//     能声明的是**封闭集**：属性 / 曲线 / 时长 / 编排 / 协调 / 打断策略；
//   · **预设优先于参数**——开发者的真实需求是"这个列表项飞到详情页"，不是"配 spring 参数"；
//   · **合成属性在编译期判定**（§5-bis.2）——属性集 ⊆ {transform, opacity} 才可走
//     平台渲染线程零参与路径；否则**编译期报错**（不是运行时 profile 才发现掉帧）。
//
// 【与内核的关系】本包只做"声明 → 指令"，**曲线求值/物理积分不在这里**（在 Rust 内核，
//   唯一实现——见 `layout-core-rust/src/anim.rs`）。宿主侧同样零曲线数学（纪律 #22）。

/** 动画属性（封闭集；与内核 `AnimKind` 一一对应——**跨语言契约，不得改号/改名**） */
export const AnimKind = {
  TRANSLATE_X: 0,
  TRANSLATE_Y: 1,
  SCALE: 2,
  ROTATE: 3,
  OPACITY: 4,
} as const
export type AnimKindId = (typeof AnimKind)[keyof typeof AnimKind]
export type AnimKindName =
  | 'translateX'
  | 'translateY'
  | 'scale'
  | 'rotate'
  | 'opacity'

/** 名称 → 编号（编译期用；也是"名字写错"的**类型级**防线） */
export const ANIM_KIND_ID: Record<AnimKindName, AnimKindId> = {
  translateX: AnimKind.TRANSLATE_X,
  translateY: AnimKind.TRANSLATE_Y,
  scale: AnimKind.SCALE,
  rotate: AnimKind.ROTATE,
  opacity: AnimKind.OPACITY,
}

/** 曲线（与内核 `CURVE_*` 一一对应——**不得改号**） */
export const Curve = {
  LINEAR: 0,
  EASE_OUT: 1,
  EASE_IN: 2,
  EASE_IN_OUT: 3,
  /** 阻尼振荡近似（查表）；**与真弹簧不同**——需要物理语义时用 `spring` */
  SPRING_APPROX: 4,
} as const
export type CurveId = (typeof Curve)[keyof typeof Curve]
export type CurveName = 'linear' | 'easeOut' | 'easeIn' | 'easeInOut' | 'springApprox'

export const CURVE_ID: Record<CurveName, CurveId> = {
  linear: Curve.LINEAR,
  easeOut: Curve.EASE_OUT,
  easeIn: Curve.EASE_IN,
  easeInOut: Curve.EASE_IN_OUT,
  springApprox: Curve.SPRING_APPROX,
}

/** 弹簧参数（与内核 `SpringParams` 同参数化：Flutter `SpringDescription` 家族） */
export interface SpringConfig {
  stiffness: number
  damping: number
  mass?: number
}

/** 驱动方式：时间自动播放 / 外部设进度（手势跟随） */
export type DriveName = 'time' | 'progress'

/** ★MA5：**滚动窗口**（滚动位置驱动动画的区间；`to > from` 时该动画由滚动位置驱动） */
export interface ScrollWindow {
  /** 窗口起点（滚动位置，px） */
  from: number
  /** 窗口终点（滚动位置，px；必须 > from） */
  to: number
}

/** ★**单条动画声明**（封闭集的全部字段） */
export interface AnimDecl {
  /** 动哪个属性 */
  kind: AnimKindName
  /** 起点（缺省 = 节点当前值，由内核在启动时解析） */
  from?: number
  /** 终点（**必填**——动画必须有确定目标） */
  to: number
  /** 时长（毫秒；弹簧模式可省——由物理决定） */
  durationMs?: number
  /** 起始延迟（毫秒；编排/交错用） */
  delayMs?: number
  /** 查表曲线（与 `spring` 二选一；都缺省 = `easeOut`） */
  curve?: CurveName
  /** 弹簧物理（给了它就用物理积分，不是查表） */
  spring?: SpringConfig
  /** 驱动方式（缺省 `time`；给了 `scroll` 时本字段被忽略——窗口存在即说明进度来自滚动位置） */
  drive?: DriveName
  /**
   * ★MA5：滚动窗口（视差 / 吸顶 / 渐显的驱动源）
   *
   * 给了它 ⇒ 本动画**不走时间**、也**不走平台零参与路径**（进度来自滚动位置，
   * 而平台路径的语义是"按时间自主插值"——两者是不同驱动源，混用会让"跟手"变成"到点播放"）。
   * 宿主只需在滚动回调里报**原始位置**，换算在内核（`AnimEngine::seek_scroll`）。
   */
  scroll?: ScrollWindow
  /** 遇同 (节点,属性) 已有动画时是否**接管**（缺省 `true`：位置连续 + 速度移交） */
  takeover?: boolean
}

/**
 * ★**动画目标**（"对谁做"——声明与目标解耦的理由）
 *
 * 声明里**不能写死节点 id**：预设是**可复用**的（同一个"滑入"预设用于任意页面），
 * 节点 id 只有运行时才知道。⇒ 编译时把声明与目标**绑定**（`compileAnimations(decls, targets)`）。
 */
export interface AnimTargets {
  /** 单个节点（转场里的"进场页"/"出场页"各自是一个节点） */
  nodeId: number
}

/** 编译产物：**引擎指令**（与 `proteus_layout_anim_start` / `anim_commit_spec` 的线格式一致） */
export interface EngineAnim {
  nodeId: number
  kind: AnimKindId
  curve: CurveId
  from: number
  to: number
  durMs: number
  delayMs: number
  drive: 0 | 1
  takeover: boolean
  /** 仅弹簧模式出现（内核据此走物理积分） */
  spring?: { stiffness: number; damping: number; mass: number }
  /** ★MA5：仅滚动驱动出现（内核据此按滚动位置求值；两者都给且 `scrollTo > scrollFrom` 才生效） */
  scrollFrom?: number
  scrollTo?: number
}

/** 编译产物：一次"提交"（可整批喂给 `anim_start` 或 `anim_commit_spec`） */
export interface CompiledBatch {
  anims: EngineAnim[]
  /**
   * ★**合成属性判定（§5-bis.2）**——全为合成属性 ⇒ 可走平台渲染线程零参与路径。
   * 判据在内核（唯一实现）；此处为**编译期预判**（避免明知不可行还发一轮）。
   */
  composited: boolean
  /** 非合成属性清单（`composited=false` 时非空；供上层报错/降级标记，**不静默**） */
  nonComposited: AnimKindName[]
}

/** 校验问题（编译期报错用；**每条都能指到出处**） */
export interface ValidationIssue {
  /** 出问题的声明下标（-1 = 批次级问题） */
  index: number
  code:
    | 'non-composited'
    | 'invalid-range'
    | 'conflicting-easing'
    | 'duplicate-kind'
    | 'invalid-spring'
    | 'empty'
  message: string
  /** 修复建议（可操作，不是"请检查"） */
  hint: string
}

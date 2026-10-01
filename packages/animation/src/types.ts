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
  // ★★颜色（2026-10-01）：用户面**一个** `color` 声明，内核面**四个标量通道**（kind 5..8）。
  //   分解的理由见内核 `anim.rs::AnimKind` 头注（求值机器全是标量的 ⇒ 零改动复用）。
  //   ★对外**不暴露**通道号（`ANIM_KIND_ID` 里也没有它们）——那是编译内部的事。
  COLOR_R: 5,
  COLOR_G: 6,
  COLOR_B: 7,
  COLOR_A: 8,
  // ★★文字色（2026-10-01）：与底色**同一条数学、不同的样式槽**（`text_color` vs `bg`）。
  //   分成两组编号（而不是复用 5..8）的唯一原因：内核 `write()` 必须知道**往哪个槽写**——
  //   用同一批编号无法区分（会在"同时动底色与文字色"时互相覆盖）。
  TEXT_COLOR_R: 9,
  TEXT_COLOR_G: 10,
  TEXT_COLOR_B: 11,
  TEXT_COLOR_A: 12,
  // ★★3D 旋转（2026-10-01 · B 批）：与 `rotate`（Z 轴）并列的两个轴。
  //   走 tick 路径（不进平台零参与——iOS/Android 的 3D 插值语义不同，跨端一致优先；
  //   见内核 is_composited 注释）。
  ROTATE_X: 13,
  ROTATE_Y: 14,
} as const
export type AnimKindId = (typeof AnimKind)[keyof typeof AnimKind]
export type AnimKindName =
  | 'translateX'
  | 'translateY'
  | 'scale'
  | 'rotate'
  | 'opacity'
  /** 背景色（内核四通道 5..8） */
  | 'color'
  /** 文字色（内核四通道 9..12） */
  | 'textColor'
  /** ★绕 X 轴旋转（度；3D——翻牌/立方体；走 tick 路径） */
  | 'rotateX'
  /** ★绕 Y 轴旋转（度；3D——翻转/翻牌；走 tick 路径） */
  | 'rotateY'

/** 名称 → 编号（编译期用；也是"名字写错"的**类型级**防线） */
export const ANIM_KIND_ID: Record<AnimKindName, AnimKindId> = {
  translateX: AnimKind.TRANSLATE_X,
  translateY: AnimKind.TRANSLATE_Y,
  scale: AnimKind.SCALE,
  rotate: AnimKind.ROTATE,
  opacity: AnimKind.OPACITY,
  // ★`color` 的编号是**名义值**：编译期会把它展开成 4 条通道指令（见 `compileOne`）。
  //   这里给 COLOR_R 是为了让 `ANIM_KIND_ID` 保持"每个名字都有编号"的完备形状——
  //   直接消费它会少写 3 个通道，故 `compileOne` 有专门的 `color` 分支（不读这个值）。
  color: AnimKind.COLOR_R,
  // ★`textColor` 同理（名义值 = 文字色 R 通道 9；编译期展开成 4 条）
  textColor: AnimKind.TEXT_COLOR_R,
  // ★3D 旋转（单通道——无数值展开）
  rotateX: AnimKind.ROTATE_X,
  rotateY: AnimKind.ROTATE_Y,
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

/**
 * ★★**循环次数**（2026-10-01 · A2）——与 CSS `animation-iteration-count` 对齐：
 *   正数 = 播 n 遍；`'infinite'` = 无限（呼吸灯/无限脉冲）。
 *   ★为什么进封闭集（而不是"把时长写长"）：一遍的时长决定**每轮的节奏**；
 *   "时长写长"会让曲线在整段上被拉伸（呼吸变成慢速单摆），且无限时根本写不出来。
 */
export type RepeatCount = number | 'infinite'

/** ★★**交替方向**（A2）——与 CSS `animation-direction` 对齐：`'normal'`（缺省）/ `'alternate'`（yoyo） */
export type RepeatDirection = 'normal' | 'alternate'

/**
 * ★★**自定义三次贝塞尔曲线的控制点**（`[x1, y1, x2, y2]`——CSS `cubic-bezier()` 同一参数化）
 *
 * 【与 `CurveName` 封闭集的关系（2026-10-01 转正）】封闭集是"常用曲线"的快捷名；
 *   设计稿里任意一条缓动此前只能走**逃生口**（`custom-easing` = degraded，要登记）。
 *   现在它是**契约能力**：与内置曲线走**同一台求值机器**（内核 65 点表 + 插值——
 *   控制点在解析期生成一次表并缓存，之后求值零迭代），跨端逐位一致。
 *
 * 【约束】`x1 / x2 ∈ [0,1]`（时间轴必须单调——否则给定进度求值不唯一）；
 *   `y1 / y2` **任意**（> 1 / < 0 是回弹、预期效果的来源，CSS 同规）。
 */
export type BezierPoints = readonly [number, number, number, number]

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

/** ★MA6：**序列编排的一段**（对标 Flutter `TweenSequenceItem`）——多段收敛在**一条**动画里 */
export interface KeyframeSeg {
  /** 本段终点（本段起点 = 上一段终点；首段起点 = 声明的 `from`） */
  to: number
  /** 本段时长（毫秒） */
  durationMs: number
  /** 本段曲线（缺省 = `easeOut`） */
  curve?: CurveName
}

/**
 * ★★**颜色序列的一段**（2026-10-01：颜色 keyframes）——对标 `KeyframeSeg`，值域是**颜色**
 *
 * 【为什么单开一个类型（而不是把 `KeyframeSeg.to` 放宽成 `number | string`）】放宽联合会让
 *   标量路径的**全部使用点**都要处理 string 分支（那里只可能收到数字）⇒ 类型噪音大、
 *   且丢掉"标量段是数字"的编译期保证。单开类型 = 两边都保持精确（与 `ScalarAnimDecl |
 *   ColorAnimDecl` 同一取向）。
 */
export interface ColorKeyframeSeg {
  /** 本段终点颜色（本段起点 = 上一段终点；首段起点 = 声明的 `from`） */
  to: string
  /** 本段时长（毫秒） */
  durationMs: number
  /** 本段曲线（缺省 = `easeOut`） */
  curve?: CurveName
}

/** ★**单条动画声明**（封闭集的全部字段）——**标量属性**（数字值） */
export interface ScalarAnimDecl {
  /**
   * 动哪个属性（**不含颜色两类**——`color` / `textColor` 走 `ColorAnimDecl`，见下）
   *
   * ★2026-10-01：排除集加上 `textColor`（文字色落地时，只排 `color` 会让
   *   `ScalarAnimDecl` 声称支持 `textColor` 却带数字值 ⇒ 联合判别失效、类型检查报错）。
   */
  kind: Exclude<AnimKindName, 'color' | 'textColor'>
  /** 起点（缺省 = 节点当前值，由内核在启动时解析） */
  from?: number
  /** 终点（**必填**——动画必须有确定目标；序列模式下 = 末段 `to`） */
  to: number
  /** 时长（毫秒；弹簧模式可省——由物理决定；序列模式下 = 各段之和） */
  durationMs?: number
  /** 起始延迟（毫秒；编排/交错用） */
  delayMs?: number
  /** 查表曲线（与 `spring` / `keyframes` / `curveBezier` 四选一；都缺省 = `easeOut`） */
  curve?: CurveName
  /**
   * ★★**自定义三次贝塞尔**（`cubic-bezier(x1,y1,x2,y2)` 的四个控制点；与 `curve` 互斥）
   *
   * 给了它 ⇒ 求值走该曲线的采样表（内核生成并缓存——800 片同曲线只生成一次）。
   * `x1/x2 ∈ [0,1]`（编译期校验）；`y1/y2` 任意（回弹）。与 `keyframes` 互斥
   * （段级曲线目前只用封闭集——诚实边界）。
   */
  curveBezier?: BezierPoints
  /** 弹簧物理（给了它就用物理积分，不是查表） */
  spring?: SpringConfig
  /**
   * ★MA6：**序列编排**（多段；与 `curve`/`spring` 三选一）
   *
   * 解决的结构性缺口：内核对同 `(节点,属性)` 是**替换**语义 ⇒ "先下压再弹回"这类
   * **同属性多段**动画用多条声明表达会被静默替换。⇒ 多段收敛到一条动画里（内核 `AnimMode::Keyframes`）。
   * ★整段序列仍是**一条**平台动画（`CAKeyframeAnimation` 采样整段），不额外增加提交次数。
   */
  keyframes?: KeyframeSeg[]
  /**
   * ★★**循环次数**（A2；缺省 1 = 播一遍）
   *
   * `repeat: 3` 播三遍；`repeat: 'infinite'` 无限循环（直到显式 stop）。
   * 语义与 CSS `animation-iteration-count` 对齐；`direction: 'alternate'` 时奇偶轮反向（yoyo）。
   * ★与 `scroll`（外部驱动）互斥——滚动驱动的进度来自位置，没有"轮"的概念。
   */
  repeat?: RepeatCount
  /** ★★**交替方向**（A2；缺省 `'normal'`）：`'alternate'` = yoyo（去程回来程，净位移 0） */
  direction?: RepeatDirection
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
 * ★★**颜色动画声明**（2026-10-01）
 *
 * 【为什么是独立类型（而不是把 `to` 放宽成 `number | string`）】用联合类型让
 *   "颜色声明必须是颜色字符串"成为**类型级保证**——写错形态在编辑器里就红，
 *   而不是等到运行时才发现（与 `ANIM_KIND_ID` 的"名字写错是类型级防线"同一取向）。
 *
 * 【值形态】`#RGB` / `#RRGGBB` / `#RRGGBBAA`（CSS4 序）——与内核 `parse_css_color` 同规则。
 *
 * 【`from` 必填（诚实标注）】内核对"缺省 = 当前值"**没有实现**（这正是约束
 *   `constraint/from-is-mandatory` 记下的事）：颜色动画的起点必须由调用方给出。
 *   ⇒ 本类型把 `from` 定为必填，编译期就拦住"我没写起点"这类静默错色。
 *
 * 【与"节点当前底色"的关系】内核要求该节点**有底色**（树里声明了 `backgroundColor`）——
 *   它既是"复位目标"也是校验基准；没底色的节点上启动颜色动画会被内核**明确拒绝**。
 *   故预设（`presets.color.*`）通常由调用方传入 `from`（= 该节点的底色）。
 */
export interface ColorAnimDecl {
  /**
   * 颜色属性（**两个**：`color` = 背景色 / `textColor` = 文字色；2026-10-01）
   *
   * 【为什么是两个独立属性而不是一个"当前色"】底色与文字色是**两条独立轨道**——
   *   同一节点可以同时动两者（内核写**不同的样式槽** `bg` / `text_color`）。
   *   合并成一个属性会让"同时动"变成"后者覆盖前者"（真机判据有专门用例守这条）。
   */
  kind: 'color' | 'textColor'
  /** 起点颜色（**必填**——见上） */
  from: string
  /** 终点颜色（必填；序列模式下 = 末段 `to`） */
  to: string
  durationMs?: number
  delayMs?: number
  /** 查表曲线（缺省 = `easeOut`） */
  curve?: CurveName
  /** ★自定义三次贝塞尔（与 `curve` 互斥；同标量语义——见 `ScalarAnimDecl.curveBezier`） */
  curveBezier?: BezierPoints
  /** 弹簧物理（**逐通道**独立积分；4 条通道各自静止，整色在最后一条静止时到位） */
  spring?: SpringConfig
  /**
   * ★★**颜色序列**（多段；2026-10-01 起支持）
   *
   * 【与标量序列的关系】语义同 `ScalarAnimDecl.keyframes`（多段收敛在**一条**动画/每通道里，
   *   段边界精确、末段端点钉死），只是段的终点是**颜色**。
   *   内核侧：每通道各得一条 `AnimMode::Keyframes`（4 条通道共用同一段时长表）。
   */
  keyframes?: ColorKeyframeSeg[]
  /** ★A2：循环次数（颜色同样支持——呼吸灯的底色循环；语义同标量） */
  repeat?: RepeatCount
  /** ★A2：交替方向（`'alternate'` = yoyo） */
  direction?: RepeatDirection
  /** 滚动驱动的颜色（窗口换算在内核，与标量属性同一套） */
  scroll?: ScrollWindow
  /** 驱动方式（缺省 `time`；`progress` = 外部设进度，与标量属性同一语义） */
  drive?: DriveName
  takeover?: boolean
}

/** ★**单条动画声明**（封闭集的全部字段；`ScalarAnimDecl | ColorAnimDecl` 的联合） */
export type AnimDecl = ScalarAnimDecl | ColorAnimDecl

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
  /** ★自定义三次贝塞尔控制点（可选；内核求值优先于 `curve`——见内核 `Anim::curve_at`） */
  curveBezier?: [number, number, number, number]
  from: number
  to: number
  durMs: number
  delayMs: number
  drive: 0 | 1
  takeover: boolean
  /** 仅弹簧模式出现（内核据此走物理积分） */
  spring?: { stiffness: number; damping: number; mass: number }
  /** ★MA6：仅序列模式出现（内核据此走分段求值；整段 = 一条平台动画） */
  keyframes?: Array<{ to: number; durMs: number; curve: CurveId }>
  /** ★MA5：仅滚动驱动出现（内核据此按滚动位置求值；两者都给且 `scrollTo > scrollFrom` 才生效） */
  scrollFrom?: number
  scrollTo?: number
  /** ★A2：循环次数（缺省不出现 = 1 遍；`-1` = 无限——内核哨兵） */
  repeat?: number
  /** ★A2：交替方向（仅 `repeat` 出现时给；true = yoyo） */
  alternate?: boolean
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

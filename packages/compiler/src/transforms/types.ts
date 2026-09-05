// src/compiler/transforms/types.ts
// 编译规则 AI 说明书 —— 透明定位的核心数据结构
// 每条编译规则 = 一份结构化自描述（人可读 + 机器可读）：
// AI 可枚举全部规则（能力清单）、查询单条规则（what/why/when/how-verify）、
// 由 source 字段直接跳读实现源码；implemented 规则可携带 apply()（阶段三分派层）——
// AI 覆盖 apply 即获得新能力，无需改框架代码（★底线循环 ① 完全形态，决策 #65 阶段三）

export type TransformPhase = 'template' | 'script' | 'style' | 'validate'

export type RuleStatus = 'implemented' | 'planned' | 'limitation'

/**
 * 规则执行上下文（apply 分派层）：input → output
 * 各阶段上下文含义不同（style 为文本、template 为元素序列化片段等），以规则 example 为准
 */
export interface RuleContext<In = unknown, Out = unknown> {
  /** 规则输入（如 css 文本 / 序列化片段） */
  input: In
  /** 规则输出（apply 写入；无输出可忽略） */
  output?: Out
  /** 编译期选项（rpxRatio/px2rpx 等，与 CompileOptions 对应字段同义） */
  options?: Record<string, unknown>
  /** 决策 trace 注册（apply 内调用，产物决策链反查） */
  trace?: (before: string, after: string) => void
}

/** 规则执行函数：输入 → 输出（AI 可覆盖此实现获得新能力） */
export type RuleApplier = (ctx: RuleContext) => void

/** 一条编译规则的完整 AI 说明书 */
export interface TransformRule {
  /** 稳定 ID：`<phase>/<name>`，如 'tag/div-to-view'（API / trace / 文档引用此 ID） */
  id: string
  /** 所属编译阶段 */
  phase: TransformPhase
  /** 人类可读标题 */
  title: string
  /** what：输入 → 输出 */
  description: string
  /** ★#480 英文变体 of description（官网 Playground/EN 态取用；缺省回退中文）——新增规则必填，tests/transforms.test.ts 硬卡全覆盖 */
  descriptionEn?: string
  /** why：平台约束 / 设计决策（关联 PROJECT_MEMORY.md 决策号） */
  why: string
  /** when：触发条件 */
  when: string
  /** 前后对照示例（真实源码 / 真实产物） */
  example: { before: string; after: string }
  /** 如何验证：对应单测 / golden fixture */
  verify: string
  /** 状态：implemented（已实现）/ planned（规划中）/ limitation（明确不支持的 MVP 限制） */
  status: RuleStatus
  /** 实现位置（文件:函数/行），AI 跳读源码用 */
  source: string
  /** 相关决策号（PROJECT_MEMORY.md 中的 #N） */
  decision?: string
  /** 表驱动的映射（与 tags.ts 常量同源引用，防漂移；registry 测试校验覆盖完整性） */
  mapping?: Record<string, string>
  /** ★阶段三分派层：规则执行函数（implemented 规则可携带；AI 覆盖此实现 → 新能力即生效） */
  apply?: RuleApplier
}

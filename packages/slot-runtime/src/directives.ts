// packages/slot-runtime/src/directives.ts —— ★★★**宿主指令注册表**（P3-5 自定义指令，2026-10-03）
//
// 【这一层解决什么（Vue 的自定义指令在 Vapor 里怎么落地）】
//   Vue 的自定义指令 = **用户脚本**（`directive.mounted(el, binding)`）——而 Vapor 的端上
//   **不执行 script**（与生命周期/`$emit` 同一条架构分工，见 entry-vapor 头注）。
//   ⇒ 不能"支持任意自定义指令"，但可以把"**指令的意图**"收敛成一个**闭集注册表**：
//   宿主（三端共用的同一份桥代码）认识的名字 → 映射到**已存在的宿主能力**；不认识的名字
//   → 编译期精确诊断（说明"端上不执行 script ⇒ 指令体不会运行"+ 列出注册表里可用的名字）。
//
// 【为什么注册表数据放运行时包（而不是编译器）】
//   与 LayoutTemplate / SubscriptionTable 同一处置：它是**三端契约**——编译器据它产诊断、
//   桥（三端共用）据它执行效果。定义在消费端（运行时）才能保证"消费方定义的形状"唯一。
//
// 【诚实边界（本批）】
//   · 首批只交 `v-animate`（映射到**已有的**内核动画通道 `animStart`——与 `<Transition>` 同一套，
//     零新增宿主能力 ⇒ 三端零平台改动）；
//   · 指令值只在**顶层作用域**求值（v-for 行内自定义指令为后续批次，编译期诊断）；
//   · 组件**内部**模板的指令本批不执行（桥只走顶层模板——内部为后续批次）。
//
// 【为什么第一条是 v-animate】它是"命令式一次性动画"的典型诉求（数据变化时闪一下/高亮一下），
//   而且**完全落在已有能力上**（animStart + TRANSITION_PRESETS 通道规格）：
//   编译期把预设解析成通道（与 `<Transition>` 同一份预设表——**一处实现**），
//   运行时在值变化时报给宿主播放。

/** 一条宿主指令的**声明**（数据；执行在桥） */
export interface HostDirectiveSpec {
  /**
   * 参数（`:arg`）的语义提示。
   * `v-animate:fade` 的 `fade` = 动画预设名（解析成通道规格，编译期完成）。
   */
  argKind: 'anim-preset'
  /** 参数说明（诊断文案用） */
  argHint: string
  /** 指令语义（诊断/文档用） */
  desc: string
}

/**
 * ★★★**宿主指令注册表**（**唯一事实来源**：编译器诊断与桥执行共用这张表）。
 * 加新指令 = 在这里加一条 + 桥里加对应效果 + 端上判据（三件套，缺一不算支持）。
 */
export const HOST_DIRECTIVE_SPECS: Record<string, HostDirectiveSpec> = {
  animate: {
    argKind: 'anim-preset',
    argHint: '动画预设（fade / slide-up / slide-down / slide-left / slide-right / zoom / fade-slide-up）',
    desc:
      '值变化（或首次求值为真）时在该节点**播一次**预设动画（走内核动画通道，与 <Transition> 同一套）。' +
      '语义对齐：指令的 mounted（首评 truthy 即播）与 updated（值变化即播）。',
  },
}

/** 注册表里的指令名清单（诊断文案用；顺序稳定 ⇒ 产物可复现） */
export const HOST_DIRECTIVE_NAMES: string[] = Object.keys(HOST_DIRECTIVE_SPECS)

/** 查询：该指令是否在宿主注册表里（编译器据此区分"支持"与"不可执行"） */
export function isHostDirective(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(HOST_DIRECTIVE_SPECS, name)
}

/**
 * ★★**指令值→是否播**的判定（纯函数，可单测）。
 *
 * 语义（对齐 Vue 自定义指令的 mounted/updated 两钩）：
 *   · **首次**求值（`prev` 为 undefined）：truthy ⇒ 播（mounted 语义）；
 *   · 之后：值**变化**且当前值 truthy ⇒ 播（updated 语义——只在变化时触发，与 Vue 的
 *     "binding.value 变化才调 updated"一致）。
 *   · falsy 一律不播（`v-animate="false"` 是合法写法 = 这次不播）。
 */
export function directiveShouldPlay(prev: unknown, cur: unknown, seen: boolean): boolean {
  if (!seen) return Boolean(cur)
  return !Object.is(prev, cur) && Boolean(cur)
}

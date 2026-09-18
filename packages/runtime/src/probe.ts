// packages/runtime/src/probe.ts —— ★框架元素探针注册表（跨端；2026-09-14）
//
// 解决的问题（真机实证）：自动化工具（wechatide/automator）**只能查页面拥有的节点**；
//   自定义组件（p-*）内部节点被 glass-easel **完全隔离**（`createSelectorQuery` 返回 null、
//   `selectAllComponents` 在 Skyline **不存在**）→ 测试无法断言「组件内部几何/可见性」，
//   只能退回人眼截图（本轮 scroll-view 容器塌成细线即因此漏检两轮）。
//
// 解法：**测量必须从组件内部发起**。编译器把探针注入组件 `ready()`（`this` = 组件实例，
//   可用 `.in(this)` 组件作用域查询）→ 组件自测自己的根节点 → 写入本注册表 →
//   测试用 `automation_evaluate` 读同一注册表（同一 JS 上下文），**绕开工具的元素查询限制**。
//
// 契约：注册表挂在全局 `globalThis[PROBE_GLOBAL_KEY]`，形状稳定、可序列化（纯 JSON），
//   组件侧（编译器内联注入）与消费侧（test-core driver / useElement 回落）**共用本模块定义**。
//
// ★诚实边界：探针只测**框架声明要测的**（组件根 + 可选具名选择器），不是任意 DOM 抓取；
//   未声明/未开启（无 pid 且未开 PROBE_ALL）的组件不产生记录（零成本）。

/** 全局注册表键（编译器内联注入与消费端必须一致——见 `probeGlobalKey()`） */
export const PROBE_GLOBAL_KEY = '__PROTEUS_PROBES__'

/** 元素几何（对齐 wx boundingClientRect 字段；纯 JSON） */
export interface ProbeRect {
  id?: string
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** 滚动几何（判定「内容溢出但不可滚」的关键） */
export interface ProbeScroll {
  scrollTop: number
  scrollLeft: number
  scrollWidth: number
  scrollHeight: number
}

/** 单条探针记录（**可序列化**——测试经 evaluate 跨进程读取） */
export interface ProbeRecord {
  /** 探针键：组件 pid（缺省 = 组件名，多实例请显式传 pid） */
  pid: string
  /** 组件名（编译器注入时写入；便于按类型断言） */
  tag?: string
  /** 根节点几何（null = 未测到，如 hidden/未渲染） */
  rect: ProbeRect | null
  /** 根节点滚动几何（横向/纵向容器可滚性判据） */
  scroll?: ProbeScroll | null
  /** 根节点关键计算样式（display/visibility/opacity/尺寸——判定「存在但不可见」） */
  style?: Record<string, string> | null
  /** 采集时间戳（判断新鲜度） */
  ts: number
}

type ProbeRegistry = Record<string, ProbeRecord>

/** 取（或惰性创建）全局注册表。SSR/无 globalThis 环境返回 null（探针静默不可用，不抛） */
function registry(): ProbeRegistry | null {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g) return null
  let reg = g[PROBE_GLOBAL_KEY] as ProbeRegistry | undefined
  if (!reg) {
    reg = {}
    g[PROBE_GLOBAL_KEY] = reg
  }
  return reg
}

/** 写入一条探针记录（组件侧；同 pid 覆盖——测最新） */
export function recordProbe(record: ProbeRecord): void {
  const reg = registry()
  if (!reg || !record || !record.pid) return
  reg[record.pid] = record
}

/** 读取探针：传 pid 取单条；不传取全部（消费侧/test-core driver） */
export function readProbes(pid?: string): ProbeRecord[] {
  const reg = registry()
  if (!reg) return []
  if (pid) {
    const one = reg[pid]
    return one ? [one] : []
  }
  return Object.keys(reg).map((k) => reg[k])
}

/** 清空（测试隔离；每次用例前调用） */
export function clearProbes(pid?: string): void {
  const reg = registry()
  if (!reg) return
  if (pid) {
    delete reg[pid]
    return
  }
  for (const k of Object.keys(reg)) delete reg[k]
}

/** 探针是否开启：显式 pid（组件实例级）或全局开关注入 `__PROTEUS_PROBE_ALL__`（测试级全量） */
export function probeEnabled(pid?: string): boolean {
  if (pid) return true
  const g = globalThis as unknown as Record<string, unknown>
  return Boolean(g && g.__PROTEUS_PROBE_ALL__)
}

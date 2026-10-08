// packages/cli/src/doctor/types.ts —— ★★M5 `proteus doctor` 类型（2026-10-09 · 决策 #686）
//
// 《10-m5-doctor.md》实现：跨端工程的"能不能跑起来"体检器。**不新写检查逻辑**——编排既有探测
//   （host-package 的 resolveDeveloperDir / health.ts / check-deps / gate.ts 注册表），归一层。
// ★四条硬约束（继承 Apollo，不得违反）：码自建（PT-*）· 禁猜因（未知→PT-EX-000）·
//   保留原文（evidence 全量）· 不自动修复（只给 fix.command）。
import type { ProteusDiagnostic } from '../diag'

/** 体检组（8 组，SSOT 见 registry.ts 的 CHECKS） */
export type DoctorGroup = 'env' | 'toolchain' | 'deps' | 'project' | 'hosts' | 'ports' | 'devices' | 'gates'

/** 单项结果级别：ok 通过 / warn 提示 / error 阻断 / skip 不适用（不计入分母、不阻断） */
export type DoctorLevel = 'ok' | 'warn' | 'error' | 'skip'

/** 取证（★Apollo §7：原始命令/输出/退出码全量保留，`--verbose` 展开、`--json` 恒含） */
export interface DoctorEvidence {
  command?: string
  exitCode?: number
  stdout?: string
  stderr?: string
  /** 非命令型取证（如文件路径探测）：一行描述 */
  note?: string
}

/** 一条发现（与 `ProteusDiagnostic` 同构的语义：code/severity/context/suggestions/raw） */
export interface DoctorFinding {
  checkId: string
  level: DoctorLevel
  title: string
  /** 期望（人读） */
  expected?: string
  /** 实测（人读） */
  actual?: string
  /** Proteus 诊断码（PT-*，SSOT 在 diag.ts）——ok/skip 可省 */
  diagCode?: string
  /** ★原始取证（禁止吞——Apollo 硬约束③） */
  evidence: DoctorEvidence[]
  /** 修复建议（可复制命令 + 说明；★不自动执行——Apollo 硬约束④） */
  fix?: { command?: string; description?: string }
  /** 关联文档（相对路径，供 hint 指向） */
  docs?: string
}

/** 一个检查项（纯函数 + 依赖注入：探测原语从 `ctx` 取 ⇒ 测试零副作用） */
export interface DoctorCheck {
  /** `组/项`（对齐 gate.ts 的 id 范式，带层级） */
  id: string
  group: DoctorGroup
  /** 人读标题 */
  title: string
  /** 不通过时的级别（ok 一栏由结果决定） */
  level: 'error' | 'warn'
  /** 慢检查（默认跳过，需 `--deep` 或 `--only <组>`） */
  slow?: boolean
  /** 条件启用：返回 false ⇒ 该端不涉及 ⇒ skip（不阻断、不计分母） */
  appliesTo?(ctx: DoctorContext): boolean
  run(ctx: DoctorContext): Promise<DoctorFinding> | DoctorFinding
}

/** 目标端（与 targets.ts 对齐；doctor 只读其声明集做条件启用） */
export interface DoctorToolchain {
  nodeVersion: string
  pnpmVersion: string | null
  platform: string
  arch: string
}

/** 体检上下文（root / targets / 注入的探测原语——测试可注入假实现） */
export interface DoctorContext {
  root: string
  /** 工程声明的端（缺省空 ⇒ 端相关组全 skip） */
  targets: string[]
  tool: DoctorToolchain
  /** 路径存在性（注入） */
  exists(p: string): boolean
  /** 读文件（注入；抛错返回 null） */
  readFile(p: string): string | null
  /**
   * 跑外部命令（有硬超时；**返回结果对象不抛**）。`timeout` ⇒ exitCode=null + evidence.note='timeout'。
   *   ★这是唯一碰外部世界的原语——所有工具链探测经它，便于测试注入 + 统一超时。
   */
  runCmd(cmd: string, args: string[], opts?: { timeoutMs?: number; env?: Record<string, string> }): DoctorEvidence
  /** 端口是否可绑定（注入） */
  portFree(port: number): Promise<boolean>
  /** 查找覆盖某 bundleId 的本机 iOS 描述文件（注入；默认复用 host-package.findIosSigningProfile） */
  findIosProfile(bundleId: string): string | null
  /** 读 package.json（工程）解析对象（缺省 null） */
  projectPackage(): Record<string, unknown> | null
  /** 单检查缺省超时（ms） */
  timeoutMs: number
}

/** 一个分组的呈现结构 */
export interface DoctorGroupResult {
  id: DoctorGroup
  title: string
  findings: DoctorFinding[]
}

/** 体检报告（`--json` 对外契约；`schemaVersion` 独立版本化） */
export interface DoctorReport {
  schemaVersion: 1
  tool: { name: string; version: string }
  root: string
  platform: { os: string; arch: string; node: string }
  targets: string[]
  startedAt: string
  durationMs: number
  summary: { total: number; ok: number; warn: number; error: number; skip: number; blocked: boolean }
  groups: DoctorGroupResult[]
  /** ★与 diag.ts 的 ProteusDiagnostic 同构（可喂 Apollo 既有消费方） */
  diagnostics: ProteusDiagnostic[]
  ok: boolean
}

/** 组的中文标题（呈现用） */
export const GROUP_TITLES: Record<DoctorGroup, string> = {
  env: '环境',
  toolchain: '工具链',
  deps: '依赖',
  project: '工程',
  hosts: '宿主',
  ports: '端口',
  devices: '设备',
  gates: '门禁',
}

// packages/cli/src/diag.ts —— ★★★Apollo 诊断核心（《构建与编译错误语义化诊断方案》代号 Apollo · 决策 #684）
//
// 【为什么有它（用户原话：「阿波罗方案先做起来，现在这种错误提示非常懵」+ 配图）】
//   `proteus dev --target ios` 失败时输出 `✗ swiftc 编译失败：` —— **冒号后是空的**：真正的详情被 CLI
//   **吞掉**（失败分支只过滤以 `✗` 开头的行打印，而缩进的详情行不含 `✗`）。这正是方案 §7 的反例
//   （「必须保留原始错误全文，禁止吞掉」）。
//
// 【Apollo 分层（本模块覆盖 L2/L4，L0 采集在下方 parser，L1 完整反向映射属下一批）】
//   L0 采集：`parseTscOutput` / `parseSwiftcOutput` / `parseEsbuildErrors`（工具链输出 → 结构化）
//   L2 分类：Proteus 统一错误码 `PT-{阶段}{类别}-{序号}`（**自建映射层**——BX0 实测下层无稳定码）
//   L3 语义：确定原因给「根因 + 可行动建议」；**不确定的一律只归类不猜因**（方案 §3.3 硬约束）
//   L4 呈现：分层输出（语义块 + **原始错误全文始终打印**）+ `--json` 结构化
//
// 【★硬约束（照抄方案，不得违反）】
//   ① 错误码**自建**，不透传下层码（esbuild `id` 恒空、swiftc 无码）；
//   ② **禁止对未知原因生成猜测性"可能原因"**（猜错比不给更糟）；未知归 `PT-*X-000`，只定位不猜因；
//   ③ **必须保留原始错误全文**（可展开 = 终端里就是**不吞掉**）；语义块是增益，原文是底线；
//   ④ **不做自动修复**，只给建议。
import { dim, bold, cyan, red, yellow, gray } from './ui'

/** 阶段：C 编译期 / B 构建期 / D 部署期 */
export type DiagStage = 'C' | 'B' | 'D'
/** 类别：S 语法 / T 类型 / R 资源 / E 环境能力 / D 依赖 / X 未知 */
export type DiagCategory = 'S' | 'T' | 'R' | 'E' | 'D' | 'X'

export interface DiagLocation {
  file: string
  line?: number
  column?: number
}

/** ★统一的 Proteus 诊断（对外**唯一**格式；下层细节只进 `raw`） */
export interface ProteusDiagnostic {
  /** `PT-{stage}{category}-{NNN}` —— 必在 DIAG_CODES 目录中（SSOT 约束，见 makeDiag） */
  code: string
  /** 人读标题（来自目录） */
  title: string
  severity: 'error' | 'warn'
  /** L1 归因位置（可得时） */
  location?: DiagLocation
  /** 上下文（一行，如"<template> 内第 2 个表达式"） */
  context?: string
  /** ★确定的根因（**仅当确定**——不确定必须省略，不得猜测） */
  cause?: string
  /** 可行动建议（有序） */
  suggestions?: string[]
  /** ★原始错误全文（**禁止吞掉**） */
  raw: string
}

/** 错误码目录条目（SSOT —— 新码必须先登记此处，makeDiag 会校验） */
export interface DiagCodeDef {
  stage: DiagStage
  category: DiagCategory
  title: string
  /** 该码的通用建议（可被调用点覆盖；用 `null` 显式清空） */
  hints?: string[]
}

/**
 * ★错误码目录（L2 的 SSOT）。规则 `PT-{阶段}{类别}-{序号}`（方案 §6.2）。
 * 每个码带**通用建议**（L3 的兜底；具体调用点可覆盖）。
 */
export const DIAG_CODES: Record<string, DiagCodeDef> = {
  // ── 编译期 · 语法 / 类型（JS/TS 管线）──
  'PT-CS-001': { stage: 'C', category: 'S', title: '语法错误', hints: ['按下方定位修正该处语法'] },
  'PT-CT-001': { stage: 'C', category: 'T', title: '类型错误', hints: [] },
  'PT-CS-002': { stage: 'C', category: 'S', title: 'Vue 单文件组件解析失败', hints: ['检查 <template>/<script>/<style> 结构是否成对完整'] },
  // ── 编译期 · 能力不支持（L3 复用 VC1-d 元数据；本批未接，先留码位）──
  'PT-CE-014': { stage: 'C', category: 'E', title: '环境能力不支持' },
  // ── 构建期 · 依赖 ──
  'PT-BD-001': { stage: 'B', category: 'D', title: '模块解析失败（找不到模块）', hints: ['检查导入路径与文件大小写（跨端文件系统敏感性不同）'] },
  'PT-BD-002': { stage: 'B', category: 'D', title: 'Rust 内核编译失败（cargo）', hints: ['本机需 Rust 工具链（rustup）；见 packages/layout-core-rust 的 README'] },
  // ── 构建期 · 环境（工具链/签名）──
  'PT-BE-001': { stage: 'B', category: 'E', title: '找不到可用 Xcode（iOS 工具链）', hints: ['安装完整 Xcode（非 CommandLineTools）；非默认安装位用 PROTEUS_DEVELOPER_DIR 指定'] },
  'PT-BE-002': { stage: 'B', category: 'E', title: '找不到 Android SDK / JDK', hints: ['设 ANDROID_HOME / JAVA_HOME，或确认本仓 .tools/jdk17 存在'] },
  'PT-BE-003': { stage: 'B', category: 'E', title: 'iOS 签名不可用（无匹配描述文件 / 身份）', hints: ['上档签名：bash hosts/ios/signing.sh use <账号|SHA-1前缀>；再用 status 自查'] },
  'PT-BE-004': { stage: 'B', category: 'E', title: '未找到已连接的 iOS 设备', hints: ['用数据线连接设备并信任本机；xcrun devicectl list devices 应显示 connected'] },
  'PT-BE-005': { stage: 'B', category: 'E', title: '缺少 runtime 依赖（AAR / 静态库）', hints: ['Android：跑 hosts/android/build-runtime-aar.sh 生成 AAR；再 proteus create host 重生成'] },
  // ── 构建期 · 宿主编译失败 ──
  'PT-BS-001': { stage: 'B', category: 'S', title: '原生宿主编译失败（swiftc）', hints: ['本地零设备复现：bash hosts/ios/check-cli-host-compile.sh（秒级）'] },
  'PT-BS-002': { stage: 'B', category: 'S', title: '原生宿主编译失败（javac）', hints: ['本地零设备复现：bash hosts/android/check-host-compile.sh'] },
  // ── 构建期 · 资源 ──
  'PT-BR-001': { stage: 'B', category: 'R', title: '缺少运行期 bundle（bundle-superapp.js）', hints: ['先跑 proteus build --target <端> 产出 bundle，再打包'] },
  // ── 部署期 ──
  'PT-DD-001': { stage: 'D', category: 'D', title: '安装到设备失败', hints: ['确认设备已连接且已授权；iOS 首次需在设备上信任开发者证书'] },
  // ── 未知（★不可省略——只定位不猜因，方案 §6.3）──
  'PT-CX-000': { stage: 'C', category: 'X', title: '编译期未知错误' },
  'PT-BX-000': { stage: 'B', category: 'X', title: '构建期未知错误' },
  'PT-DX-000': { stage: 'D', category: 'X', title: '部署期未知错误' },
}

/** 该阶段/类别的"未知"兜底码 */
export function unknownCode(stage: DiagStage): string {
  return `PT-${stage}X-000`
}

export interface MakeDiagInput {
  location?: DiagLocation
  context?: string
  cause?: string
  /** 覆盖目录里的通用建议；传 `[]` 表示"确定无建议"（与不传"用目录默认"不同） */
  suggestions?: string[]
  /** 原始错误全文（缺省 = 空串即无原文；★调用方应尽量带全） */
  raw?: string
  severity?: 'error' | 'warn'
}

/**
 * 构造诊断——`code` **必须已登记在 DIAG_CODES**（SSOT 约束：杜绝随手编码）。
 * 未登记 ⇒ 抛出（开发期即暴露，而非运行期悄悄出一个野码）。
 */
export function makeDiag(code: string, input: MakeDiagInput = {}): ProteusDiagnostic {
  const def = DIAG_CODES[code]
  if (!def) throw new Error(`[diag] 未登记的错误码：${code}（先加进 DIAG_CODES）`)
  return {
    code,
    title: def.title,
    severity: input.severity ?? 'error',
    location: input.location,
    context: input.context,
    // ★根因只在调用方**确定**时给；这里不做任何推断（硬约束 ②）
    cause: input.cause,
    suggestions: input.suggestions ?? def.hints ?? [],
    raw: input.raw ?? '',
  }
}

/* ============================================================
 * L4 呈现层（语义块 + ★原始错误全文始终打印）
 * ============================================================ */

export interface FormatOptions {
  /** 是否着色（缺省 = 由调用方按 TTY 决定；测试传 false） */
  color?: boolean
  /** `--raw`：只打原始错误（跳过语义块）——方案 §11 决策① */
  rawOnly?: boolean
  /** 缩进前缀（缺省 4 空格，与 ui.step 的 note 对齐） */
  indent?: string
}

const PIPE = '┆'

/** 单条诊断 → 多行文本（\n 连接）。`color=false` ⇒ 零 ANSI（重定向/CI 安全）。 */
export function formatDiagnostic(d: ProteusDiagnostic, opts: FormatOptions = {}): string {
  const useColor = opts.color === true
  const c = (fn: (s: string) => string, s: string): string => (useColor ? fn(s) : s)
  const pad = opts.indent ?? '    '
  const p = `${pad}${c(dim, PIPE)} `
  const out: string[] = []
  if (!opts.rawOnly) {
    out.push(p + c(red, `${d.code}`) + '  ' + c(bold, d.title))
    if (d.location) {
      const { file, line, column } = d.location
      const loc = file + (line != null ? `:${line}` : '') + (column != null ? `:${column}` : '')
      out.push(p + c(dim, '位置') + '  ' + loc)
    }
    if (d.context) out.push(p + c(dim, '上下文') + '  ' + d.context)
    if (d.cause) out.push(p + c(yellow, '根因') + '  ' + d.cause)
    if (d.suggestions && d.suggestions.length) {
      out.push(p + c(cyan, '建议'))
      d.suggestions.forEach((s, i) => out.push(p + `  ${i + 1}. ${s}`))
    }
  }
  if (d.raw && d.raw.trim()) {
    if (!opts.rawOnly) out.push(p + c(dim, '── 原始错误 ──'))
    for (const line of d.raw.replace(/\s+$/, '').split('\n')) out.push(p + line)
  }
  return out.join('\n')
}

/** 多条诊断 → 文本（空数组 ⇒ ''） */
export function formatDiagnostics(list: ProteusDiagnostic[], opts: FormatOptions = {}): string {
  return list.map((d) => formatDiagnostic(d, opts)).join('\n')
}

/** `--json` 结构化（供 CI / 工具消费；方案 §15.9） */
export function diagnosticsToJson(list: ProteusDiagnostic[]): string {
  return JSON.stringify({ ok: list.length === 0, diagnostics: list }, null, 2)
}

/* ============================================================
 * L0 采集层：工具链输出 → 结构化诊断
 * ============================================================ */

/** TypeScript：`file(line,col): error TS2322: msg`（tsc --pretty false） */
export function parseTscOutput(text: string): ProteusDiagnostic[] {
  const out: ProteusDiagnostic[] = []
  const re = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const tsCode = m[5]
    // TS 稳定码（BX0 实测有）——保真进 raw/context，Proteus 码另给一层
    out.push(
      makeDiag('PT-CT-001', {
        location: { file: m[1], line: Number(m[2]), column: Number(m[3]) },
        context: tsCode,
        raw: `${m[1]}(${m[2]},${m[3]}): ${m[4]} ${tsCode}: ${m[6]}`,
        severity: m[4] === 'warning' ? 'warn' : 'error',
      }),
    )
  }
  return out
}

/** Swift：`file:line:col: error: msg`（swiftc；BX0 实测无稳定码 ⇒ 只做定位） */
export function parseSwiftcOutput(text: string): ProteusDiagnostic[] {
  const out: ProteusDiagnostic[] = []
  const re = /^(.+?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m[4] === 'note') continue // note 是补充行，挂在上一 error 的原文里即可
    out.push(
      makeDiag('PT-BS-001', {
        location: { file: m[1], line: Number(m[2]), column: Number(m[3]) },
        raw: `${m[1]}:${m[2]}:${m[3]}: ${m[4]}: ${m[5]}`,
        severity: m[4] === 'warning' ? 'warn' : 'error',
      }),
    )
  }
  return out
}

/** esbuild：`errors[]` 是对象（BX0 实测：`{text, location:{file,line,column,lineText}}`，无稳定码） */
export function parseEsbuildErrors(errors: ReadonlyArray<unknown>): ProteusDiagnostic[] {
  const out: ProteusDiagnostic[] = []
  for (const e of errors) {
    const o = e as { text?: string; location?: { file?: string; line?: number; column?: number } }
    const text = o.text ?? String(e)
    const loc = o.location
    // 「Could not resolve」⇒ 依赖类；否则按语法类（分类只依据**确定的特征**，不猜）
    const code = /could not resolve/i.test(text) ? 'PT-BD-001' : 'PT-CS-001'
    out.push(
      makeDiag(code, {
        location: loc ? { file: loc.file ?? '', line: loc.line, column: loc.column } : undefined,
        raw: text,
      }),
    )
  }
  return out
}

/** 把一段多行工具输出**整体**作为一条「未知」诊断（保留全文——不了解形态时的诚实兜底） */
export function captureRaw(stage: DiagStage, raw: string, cause?: string): ProteusDiagnostic {
  return makeDiag(unknownCode(stage), { raw, cause })
}

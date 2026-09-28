// packages/compiler/src/vapor/sources.ts
// Vapor for Proteus IR · V2 Step 1 —— **响应式源识别**（方案 §4.3 Step 1）
//
// 【要解决什么】把 `<script setup>` 里的响应式声明识别出来，并分配**稳定 sourceId**。
//   `ref(0)` / `reactive({})` / `computed(() => …)` / `defineProps` / `defineModel`
//   —— 这五类就是模板动态绑定的全部上游来源。
//
// 【为什么用 @vue/compiler-sfc 的 compileScript 而不是自己扫 AST】
//   本仓已有定调（`sfc-macros.ts` 顶注，用户拍板）：「宏语义不由框架自造，对齐 Vue 官方」。
//   `compileScript` 给出的 `bindings` 是**官方语义分类**（setup-ref / setup-const / props / …），
//   比自己猜「这个符号是不是 ref」可靠得多——猜错会让 L1 槽位订阅到不存在的源（静默不更新）。
//
// 【稳定 id 的意义】sourceId 要进 `SubscriptionTable` 产物（方案 §4.4），
//   跨编译轮次必须可复现 ⇒ 按**源码声明顺序**分配（而不是哈希/Map 遍历顺序）。
import { parse as sfcParse, compileScript } from '@vue/compiler-sfc'

/** 响应式源种类（决定运行时如何订阅） */
export type SourceKind =
  | 'ref'        // ref(0) —— 订阅 .value
  | 'reactive'   // reactive({}) —— 订阅属性路径
  | 'computed'   // computed(() => …) —— ★只读派生；求值期间**不得**写其它源
  | 'props'      // defineProps —— 订阅 props.xxx
  | 'model'      // defineModel —— props + emit 双向
  | 'unknown'    // 识别不出（保守：一律判 L0，不订阅）

export interface ReactiveSource {
  /** 稳定 id（按声明顺序分配；进 SubscriptionTable 产物） */
  sourceId: number
  /** 源码变量名（模板表达式里出现的那个标识符） */
  name: string
  kind: SourceKind
  /** Vue 官方 bindings 分类（诊断用：解释「为什么判成这个 kind」） */
  vueBinding?: string
  /** 声明所在行（1-based；诊断定位用） */
  line?: number
}

export interface SourceScanResult {
  sources: ReactiveSource[]
  /** name → source（模板依赖分析用） */
  byName: Map<string, ReactiveSource>
  /** 扫描失败原因（ok=false 时）——调用方据此整体降级（不静默当成"没有源"） */
  ok: boolean
  error?: string
}

/**
 * 扫描 SFC 的响应式源（V2 Step 1）
 *
 * @param source 完整 SFC 源码
 * @param filename 用于 scoped id / 诊断
 */
export function scanReactiveSources(source: string, filename = 'anonymous.vue'): SourceScanResult {
  const empty: SourceScanResult = { sources: [], byName: new Map(), ok: false }
  let descriptor
  try {
    descriptor = sfcParse(source, { filename }).descriptor
  } catch (e) {
    return { ...empty, error: `SFC 解析失败：${String((e as Error)?.message ?? e)}` }
  }
  const scriptSrc = descriptor.scriptSetup?.content ?? descriptor.script?.content
  if (!scriptSrc) return { ...empty, ok: true } // 无脚本 ⇒ 无动态源（空集是合法结果）
  const scriptOffset = descriptor.scriptSetup?.loc.start.line ?? 1

  // ★官方语义分类（权威源）；失败即整体降级——宁可全 L0，不可猜错源
  let bindings: Record<string, string> = {}
  try {
    const compiled = compileScript(descriptor, { id: filename.replace(/[^\w]+/g, '-') }) as unknown as {
      bindings?: Record<string, string>
    }
    bindings = compiled.bindings ?? {}
  } catch (e) {
    return { ...empty, error: `compileScript 失败（宏语义不可得）：${String((e as Error)?.message ?? e)}` }
  }

  // 逐行扫描声明（按**源码顺序**分配 id ⇒ 产物可复现）
  const lines = scriptSrc.split('\n')
  const sources: ReactiveSource[] = []
  const byName = new Map<string, ReactiveSource>()

  /** 声明形态识别（正则只用于**定位声明形态**，符号语义一律以官方 bindings 为准） */
  const patterns: Array<{ re: RegExp; kind: SourceKind; group: number }> = [
    { re: /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*ref\s*[<(]/, kind: 'ref', group: 1 },
    { re: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*shallowRef\s*[<(]/, kind: 'ref', group: 1 },
    { re: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*reactive\s*[<(]/, kind: 'reactive', group: 1 },
    { re: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*computed\s*[<(]/, kind: 'computed', group: 1 },
    // defineProps / defineModel 的**多形态**：`const props = defineProps(…)`、`const props = defineProps<…>()`、
    // `const model = defineModel(…)` / `defineModel<…>()`；`defineProps({…})` 不取变量名（解构形式见下）
    { re: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*defineProps\s*[<(]/, kind: 'props', group: 1 },
    { re: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*defineModel\s*[<(]/, kind: 'model', group: 1 },
    // 解构形态：`const { title } = defineProps<…>()` —— 解构出的每个名字都是 props 源
    { re: /\b(?:const|let|var)\s*\{\s*([^}]+?)\s*\}\s*=\s*defineProps\s*[<(]/, kind: 'props', group: 1 },
    { re: /\b(?:const|let|var)\s*\{\s*([^}]+?)\s*\}\s*=\s*defineModel\s*[<(]/, kind: 'model', group: 1 },
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const { re, kind, group } of patterns) {
      const m = re.exec(line)
      if (!m) continue
      const raw = m[group]
      // 解构形态：逗号分隔（含重命名 `title: t` 取 t；带默认值 `a = 1` 取 a）
      const names = raw.includes(',') || raw.includes('{') || raw.includes(':') || raw.includes('=')
        ? raw.split(',').map((seg) => {
            const s = seg.trim().split(/[=:]/)[0].trim()
            return s.replace(/[^\w$]/g, '')
          }).filter(Boolean)
        : [raw.replace(/[^\w$]/g, '')]
      for (const name of names) {
        if (!name || byName.has(name)) continue
        const src: ReactiveSource = {
          sourceId: sources.length,
          name,
          kind,
          vueBinding: bindings[name],
          line: scriptOffset + i,
        }
        sources.push(src)
        byName.set(name, src)
      }
    }
  }

  // 补漏：官方 bindings 标为 props 但未在**本文件**声明（如 `defineProps` 无赋值形态）⇒ 仍要能订阅
  for (const [name, cls] of Object.entries(bindings)) {
    if (byName.has(name)) continue
    if (cls === 'props') {
      const src: ReactiveSource = { sourceId: sources.length, name, kind: 'props', vueBinding: cls }
      sources.push(src)
      byName.set(name, src)
    }
  }

  return { sources, byName, ok: true }
}

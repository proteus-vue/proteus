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
import type { parse as domParseType } from '@vue/compiler-dom'

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

/**
 * ★★可注入的 Vue 解析依赖（方案 §8.1「编译器不依赖 Vue 版本」的落实）
 *
 * 【为什么做成注入（本仓实测的动机）】vapor 只用到三个 API：`parse` / `compileScript` /
 *   `domParse`，但**直接 import 具体包**会把版本**硬编码**——无法验证 3.4 / 3.6 下行为一致。
 *   ⇒ 注入后，兼容性测试可传不同版本的解析器，**断言产物逐字节相同**。
 *   ★这也是本仓「SPI-First」方法论在编译器侧的应用：语义接口 + 可替换后端。
 */
export interface VueCompatDeps {
  sfcParse: typeof sfcParse
  compileScript: typeof compileScript
  domParse?: typeof domParseType
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
export function scanReactiveSources(
  source: string,
  filename = 'anonymous.vue',
  /** ★可注入（缺省用本仓锁定的 Vue 版本）；兼容性测试传 3.4 / 3.6 的解析器 */
  compat?: Pick<VueCompatDeps, 'sfcParse' | 'compileScript'>,
): SourceScanResult {
  const vueParse = compat?.sfcParse ?? sfcParse
  const vueCompileScript = compat?.compileScript ?? compileScript
  const empty: SourceScanResult = { sources: [], byName: new Map(), ok: false }
  let descriptor
  try {
    descriptor = vueParse(source, { filename }).descriptor
  } catch (e) {
    return { ...empty, error: `SFC 解析失败：${String((e as Error)?.message ?? e)}` }
  }
  const scriptSrc = descriptor.scriptSetup?.content ?? descriptor.script?.content
  if (!scriptSrc) return { ...empty, ok: true } // 无脚本 ⇒ 无动态源（空集是合法结果）
  const scriptOffset = descriptor.scriptSetup?.loc.start.line ?? 1

  // ★官方语义分类（权威源）；失败即整体降级——宁可全 L0，不可猜错源
  let bindings: Record<string, string> = {}
  try {
    const compiled = vueCompileScript(descriptor, { id: filename.replace(/[^\w]+/g, '-') }) as unknown as {
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
    for (const { re, kind: kindOfPattern, group } of patterns) {
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
        // ★★用官方 `bindings` **校正** kind（本仓实测发现的注释/实现不符）
        //
        // 【为什么必须校正】本文件顶注写着「符号语义一律以官方 bindings 为准」，
        //   但首版**只把 bindings 记进 `vueBinding` 做诊断**，kind 完全由上面的正则决定
        //   ——注释与实现不符。（实测暴露：把 `compileScript` 换成"返回空 bindings"的桩，
        //   产物**完全相同** ⇒ 说明它根本没参与判定。）
        //
        // 【校正规则】官方分类是权威：
        //   · `setup-ref` / `setup-maybe-ref` ⇒ 是响应式引用（正则若判成别的，以官方为准）
        //   · `props`                        ⇒ 强制为 props 源（**含未在本文匹配到的形态**）
        //   · `setup-const` / `literal-const`⇒ **不是**响应式源（如 `const n = Date.now()`）
        //     但 `setup-const` 也可能是 `const fn = () => …`（普通函数）——
        //     它若被正则误判成源，这里**降级为 unknown**（保守：不订阅）
        //   · 其他 / 缺失                    ⇒ 保留正则判定（bindings 可能不含 defineModel 等）
        const vb = bindings[name]
        const bindingsUsable = Object.keys(bindings).length > 0
        let kind = kindOfPattern
        // ★★按**官方实际的分类值**校准（本仓实测：我先验写错了两个值）
        //
        // 实测（3.5.42）`compileScript().bindings` 的真实取值：
        //   · `const count = ref(0)`            ⇒ `setup-maybe-ref`
        //   · `const state = reactive({...})`   ⇒ `setup-maybe-ref`
        //   · `const props = defineProps<…>()`  ⇒ **`setup-reactive-const`**（不是 'props'！）
        //   · `const model = defineModel<…>()`  ⇒ **`setup-ref`**（不是 'model'）
        //   · 解构 `const { title } = defineProps` ⇒ 各名字为 **`props`**
        // ⇒ 教训：**先验猜官方枚举值是靠不住的**——必须先打印实测（同"标定实验优先于推断"）。
        if (vb === 'setup-reactive-const') {
          // defineProps 的返回值（官方标 reactive-const）——是 props 源
          kind = 'props'
        } else if (vb === 'props') {
          // 解构出的 props 字段
          kind = 'props'
        } else if (vb === 'setup-ref') {
          // ★官方确定是 ref：可能是 `ref(...)`，也可能是 **`defineModel(...)`**
          //   （defineModel 的官方分类就是 setup-ref）⇒ **保留正则的 model 判定**：
          //   正则若判出 model（来自 `= defineModel(...)`），不要被覆盖成 ref。
          if (kindOfPattern === 'model' || kindOfPattern === 'props') {
            kind = kindOfPattern
          } else {
            kind = 'ref'
          }
        } else if (kindOfPattern !== 'ref' && kindOfPattern !== 'reactive' && kindOfPattern !== 'computed' && kindOfPattern !== 'props' && kindOfPattern !== 'model') {
          kind = kindOfPattern
        } else if (false) {
          // （不可达——保留结构以防后续扩展）
        } else if (vb === 'setup-maybe-ref') {
          // ★★`setup-maybe-ref` 要**保留正则的更精确判定**（本仓实测：一度校粗了）
          //
          // 【为什么】Vue 对 `const x = someCall()` 一律标 `setup-maybe-ref`——它**静态无法确定**
          //   是不是 ref（可能是 `reactive(...)` / `computed(...)` / 自定义 composable）。
          //   而**正则看得见调用名** ⇒ 能区分 `reactive` / `computed` / `ref`。
          //   ⚠ 我曾把 maybe-ref 一律校正为 `ref`，导致 `reactive({...})` 被误判
          //     （实测：vapor-v2 的「五类源」用例红）。
          //   ⇒ 规则：**正则已判出具体 kind 就信正则**；正则判不出的（兜底为 ref）才用官方值。
          if (kindOfPattern === 'ref') kind = 'ref'
          // 其余（reactive/computed/props/model）保留正则判定
        } else if (vb === 'setup-const' || vb === 'setup-let' || vb === 'literal-const') {
          // ★官方说它是普通 const ⇒ **不是**响应式源（如 `const n = Date.now()`）
          kind = 'unknown'
        } else if (bindingsUsable && vb === undefined) {
          // ★★官方 bindings **可用但不含该名字** ⇒ 它不是 setup 绑定（正则误判）
          //
          // 【为什么这条最关键（本仓实测）】首版只做"有值就校正"，于是「空 bindings 桩」
          //   与「正常 bindings」产出完全相同 ⇒ 说明官方语义**根本没参与判定**，
          //   正则才是真判据（与文件顶注声明的相反）。
          //   ⇒ 加这条：bindings 非空却不含该名 ⇒ 保守降级 `unknown`（不订阅）。
          //   ★注意 `bindingsUsable` 判据：`compileScript` 失败/空表时**不能**据此降级
          //     （那会把全部源误判为 unknown ⇒ 全 L0；宁可保留正则判定）。
          kind = 'unknown'
        }
        const src: ReactiveSource = {
          sourceId: sources.length,
          name,
          kind,
          vueBinding: vb,
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

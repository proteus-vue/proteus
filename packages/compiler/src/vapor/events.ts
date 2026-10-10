// packages/compiler/src/vapor/events.ts —— ★★**事件编译**（Vapor 交互闭环的第一半：编译期）
//
// 【这一层补的是什么（本仓 2026-10-01 核实的缺口）】
//   Vapor 链路此前只有**数据驱动**：订阅表把"源 → 槽位"的绑定编出来，运行时改数据就更新。
//   但**没有事件**——模板里的 `@click` 完全不进产物 ⇒ 真机上是"看得见、点不动"的死页面。
//   ⇒ 本模块编出两件产物（都是**纯数据**，可序列化、跨端禁 eval 的既有纪律）：
//     ① `events`：节点 → 事件名 → handler 名（`{nodeId, event, handler}`）
//     ② `handlers`：handler 名 → **动作列表**（要改哪个源、改成什么）
//
// 【为什么 handler 编成"动作列表"而不是表达式或代码】
//   · 模板里有赋值（`count++` / `count = count + 1`）——而表达式编译器**明确拒绝赋值**
//     （`expr.ts`：'表达式含赋值/自增（模板表达式应为纯求值）'，那条拒绝是**对的**：
//      渲染表达式必须纯）。⇒ 赋值是**语句**，需要独立的编译路径。
//   · 编成"动作"（`{source:'count', op:'add', value:1}` / `{source, op:'set', from:<ExprProgram>}`）
//     之后，设备端只做**执行**（无 eval、无字符串解析）——与订阅表"声明与实现分离"同一套纪律。
//
// 【★支持的动作（如实收窄，不支持就诊断——不静默）】
//   · `count++` / `++count` / `count--` / `--count`      → `{op:'add', value:±1}`
//   · `count += N` / `count -= N`（N 为数或纯表达式）      → `{op:'add', value:±N 程序}`
//   · `count = <纯表达式>`                                → `{op:'set', program}`
//   · `toggle = !toggle`（一元非）                         → `{op:'set', program}`（程序里有 unary）
//   · `show = item.id === 2`（含比较/逻辑）                → `{op:'set', program}`
//   · `$emit('e', expr)` / `$nav('屏')`                   → `{op:'emit'/'nav'}`（见下）
//   · ★★★**多语句**（`a++; b++`）→ 多动作按序（决策 #740 T1）
//   · ★★★**方法引用 / 无参调用**（`@click="handleTap"` / `handleTap()`）→
//     **编译期内联** `<script setup>` 方法体并降级为动作（决策 #740 T1；ref `.value` 自动解包）。
//   不支持（明确诊断，带修法）：带实参调用、方法内局部变量、if/else、循环、async、任意函数——
//   一律**产诊断**（守"封闭集、无 eval"纪律，**不引入解释器**）。
//   ★事件修饰符（2026-10-03 P2-3 起）：`.stop` / `.self` / `.once` **支持**（语义在运行时
//     `slot-runtime/dispatch.ts` 的共享派发器）；`.prevent` / `.passive` / `.capture` /
//     按键修饰符**产诊断但仍执行 handler**（没有对应语义，忽略是忠实的——见 splitModifiers）。
import type { ExprProgram, HandlerAction, EventHandlers } from '@proteus-vue/slot-runtime'
import { compileExprNode, type RefNames } from './expr'
import { parse as babelParse } from '@babel/parser'
import { parse as sfcParse } from '@vue/compiler-sfc'
import { parse as domParse } from '@vue/compiler-dom'
import type { VueCompatDeps } from './sources'
// ★模板源位置换算（唯一实现——与 template.ts 同口径；决策 #712/#713）
import { templateContentLineOffset, sourceLocOf, type SourceLoc } from './source-loc'
// ★kebab 形态内置组件名的**唯一**规范化入口（template.ts 同源导入——"一处实现"）
import { normalizeBuiltinTag } from './template'
// ★混排归一化（同一入口——三处遍历 id 同源）
import { normalizedChildSequence } from './text-runs'

/** 逻辑容器（与 template.ts/deps.ts **同一条判据**——透传：不占节点 id） */
const LOGICAL_CONTAINER_TAGS = new Set(['Transition', 'KeepAlive', 'Teleport', 'Suspense'])

/** 一条事件绑定（节点 → 事件 → handler） */
export interface EventBinding {
  /** 目标节点 id（模板序；与订阅表 nodeId 同源） */
  nodeId: number
  /** 语义事件名（本版只支持 `click` ⇒ 宿主 tap；其余诊断） */
  event: string
  /** handler 名（指向 `handlers`） */
  handler: string
  /**
   * ★★**事件修饰符（2026-10-03 · P2-3 批次）**——语义在运行时**共享派发器**
   *   （`@proteus-vue/slot-runtime` 的 `dispatchGesture`）里实现，各端宿主共用一份
   *   （本仓纪律：同一语义只允许一处实现；此前各端桥各写一份必然漂移）。
   *
   * 【为什么编译期就带上（而不是让宿主自己从模板文本里再解析一次）】
   *   修饰符是**语义**（跑完停 / 只在自身 / 只跑一次），不是渲染属性——
   *   解析一次、随产物下发（可序列化），运行时只做执行（与动作表同一套分工）。
   *
   * 只对**有真语义**的三个修饰符置位（缺省省略字段 ⇒ 产物对既有模板逐字节不变）：
   *   · `.stop`   —— 本跳跑完后终止冒泡
   *   · `.self`   —— 仅当命中节点 === 本节点时才跑
   *   · `.once`   —— 同一绑定只跑一次（状态由宿主按页面实例持有）
   *
   * 【`.prevent` / `.passive` / `.capture` ⇒ 诊断 + **不置位**（忽略修饰符本身，不阻碍 handler）】
   *   · `.prevent` / `.passive`：自绘 UI 无浏览器默认动作、也无滚动阻断语义 ⇒ 忽略是**忠实**的
   *     （不是"没实现对"）；产 warn 让差异可见（与"静默忽略"区分开）。
   *   · `.capture`：我们的模型是「内核冒泡链 + 宿主合成手势」，**没有捕获阶段** ⇒ 绑定会在
   *     命中/冒泡序上执行（顺序与 Web 的捕获语义不同）；产诊断说明差异，不静默。
   */
  stop?: boolean
  self?: boolean
  once?: boolean
  /**
   * ★★★**组件事件绑定**（P1-3 emits，2026-10-03）——父级写在**组件边界**上的自定义事件
   *   （`<Kid @bump="total = $event" />`）。
   *
   * 【为什么必须与手势绑定区分】手势绑定由宿主手势**经内核冒泡链**触发；组件事件由
   *   **子组件 `$emit`** 触发（"子→父"直接通知，不冒泡、不经 hitTest）。两者同住 `events`
   *   数组 ⇒ 派发侧必须能区分：手势派发**跳过**它；emit 路由按「边界节点 + 事件名」直接查表。
   */
  componentEmit?: boolean
  /**
   * ★★**绑定处的源位置**（决策 #712 · source map 地基）——`@click="…"` 在**整份 `.vue`** 里的
   *   `{ line, column }`（**1 基**；行已含模板块之前的前导行偏移，可直接对照文件行号）。
   *   App 端页面逻辑不打包（无 esbuild sourcemap）⇒ 是**唯一**能把"运行期事件/handler"映射回
   *   **模板源行**的桥（调试生态链的地基）。★缺省省略 ⇒ 既有产物逐字节不变。
   */
  loc?: { line: number; column: number }
}

/**
 * ★★★**一个动作**（handler 跑起来时改什么）——契约定义在**消费端** `@proteus-vue/slot-runtime`
 *   （`handler.ts`）：编译器**发射**、运行期 `runHandlerActions` **执行**——两处 import 同一份。
 *   ○ T1：`set`/`add`/`emit`/`nav`；★T2：`let`（局部变量）/`if`（条件动作）。
 */
export type { HandlerAction, EventHandlers } from '@proteus-vue/slot-runtime'

/**
 * ★★★**生命周期绑定**（P1-3 生命周期，2026-10-03）——模板 vnode 钩子 `@vue:mounted` 的编译产物。
 *
 * 【Vue 语义】`@vue:mounted` 是 Vue 3.3+ 的**模板** vnode 钩子（元素与组件都可用；
 *   旧写法 `@vnode-mounted` 在 3.4 已移除——官方错误信息原文："Use the vue: prefix instead"）。
 *   触发时机 = 该 vnode **挂载完成**。
 *
 * 【我方模型下的对应时机】端上无 DOM 插入动作；本批把 mounted 定义为「**首帧 mount 之后、
 *   路由到订阅更新链**」——即动作改了源 ⇒ 走 relink → 指令 → 内核重排（与 Vue 的
 *   "mounted 里改状态触发更新"**同一条链**，不是另造一套）。
 *
 * 【为什么单列本表（本仓实测的静默缺陷）】此前 `@vue:mounted` 落进"组件自定义事件"分支
 *   （`componentEmit`）⇒ 产物里出现对 `vue:mounted` 事件的监听——而**子组件永远不会
 *   `$emit('vue:mounted')`** ⇒ 钩子永不执行、且零诊断（最危险的一类静默）。⇒ 本表把它
 *   变成可执行的一等产物（与 events/handlers 同一套动作表语义）。
 */
export interface LifecycleBinding {
  /** 目标节点 id（模板序；与订阅表 nodeId 同源） */
  nodeId: number
  /** 钩子阶段（本批只支持 mounted；unmounted 等产精确诊断） */
  phase: 'mounted'
  /** handler 名（指向 `handlers`——与事件共用同一张动作表） */
  handler: string
}

export interface EventCompileResult {
  events: EventBinding[]
  handlers: EventHandlers
  /** ★P1-3 生命周期（无 `@vue:mounted` ⇒ **不产出字段**——既有产物逐字节不变） */
  lifecycle?: LifecycleBinding[]
  /**
   * ★★★**脚本级生命周期钩子**（B5，2026-10-10）——`<script setup>` 顶层 `onMounted(() => {…})` /
   *   `onUnmounted(() => {…})` 的**回调体降级为动作表**（与事件 handler 同族，复用同一执行器）。
   *
   * 【为什么需要】端上**不执行 script**（Vapor 分工）⇒ 此前 `onMounted` 里的逻辑永不运行
   *   （只产 `VAPOR_SCRIPT_LIFECYCLE_NOT_RUN` 诊断）。B5 把**可降级**的钩子体编译成动作——
   *   运行期在「**首帧 mount 之后**」（mounted）/「**宿主卸载时**」（unmounted）执行（与 `@vue:mounted` 同一时机链）。
   * 【诚实边界】只支持**可静态降级为封闭动作集**的体（赋值/自增/复合/`$emit`/`$nav`/`if`/局部变量/`console`）；
   *   其余（循环 / async / 宿主 API）⇒ **不产出** + 精确诊断（不静默）。★缺省省略字段 ⇒ 既有产物逐字节不变。
   */
  scriptLifecycle?: ScriptLifecycleBinding[]
  /** 不支持形态的诊断（带修法）——不静默 */
  diagnostics: Array<{ message: string; hint?: string }>
}

/** 脚本级生命周期绑定（无节点——作用于整屏） */
export interface ScriptLifecycleBinding {
  phase: 'mounted' | 'unmounted'
  /** handler 名（指向 `handlers`——与事件共用同一张动作表） */
  handler: string
}

/** 支持的语义事件（与宿主 GestureListener 的语义类型对齐：tap/longpress） */
const EVENT_ALIAS: Record<string, string> = {
  click: 'tap',
  tap: 'tap',
  longpress: 'longpress',
}

/**
 * ★★**事件修饰符分类（2026-10-03 · P2-3 批次）**——三个支持 / 两类"如实诊断"：
 *   · `SEMANTIC`：有真语义 ⇒ 随产物下发（见 `EventBinding.stop/self/once`），**不产诊断**；
 *   · `NOOP`：`.prevent` / `.passive`——自绘 UI 无浏览器默认动作可阻止、无滚动阻断语义
 *     ⇒ 忽略是**忠实**的（产 info 让差异可见，不阻碍 handler）；
 *   · `UNSUPPORTED`：`.capture` / `.native` / `.exact`——捕获阶段/原生事件/精确修饰键
 *     在我们的模型里没有对应物 ⇒ 产 warn + 说明差异（**仍执行 handler**，不静默丢弃）；
 *   · `KEY_MODIFIERS`：按键修饰符（`.enter` / `.ctrl` …）——宿主手势层没有键盘事件
 *     ⇒ 产 warn（修法：改用 input 的 confirm 类语义或自建键盘通道）。
 */
const SEMANTIC_MODIFIERS = new Set(['stop', 'self', 'once'])
const NOOP_MODIFIERS = new Set(['prevent', 'passive'])
const UNSUPPORTED_MODIFIERS = new Set(['capture', 'native', 'exact'])
const KEY_MODIFIERS = new Set([
  'ctrl', 'alt', 'shift', 'meta',
  'enter', 'tab', 'delete', 'esc', 'space', 'up', 'down', 'left', 'right',
  'pageup', 'pagedown', 'home', 'end',
])

/**
 * 拆 `@click.stop.prevent` → 事件名 + 修饰符判定。
 *
 * 【为什么不用正则一条条匹配】修饰符可**链式叠加**（`.stop.prevent`）且顺序无关；
 *   拆开逐个分类比"后缀正则"更不容易漏（首版 `MODIFIER_RE` 只看**末尾一个**，
 *   多修饰符时第二个会被当成事件名的一部分 ⇒ 落到"事件未支持"诊断，误导修法）。
 */
function splitModifiers(rawName: string): { event: string; stop: boolean; self: boolean; once: boolean; notes: string[] } {
  const parts = rawName.split('.').filter(Boolean)
  const event = parts[0] ?? ''
  let stop = false
  let self = false
  let once = false
  const notes: string[] = []
  for (const mod of parts.slice(1)) {
    const m = mod.toLowerCase()
    if (SEMANTIC_MODIFIERS.has(m)) {
      if (m === 'stop') stop = true
      else if (m === 'self') self = true
      else once = true
      continue
    }
    if (NOOP_MODIFIERS.has(m)) {
      notes.push(`\`.${m}\` 无对应语义（自绘 UI 无浏览器默认动作）——已忽略修饰符，handler 照常执行`)
      continue
    }
    if (UNSUPPORTED_MODIFIERS.has(m)) {
      notes.push(`\`.${m}\` 没有对应语义（无捕获阶段/原生事件/精确修饰键）——handler 按命中/冒泡序执行`)
      continue
    }
    if (KEY_MODIFIERS.has(m)) {
      notes.push(`按键修饰符 \`.${m}\` 无对应能力（宿主手势层无键盘事件）——改用 input 的确认语义或自建键盘通道`)
      continue
    }
    notes.push(`未知修饰符 \`.${m}\`（已忽略）——支持的语义修饰符：.stop / .self / .once`)
  }
  return { event, stop, self, once, notes }
}

/* ══════════ ★★★事件处理器「方法引用 / 方法体」支持（2026-10-10 · 决策 #740 T1）══════════
 *
 * 【为什么单列这一层】此前 `compileStatement` 只认**内联单语句**（`@click="count++"`）；
 *   真实页面几乎都写方法引用 `@click="handleTap"` ⇒ App 端编不出事件（`events:[]`）⇒
 *   **点了没反应**（Web/小程序照常 ⇒ 三端分叉、劝退级）。本层把 `<script setup>` 里的
 *   **方法体**在**编译期**降级为**动作列表**——与内联语句**同一套动作集**，运行期零改动地执行。
 *   ★守纪律：只做"可静态降级为封闭动作集"的子集，其余**明确诊断**（不静默），**不引入解释器**。
 *
 * 【ref `.value` 解包】方法体写 `count.value++`（script 里 ref 走 .value）；而 Vapor 数据模型里
 *   `count` 本身就是值 ⇒ 编译期把**已知 ref 源**上的 `.value` 解包为裸源（见 `expr.ts` 的 refNames）。
 */
interface BNode { type: string; [k: string]: unknown }
interface MethodDef { params: string[]; body: BNode[]; line: number; isAsync: boolean }
type MethodTable = Map<string, MethodDef>
interface StmtCtx { methods: MethodTable; refNames: RefNames }

/** 产生「带 `.value` 的 ref」的工厂（script 里这些名字是 ref，方法体访问走 `.value`） */
const REF_FACTORIES = new Set(['ref', 'shallowRef', 'computed', 'customRef', 'toRef', 'defineModel'])

/**
 * 从 `<script setup>` 源码抽取**方法表**（函数声明 / const 箭头/函数表达式）与 **ref 源名集合**。
 * ★用已在用的 `@babel/parser` 解析（与 `script.ts` 同源），不引入新依赖。
 */
function collectScriptMethods(scriptContent: string): {
  methods: MethodTable
  refNames: Set<string>
  lifecycle: Array<{ phase: 'mounted' | 'unmounted'; body: BNode[]; line: number }>
} {
  const methods: MethodTable = new Map()
  const refNames = new Set<string>()
  const lifecycle: Array<{ phase: 'mounted' | 'unmounted'; body: BNode[]; line: number }> = []
  if (!scriptContent.trim()) return { methods, refNames, lifecycle }
  let ast: { program?: { body?: BNode[] } }
  try {
    ast = babelParse(scriptContent, { sourceType: 'module', plugins: ['typescript'] }) as unknown as { program?: { body?: BNode[] } }
  } catch {
    return { methods, refNames, lifecycle }
  }
  for (const st of ast.program?.body ?? []) {
    // ★★★B5：顶层 `onMounted(() => {…})` / `onUnmounted(() => {…})` → 收集回调体（后续降级为动作）
    if (st.type === 'ExpressionStatement') {
      const ex = st.expression as BNode | undefined
      if (ex?.type === 'CallExpression' && (ex.callee as BNode | undefined)?.type === 'Identifier') {
        const hook = String((ex.callee as BNode).name)
        if (hook === 'onMounted' || hook === 'onUnmounted') {
          const arg0 = ((ex.arguments as BNode[]) ?? [])[0]
          if (arg0 && (arg0.type === 'ArrowFunctionExpression' || arg0.type === 'FunctionExpression')) {
            const ib = arg0.body as BNode
            const body = ib?.type === 'BlockStatement' ? ((ib.body as BNode[]) ?? []) : [{ type: 'ExpressionStatement', expression: ib }]
            lifecycle.push({ phase: hook === 'onMounted' ? 'mounted' : 'unmounted', body, line: (st.loc as { start?: { line?: number } })?.start?.line ?? 0 })
          }
        }
      }
      continue
    }
    if (st.type === 'FunctionDeclaration' && (st.id as BNode | undefined)?.name) {
      const body = (st.body as BNode | undefined)?.type === 'BlockStatement' ? ((st.body as BNode).body as BNode[] ?? []) : []
      methods.set(String((st.id as BNode).name), {
        params: paramNames(st.params as BNode[]),
        body,
        line: (st.loc as { start?: { line?: number } })?.start?.line ?? 0,
        isAsync: Boolean(st.async),
      })
      continue
    }
    if (st.type === 'VariableDeclaration') {
      for (const d of (st.declarations as BNode[]) ?? []) {
        const id = d.id as BNode | undefined
        const init = d.init as BNode | undefined
        if (id?.type !== 'Identifier' || !init) continue
        const name = String(id.name)
        if (init.type === 'CallExpression' && (init.callee as BNode | undefined)?.type === 'Identifier' && REF_FACTORIES.has(String((init.callee as BNode).name))) {
          refNames.add(name)
          continue
        }
        if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
          const ib = init.body as BNode
          const body = ib?.type === 'BlockStatement' ? ((ib.body as BNode[]) ?? []) : [{ type: 'ExpressionStatement', expression: ib }]
          methods.set(name, {
            params: paramNames(init.params as BNode[]),
            body,
            line: (st.loc as { start?: { line?: number } })?.start?.line ?? 0,
            isAsync: Boolean(init.async),
          })
        }
      }
    }
  }
  return { methods, refNames, lifecycle }
}

/** 取形参名（只认简单标识符；解构/默认值/rest 返回占位 '' 以触发"带参数形态"诊断） */
function paramNames(params: BNode[]): string[] {
  return (params ?? []).map((p) => (p.type === 'Identifier' && typeof p.name === 'string' ? String(p.name) : ''))
}

/** 赋值/自增**目标**的源名：`x` 或 `x.value`（ref 形态）→ `x`；其余返回 null（产诊断） */
function targetSourceName(node: BNode | undefined): string | null {
  if (!node) return null
  if (node.type === 'Identifier' && typeof node.name === 'string') return node.name
  if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && node.computed !== true) {
    const obj = node.object as BNode | undefined
    const prop = node.property as BNode | undefined
    if (obj?.type === 'Identifier' && prop?.type === 'Identifier' && prop.name === 'value') return String(obj.name)
  }
  return null
}

/** 方法体里 `$emit('name', payload?)` / `$nav('target')`——与内联模板同一套动作（单点实现） */
function specialCallActions(e: BNode, diag: (m: string, h?: string) => void, ctx: StmtCtx): HandlerAction[] | null {
  if (e.type !== 'CallExpression' || (e.callee as BNode | undefined)?.type !== 'Identifier') return null
  const fn = String((e.callee as BNode).name)
  const args = (e.arguments as BNode[]) ?? []
  if (fn === '$nav' || fn === '$navigate') {
    if (args.length === 1 && args[0]!.type === 'StringLiteral') return [{ op: 'nav', target: String(args[0]!.value) }]
    diag('$nav 的目标须为静态字符串字面量', "例：@tap=\"$nav('detail')\"（动态目标/表达式为后续批次）")
    return []
  }
  if (fn === '$emit') {
    if (args.length < 1 || args[0]!.type !== 'StringLiteral') {
      diag('$emit 的事件名须为静态字符串字面量', "例：$emit('bump', expr)")
      return []
    }
    const event = String(args[0]!.value)
    if (args.length === 1) return [{ op: 'emit', event }]
    if (args.length === 2) {
      const c = compileExprNode(args[1], ctx.refNames)
      if (!c.ok) {
        diag(`$emit 载荷表达式不支持：${c.unsupported}`, '载荷须为纯求值表达式（成员访问/算术/比较/逻辑/三元）')
        return []
      }
      return [{ op: 'emit', event, program: c.program }]
    }
    diag('$emit 的载荷只支持一个实参', "把多个值合成一个对象/数组再传")
    return []
  }
  return null
}

/**
 * 内联一个已注册方法（方法体降级）。★T2：支持**带形参**——形参在编译期降级为 `let` 绑定动作
 *   （实参为 `<纯表达式>`，在**调用点作用域**求值）；自递归为明确边界——产诊断，不静默。
 *   @param argNodes 调用处实参 AST（裸引用无参传空数组）；形参 > 实参 ⇒ 多余形参绑 `undefined` 之外
 *     仍**拒**（实参个数须与形参一致，避免"以为传了其实没传"的静默）。
 */
function inlineMethod(name: string, argNodes: BNode[], diag: (m: string, h?: string) => void, ctx: StmtCtx, depth: number): HandlerAction[] {
  const m = ctx.methods.get(name)
  if (!m) return []
  if (depth > 8) {
    diag(`方法 ${name}() 递归展开过深（可能是自调用/循环引用）`, '请拆分方法或改用内联写法')
    return []
  }
  if (m.isAsync || m.body.some((s) => s.type === 'AwaitExpression')) {
    // async/await 有**时序/微任务**语义（本运行期同步执行动作表，不建模 promise）⇒ 明确拒绝，不静默半支持。
    diag(`方法 ${name}() 是 async / 含 await——本版不支持异步 handler`, '把异步逻辑移出事件处理器（如用 watch 派生），或改为同步方法')
    return []
  }
  // ★T2：形参绑定（`let p = <实参>`）——先于方法体动作。
  const bindings: HandlerAction[] = []
  if (m.params.length > 0) {
    if (m.params.some((p) => p === '')) {
      diag(`方法 ${name}() 的形参含解构/默认值/rest——本版只支持简单形参`, '把形参改成简单标识符，或在调用点先算好')
      return []
    }
    if (m.params.length !== argNodes.length) {
      diag(
        `方法 ${name}() 需要 ${m.params.length} 个实参，调用处给了 ${argNodes.length} 个`,
        `调用处补足实参（如 @click="${name}(…)"），或把方法改成无参`,
      )
      return []
    }
    for (let i = 0; i < m.params.length; i++) {
      const c = compileExprNode(argNodes[i], ctx.refNames)
      if (!c.ok) {
        diag(`方法 ${name}() 的第 ${i + 1} 个实参表达式不支持：${c.unsupported}`, '实参须为纯求值表达式（成员访问/算术/比较/逻辑/三元）')
        return []
      }
      bindings.push({ op: 'let', name: m.params[i]!, program: c.program })
    }
  } else if (argNodes.length > 0) {
    diag(`方法 ${name}() 无参，但调用处传了实参`, `去掉实参（写 @click="${name}"）`)
    return []
  }
  return [...bindings, ...degradeStatements(m.body, diag, ctx, depth + 1)]
}

/** 降级**一条表达式语句**（内联模板语句 / 方法体语句共用） */
function degradeExpr(e: BNode, diag: (m: string, h?: string) => void, ctx: StmtCtx, depth: number): HandlerAction[] {
  const sp = specialCallActions(e, diag, ctx)
  if (sp !== null) return sp

  if (e.type === 'UpdateExpression') {
    const name = targetSourceName(e.argument as BNode)
    if (!name) {
      diag('自增/自减的目标须为源或 `源.value`', '例：count++ / count.value++')
      return []
    }
    return [{ op: 'add', source: name, program: { k: 'lit', v: e.operator === '--' ? -1 : 1 } }]
  }

  if (e.type === 'AssignmentExpression') {
    const name = targetSourceName(e.left as BNode)
    if (!name) {
      diag('赋值左侧须为源或 `源.value`', '只支持改一个顶层源（如 `count = …` / `count.value = …`）')
      return []
    }
    const op = String(e.operator)
    if (op === '=' || op === '+=' || op === '-=') {
      const c = compileExprNode(e.right, ctx.refNames)
      if (!c.ok) {
        diag(`handler 右侧表达式不支持：${c.unsupported}`, '本版支持纯求值表达式（成员访问/算术/比较/逻辑/三元）')
        return []
      }
      if (op === '=') return [{ op: 'set', source: name, program: c.program }]
      const program: ExprProgram = op === '+=' ? c.program : { k: 'bin', op: '*', l: { k: 'lit', v: -1 }, r: c.program }
      return [{ op: 'add', source: name, program }]
    }
    diag(`不支持的赋值运算符 \`${op}\``, '本版支持 = / += / -=')
    return []
  }

  // ★方法引用（裸标识符）→ 内联方法体（无实参）
  if (e.type === 'Identifier' && ctx.methods.has(String(e.name))) return inlineMethod(String(e.name), [], diag, ctx, depth)
  if (e.type === 'Identifier') {
    diag(
      `handler 里的 \`${String(e.name)}\` 不是本组件方法（本版不支持裸标识符 handler）`,
      '在 <script setup> 里用 `function 名字() {…}` 定义该方法，或改用内联表达式（如 `@click="count++"`）',
    )
    return []
  }

  // ★方法调用 `name(...)` → 内联方法体（★T2：带实参——实参降级为 `let` 形参绑定）
  if (e.type === 'CallExpression' && (e.callee as BNode | undefined)?.type === 'Identifier' && ctx.methods.has(String((e.callee as BNode).name))) {
    const name = String((e.callee as BNode).name)
    return inlineMethod(name, (e.arguments as BNode[]) ?? [], diag, ctx, depth)
  }

  if (e.type === 'CallExpression') {
    const callee = e.callee as BNode | undefined
    const label = callee?.type === 'Identifier' ? `${String(callee.name)}(…)` : '调用表达式'
    // ★★★T3（2026-10-10）：`console.<level>(…)` ⇒ `log` 动作（端上→面板 Console）。
    //   真实方法体几乎都带 console 调试；端上不执行 script ⇒ 此前调用被整条拒（点了没反应）。
    //   注意：`console.log` 的 callee 是 **MemberExpression**（object=console / property=log）。
    if (callee?.type === 'MemberExpression' && callee.computed !== true) {
      const obj = callee.object as BNode | undefined
      const prop = callee.property as BNode | undefined
      if (obj?.type === 'Identifier' && obj.name === 'console' && prop?.type === 'Identifier') {
        const lv = String(prop.name)
        if (lv === 'log' || lv === 'info' || lv === 'warn' || lv === 'error' || lv === 'debug') {
          const progs: ExprProgram[] = []
          for (const raw of (e.arguments as BNode[]) ?? []) {
            const c = compileExprNode(raw, ctx.refNames)
            if (!c.ok) {
              diag(`console.${lv} 的实参表达式不支持：${c.unsupported}`, '日志实参须为纯求值表达式（成员访问/算术/比较/逻辑/三元/模板串）')
              return []
            }
            progs.push(c.program)
          }
          return [{ op: 'log', level: lv as 'log' | 'info' | 'warn' | 'error' | 'debug', programs: progs }]
        }
        diag(`不支持 \`console.${lv}\``, '本版只认 console.log/info/warn/error/debug（其余 console.* 见封闭集纪律）')
        return []
      }
    }
    // ★`emit(...)`（script 局部名，非 `$emit`）的变体误用——给专门的修法（而不是笼统"形态不支持"）
    if (callee?.type === 'Identifier' && /^(?:emit|\$emits?)$/.test(String(callee.name))) {
      diag(
        `handler 里的 \`${label}\` 不是受支持的 $emit 形态`,
        "模板里请写 `$emit('事件名')` 或 `$emit('事件名', 表达式)`（静态名 + 最多一个实参）",
      )
      return []
    }
    diag(
      `handler 形态不支持：\`${label}\``,
      '在 <script setup> 里定义同名方法（`function name() {…}`）后写 `@click="name"` / `name()` 即可；不支持任意函数',
    )
    return []
  }

  diag(`handler 形态不支持：\`${String(e.type)}\``, "本版支持：`x++` / `x = <纯表达式>` / `x += n` / `$emit(...)` / `$nav('屏')` / 方法引用")
  return []
}

/** 把**语句序列**逐条降级为动作（多语句 → 多动作，按序执行——"先算后写"语义保留）。
 *  ★T2 扩展：`if (cond) {…} else {…}` → `{op:'if',…}`；`const y = <纯表达式>` → `{op:'let',…}`。 */
function degradeStatements(stmts: BNode[], diag: (m: string, h?: string) => void, ctx: StmtCtx, depth: number): HandlerAction[] {
  const out: HandlerAction[] = []
  for (const st of stmts) {
    // ① 表达式语句（自增/赋值/复合/$emit/$nav/调用）——T1 主干
    if (st.type === 'ExpressionStatement') {
      out.push(...degradeExpr(st.expression as BNode, diag, ctx, depth))
      continue
    }
    // ② ★T2 **if / else**：两臂各自降级为动作子列表（条件为纯表达式）
    if (st.type === 'IfStatement') {
      const cond = compileExprNode(st.test, ctx.refNames)
      if (!cond.ok) {
        diag(`if 条件表达式不支持：${cond.unsupported}`, '条件须为纯求值表达式（成员访问/比较/逻辑）')
        continue
      }
      const then = degradeStatements(blockBody(st.consequent as BNode | undefined), diag, ctx, depth)
      const alt = st.alternate ? degradeStatements(blockBody(st.alternate as BNode | undefined), diag, ctx, depth) : undefined
      out.push({ op: 'if', cond: cond.program, then, ...(alt && alt.length ? { else: alt } : {}) })
      continue
    }
    // ③ ★T2 **局部变量**：`const y = <纯表达式>` / `let y = <纯表达式>` → `{op:'let'}`
    if (st.type === 'VariableDeclaration') {
      for (const d of (st.declarations as BNode[]) ?? []) {
        const id = d.id as BNode | undefined
        const init = d.init as BNode | undefined
        if (id?.type !== 'Identifier' || !init) {
          diag('局部变量须为「简单名 = 纯表达式」（不支持解构 / 无初值 / 多个声明混合）', '例：const n = count * 2')
          continue
        }
        const c = compileExprNode(init, ctx.refNames)
        if (!c.ok) {
          diag(`局部变量 \`${String(id.name)}\` 的初值表达式不支持：${c.unsupported}`, '初值须为纯求值表达式')
          continue
        }
        out.push({ op: 'let', name: String(id.name), program: c.program })
      }
      continue
    }
    // ④ 其余语句一律**明确诊断**（守封闭集：循环 / async / 任意 JS 不做）
    diag(
      `方法体含暂不支持的语句（${st.type === 'ForStatement' || st.type === 'WhileStatement' ? '循环' : String(st.type)}）`,
      "本版支持：赋值 / 自增自减 / 复合赋值 / `$emit(...)` / `$nav('屏')` / `if/else` / 局部变量；循环 / async 为明确不做",
    )
  }
  return out
}

/** 取语句的语句块体（`BlockStatement` → 其 body；单条语句 → [它]） */
function blockBody(node: BNode | undefined): BNode[] {
  if (!node) return []
  if (node.type === 'BlockStatement') return (node.body as BNode[]) ?? []
  return [node]
}

/**
 * 编译 `@event="statement"` 的语句部分 → 动作列表（整串 babel 解析）。
 *   · 单条表达式语句（自增/赋值/复合/$emit/$nav）→ 既有形态；
 *   · **多语句**（`a++; b++`）→ 多动作按序；
 *   · **方法引用 / 无参调用**（`handleTap` / `handleTap()`）→ 内联该方法体降级后的动作。
 *   ★不引入通用 JS 解释器（违背"封闭集"决策）；不支持形态**产诊断**（不静默）。
 */
function compileStatement(code: string, diag: (m: string, h?: string) => void, ctx: StmtCtx): HandlerAction[] {
  const src = code.trim()
  if (!src) {
    diag('handler 为空', '例：@click="count++"')
    return []
  }
  let ast: { program?: { body?: BNode[] } }
  try {
    ast = babelParse(src, { sourceType: 'module', plugins: ['typescript'] }) as unknown as { program?: { body?: BNode[] } }
  } catch {
    diag(`handler 解析失败（语法无法识别）：\`${src.slice(0, 40)}\``, '请检查写法（本版支持赋值/自增/复合赋值/$emit/$nav/方法引用）')
    return []
  }
  const stmts = ast.program?.body ?? []
  if (stmts.length === 0) {
    diag('handler 为空', '例：@click="count++"')
    return []
  }
  // ★★**整条拒绝**（关键纪律）：任一条语句降级失败 ⇒ **整条 handler 不产出动作**
  //   （绝不执行"部分动作"——那会用错值静默跑，正是本仓最忌的形态；与"宁可拒绝不可静默错"同源）。
  let errored = false
  const countingDiag = (m: string, h?: string): void => {
    errored = true
    diag(m, h)
  }
  const acts = degradeStatements(stmts, countingDiag, ctx, 0)
  return errored ? [] : acts
}

/**
 * 从 SFC 模板源码编出事件绑定与 handler（**不需要 Vue 编译器**：`@click="…"` 是纯文本形态）。
 *
 * 【为什么用正则扫模板而不是 AST】事件属性形态极规整（`@名字【优先级前缀】="值"`），
 *   而 Vue 官方模板 AST 的 props 只在 **template.ts 的遍历里**可取——本模块要保持
 *   "只依赖源码文本"以便独立单测。★与 template.ts 的节点 id 分配**必须同序**：
 *   那边按**元素出现顺序**（`nextElementIndex++`）分配，本模块用**同一个遍历顺序**推导 id。
 */
export function compileEvents(
  source: string,
  /** ★可注入（缺省用本仓锁定的 Vue 版本）；与 deps.ts 同形——兼容性测试可传 3.4/3.6 解析器 */
  compat?: Pick<VueCompatDeps, 'sfcParse' | 'domParse'>,
): EventCompileResult {
  const out: EventCompileResult = { events: [], handlers: {}, diagnostics: [] }
  const diag = (message: string, hint?: string): void => {
    out.diagnostics.push({ message, hint })
  }

  const vueParse = compat?.sfcParse ?? sfcParse
  const dom = compat?.domParse ?? domParse
  let body = ''
  // ★事件源位置换算（决策 #712）：`domParse` 的 loc 是**模板内容**相对行——
  //   要锚回**整份 `.vue`** 的行号，须加上"内容起点之前的行数"（唯一实现在 source-loc.ts）。
  let bodyLineOffset = 0
  // ★★★`<script setup>` 源码（方法体降级用；决策 #740 T1）——与 template 同一次 SFC 解析取出
  let scriptContent = ''
  try {
    const parsed = vueParse(source, { filename: 'anonymous.vue' }).descriptor
    body = parsed.template?.content ?? ''
    bodyLineOffset = templateContentLineOffset(source, parsed)
    scriptContent = [parsed.scriptSetup?.content, parsed.script?.content].filter((s): s is string => Boolean(s)).join('\n')
  } catch {
    diag('SFC 解析失败（事件编译跳过）', '请检查 SFC 形态')
    return out
  }
  if (!body.trim()) {
    diag('未找到 <template> 块（事件编译跳过）', '请检查 SFC 形态')
    return out
  }
  let ast: { children: unknown[] }
  try {
    ast = dom(body, { comments: false }) as unknown as { children: unknown[] }
  } catch (e) {
    diag(`模板解析失败（事件编译跳过）：${String((e as Error)?.message ?? e)}`, '请检查模板语法')
    return out
  }

  // ★★★方法表 + ref 源名（决策 #740 T1）：`@click="handleTap"` 的方法体在此**编译期降级**为动作。
  const { methods: scriptMethods, refNames, lifecycle: scriptHooks } = collectScriptMethods(scriptContent)
  const ctx: StmtCtx = { methods: scriptMethods, refNames }

  type EvNode = {
    type: number
    tag?: string
    props?: Array<{
      type: number
      name: string
      arg?: { content?: string; isStatic?: boolean }
      exp?: { content?: string; loc?: { start?: { line?: number; column?: number } } }
      modifiers?: Array<{ content?: string } | string>
    }>
    children?: unknown[]
  }

  const handlerSeq: string[] = []
  /**
   * ★绑定处源位置（决策 #712）：从 `@click` 属性的 exp 取 `{line,column}`；**列**用模板内容相对值（1 基），
   *   **行**加上 `bodyLineOffset` 换算成**整份 `.vue` 文件**的 1 基行号（调试面板/日志据此直接跳转源文件）。
   */
  const locOf = (p: { exp?: { loc?: { start?: { line?: number; column?: number } } } }): SourceLoc | undefined =>
    sourceLocOf(p.exp?.loc, bodyLineOffset)
  /**
   * 在一个元素上收集事件（正则时代的属性扫描换成 AST 走查——**同一条解析器**：
   *   正则版在「逻辑容器/插槽声明」处会把不产元素的标签算进 id ⇒ 其后的事件 nodeId 漂移，
   *   实测：`<KeepAlive>` 之后 `@click` 的 nodeId 比模板多 1 ⇒ handler 挂错节点）。
   */
  const collectEvents = (n: EvNode, id: number, isComponentTag: boolean): void => {
    const onProps = (n.props ?? []).filter((p) => p.type === 7 && p.name === 'on')
    for (const p of onProps) {
      const argNode = p.arg
      // ★动态事件名（`@[ev]`）：arg.isStatic === false ⇒ 不进产物，但要**产诊断**（不静默）
      if (argNode && argNode.isStatic === false) {
        diag(`动态事件名未支持：@[${String(argNode.content ?? 'expr')}]`, '请改用静态事件名（如 @click / @tap）')
        continue
      }
      // 修饰符在 AST 里已拆开（`@click.stop` ⇒ arg='click' + modifiers=['stop']）——
      //   重新拼回 `click.stop` 走既有 splitModifiers（诊断文案/置位规则**零变化**）。
      const mods = (p.modifiers ?? []).map((x) => (typeof x === 'string' ? x : String(x?.content ?? ''))).filter(Boolean)
      // ★★★**生命周期钩子 `@vue:*`**（P1-3 生命周期，2026-10-03）——必须在事件名解析**之前**拦截：
      //   否则 `vue:mounted` 会落进"组件自定义事件"分支 ⇒ 产物里出现对 `vue:mounted` 事件的监听，
      //   而子组件永远不会 `$emit('vue:mounted')` ⇒ **钩子永不执行且零诊断**（本仓实测的静默缺陷）。
      //   ★Vue 官方错误信息确认本语法为现行写法（@vnode-* 已在 3.4 移除："Use the vue: prefix instead"）。
      const vueHook = String(argNode?.content ?? '')
      if (vueHook.startsWith('vue:')) {
        const phase = vueHook.slice('vue:'.length)
        if (mods.length > 0) {
          diag(`@${vueHook} 不支持修饰符 \`.${mods.join('.')}\``, 'vnode 钩子没有修饰符语义——请去掉修饰符')
        }
        if (phase === 'mounted') {
          const actions = compileStatement(String(p.exp?.content ?? '').trim(), diag, ctx)
          if (actions.length > 0) {
            const handler = `h${handlerSeq.length}`
            handlerSeq.push(handler)
            out.handlers[handler] = actions
            if (!out.lifecycle) out.lifecycle = []
            out.lifecycle.push({ nodeId: id, phase: 'mounted', handler })
          }
        } else if (phase === 'unmounted') {
          diag(
            `@vue:unmounted 未支持（静态树模型没有"卸载时点"——元素不会从树里摘除）`,
            '离场用 <Transition>（可见性切换，已支持）或宿主通道；v-if 的结构摘除为后续批次',
          )
        } else {
          diag(`@vue:${phase} 未支持（本版支持 @vue:mounted）`, '其余 vnode 钩子（updated / before-mount / 等）为后续批次')
        }
        continue
      }
      const rawName = [String(argNode?.content ?? ''), ...mods].join('.')
      const value = String(p.exp?.content ?? '').trim()
      const loc = locOf(p)   // ★绑定处源位置（决策 #712）
      // ★★修饰符解析（P2-3）：先拆修饰符再判事件名（否则 `click.stop` 整串当过事件名）
      const { event: evName, stop, self, once, notes: modNotes } = splitModifiers(rawName)
      const name = evName.toLowerCase()
      const semantic = EVENT_ALIAS[name]
      if (!semantic) {
        // ★★★**组件自定义事件**（P1-3 emits，2026-10-03）：组件边界上的非手势事件名
        //   = 监听子组件的 `$emit`（Vue 语义）⇒ 产 **componentEmit 绑定**（不冒泡、不 hitTest）。
        //   ★非组件元素上的自定义事件名仍走"事件未支持"诊断（原生元素没有自定义事件源）。
        if (isComponentTag) {
          const actions = compileStatement(value, diag, ctx)
          if (actions.length === 0) continue
          if (stop || self) {
            diag(
              `组件自定义事件 @${rawName} 上的修饰符无意义（组件事件不冒泡）——已忽略`,
              '组件事件是"子→父"直接通知，没有冒泡链；.once 受支持（绑定级一次）',
            )
          }
          const handler = `h${handlerSeq.length}`
          handlerSeq.push(handler)
          out.handlers[handler] = actions
          out.events.push({
            nodeId: id,
            event: evName,
            handler,
            componentEmit: true,
            ...(loc ? { loc } : {}),
            ...(once ? { once: true } : {}),
          })
          continue
        }
        // 事件本身不支持 ⇒ 只报事件（修饰符诊断在此时无意义，避免噪音误导修法）
        diag(`事件未支持：@${rawName}`, '本版支持 click / tap / longpress（分别映射宿主的 tap/longpress）；组件上的自定义事件需写成 `<Kid @my-event="..." />`')
        continue
      }
      // 修饰符诊断（`.prevent` 等无对应语义 / 按键修饰符 / 未知）——**不阻碍绑定**
      for (const note of modNotes) diag(`@${rawName}：${note}`, '语义修饰符见 packages/slot-runtime/src/dispatch.ts（.stop/.self/.once）')
      const actions = compileStatement(value, diag, ctx)
      if (actions.length === 0) continue
      // handler 命名：`h<序号>`（确定性——同一份源码每次编译同名，便于对账）
      const handler = `h${handlerSeq.length}`
      handlerSeq.push(handler)
      out.handlers[handler] = actions
      // ★修饰符只在**有真语义**时置位（缺省省略字段 ⇒ 既有模板产物逐字节不变）
      out.events.push({
        nodeId: id,
        event: semantic,
        handler,
        ...(loc ? { loc } : {}),
        ...(stop ? { stop: true } : {}),
        ...(self ? { self: true } : {}),
        ...(once ? { once: true } : {}),
      })
    }
    // ★★★B4-T1（2026-10-10）：**v-model 回写**——把 `v-model="x"` 编成「下行值槽位（deps 已发 text.content）+
    //   **回写动作**（`input` 事件 ⇒ `set x = $event`）」。此前只有下行、无回写 ⇒ 输入不写回数据。
    //   ★缺省只处理**原生元素 + 纯标识符 + 无修饰符**（其余产诊断，不静默半支持）：
    //     · 组件上的 v-model ⇒ 组件事件通道（另批）；成员路径（`o.x`）⇒ 需成员写（另批）；
    //     · `.lazy`（改 change 事件）/`.trim`/`.number`（值转换）⇒ 需宿主转换（另批）。
    //   ★诚实边界：本批产出**回写契约**（产物含 input 绑定）；**三端原生输入控件（键盘/编辑框）为下一步**——
    //     控件未接前 `input` 事件无源 ⇒ 端上输入暂不生效（故 template.ts 仍保留"输入控件待接"诊断）。
    for (const p of (n.props ?? []).filter((pp) => pp.type === 7 && pp.name === 'model')) {
      const expStr = String(p.exp?.content ?? '').trim()
      const mods = (p.modifiers ?? [])
        .map((m) => (typeof m === 'string' ? m : (m?.content ?? '')))
        .filter(Boolean)
      if (isComponentTag) {
        // ★★★B4-T3a（2026-10-10）：**组件 v-model 脱糖**——`<Kid v-model="x">` 等价于
        //   `:model-value="x"`（下行，deps 已发 `component.modelValue`）+ `@update:modelValue="x = $event"`
        //   （上行，走**已有的**组件 emit 路由：子 `$emit('update:modelValue', v)` → 父 handler）。
        //   ★与原生元素 v-model 不同：这里**不需要宿主输入控件**（上行是"子→父"直接通知，已支持）。
        //   ★成员路径/修饰符仍不在此批（组件 v-model 的 arg=自定义名如 `v-model:foo` 亦然）——本批只做默认 `x`。
        if (p.arg != null && String(p.arg.content ?? '') !== '' && String(p.arg.content ?? '') !== 'modelValue') {
          diag(`组件命名 v-model:${String(p.arg.content)} 未支持（本批只做默认 v-model）`, '暂用 `:foo` + `@update:foo` 显式写法')
          continue
        }
        if (!/^[A-Za-z_$][\w$]*$/.test(expStr)) {
          diag(`组件 v-model="${expStr}" 暂只支持纯标识符（成员路径需成员写通道）`, '改用标识符，或手写 @update:modelValue 处理器')
          continue
        }
        if (mods.length > 0) {
          diag(`组件 v-model 修饰符 .${mods.join('.')} 未支持`, '去掉修饰符，或手写 @update:modelValue 处理器做转换')
          continue
        }
        const handler = `h${handlerSeq.length}`
        handlerSeq.push(handler)
        out.handlers[handler] = [{ op: 'set', source: expStr, program: { k: 'root', name: '$event' } }]
        const loc = locOf(p)
        out.events.push({ nodeId: id, event: 'update:modelValue', handler, componentEmit: true, ...(loc ? { loc } : {}) })
        continue
      }
      if (!/^[A-Za-z_$][\w$]*$/.test(expStr)) {
        diag(`v-model="${expStr}" 的回写暂只支持纯标识符（成员路径需成员写通道）`, '改用标识符，或在 change 处理器里手写赋值')
        continue
      }
      if (mods.length > 0) {
        diag(`v-model 修饰符 .${mods.join('.')} 暂未支持（.lazy/.trim/.number 需宿主值转换）`, '去掉修饰符，或手写 @input 处理器做转换')
        continue
      }
      const handler = `h${handlerSeq.length}`
      handlerSeq.push(handler)
      // `x = $event`：运行期 `$event` = 输入控件抛出的值（见 HandlerRunContext.event）
      out.handlers[handler] = [{ op: 'set', source: expStr, program: { k: 'root', name: '$event' } }]
      const loc = locOf(p)
      out.events.push({ nodeId: id, event: 'input', handler, ...(loc ? { loc } : {}) })
    }
  }
  /** 跳过子树前先检查是否藏了事件（藏了就诊断——"静默丢事件"比"诊断拒绝"更危险） */
  const hasEventHandler = (n: EvNode): boolean =>
    (n.props ?? []).some((p) => p.type === 7 && p.name === 'on')
  const warnSkippedSubtree = (n: EvNode, why: string): void => {
    const stack = [n]
    while (stack.length > 0) {
      const cur = stack.pop() as EvNode
      if (hasEventHandler(cur)) {
        diag(`被跳过的内容里有事件绑定（${why}）——该事件不生效`, '把事件移到会渲染的元素上')
        return
      }
      for (const c of (cur.children ?? []) as EvNode[]) if (c.type === 1) stack.push(c)
    }
  }

  /**
   * ★元素序 id：与 template.ts **同一条判据**（下表是"不占 id"的三类——两处必须一致，
   *   否则事件 nodeId 与模板节点错位：症状 = handler 挂到邻居节点上、零报错）。
   *   ① 逻辑容器（透传）② 带 v-slot 的 `<template>`（插槽声明）③ Suspense 只走 #default。
   */
  const walk = (children: unknown[], parentComponent: boolean): void => {
    // ★★★混排归一化（2026-10-03 · 与 template.ts/deps.ts **同一入口**——三处 id 必须同源）
    for (const raw of normalizedChildSequence(children)) {
      const n = raw as EvNode
      if (n.type !== 1) continue
      // ★★kebab 形态的内置组件规范化（2026-10-03 · 与 template.ts **同一条判据**）：
      //   `<keep-alive>`/`<transition>` 等与 PascalCase 等价（官方实证）——不规范化会让
      //   本函数把逻辑容器算进元素序 ⇒ 其后事件 nodeId 漂移（与 P1-3 修过的同类缺陷同源）。
      const tag = normalizeBuiltinTag(n.tag ?? '')
      // ① 插槽声明 `<template #x>`：不占 id（内容元素照常走——它们才是渲染节点）
      if (tag === 'template') {
        const vsProp = (n.props ?? []).find((p) => p.type === 7 && p.name === 'slot')
        if (vsProp) {
          if (hasEventHandler(n)) diag('<template #x> 上的事件不生效（插槽声明不产元素）', '把事件移到插槽内容元素上')
          if (vsProp.exp?.content) {
            // 作用域插槽的诊断在 template.ts 产（此处不重复）
          }
          walk((n.children ?? []) as unknown[], parentComponent)
          continue
        }
      }
      // ② 逻辑容器：不占 id
      if (LOGICAL_CONTAINER_TAGS.has(tag)) {
        if (hasEventHandler(n)) diag(`<${tag}> 上的事件不生效（逻辑容器不产元素）`, '把事件移到其子元素上')
        if (tag === 'Suspense') {
          // 只走 #default（与 template.ts 同口径）；#fallback 整棵跳过——藏了事件要报
          const kids = (n.children ?? []) as EvNode[]
          const slotOf = (c: EvNode): string | undefined =>
            (c.props ?? []).find((p) => p.type === 7 && p.name === 'slot')?.arg?.content
          for (const c of kids) {
            const sa = slotOf(c)
            if (sa !== undefined && sa !== 'default') warnSkippedSubtree(c, 'Suspense #fallback 永不显示（我方无 pending 态）')
          }
          const flattened: unknown[] = []
          for (const c of kids) {
            const sa = slotOf(c)
            if (!(sa === undefined || sa === 'default')) continue
            if (c.tag === 'template') flattened.push(...(c.children ?? []))
            else flattened.push(c)
          }
          walk(flattened, parentComponent)
        } else {
          walk((n.children ?? []) as unknown[], parentComponent)
        }
        continue
      }
      // ③ 占 id 的元素：收集事件 + 走子树
      const id = nextId++
      const isComp = /^[A-Z]/.test(tag)
      collectEvents(n, id, isComp)
      walk((n.children ?? []) as unknown[], isComp)
    }
  }
  let nextId = 0
  walk(ast.children ?? [], false)
  // ★★★B5（2026-10-10）：脚本级生命周期钩子（`onMounted`/`onUnmounted`）**回调体降级为动作表**。
  //   ★放在 `walk` **之后**（handler 编号续在事件 handler 之后）⇒ 既有事件 handler 命名 h0/h1… **不变**。
  //   可降级 ⇒ 进 `scriptLifecycle`（端上在 mounted/unmounted 时机执行）；不可降级 ⇒ **精确诊断**（不静默）。
  for (const hook of scriptHooks) {
    let errored = false
    const hookDiag = (m: string, h?: string): void => { errored = true; diag(`on${hook.phase === 'mounted' ? 'Mounted' : 'Unmounted'}：${m}`, h) }
    const acts = degradeStatements(hook.body, hookDiag, ctx, 0)
    if (errored) continue // 体降级失败 ⇒ 不产出（诊断已给）
    if (acts.length === 0) {
      // 空体（`onMounted(() => {})`）——合法但无事可做；不产诊断、不产产物
      continue
    }
    const handler = `h${handlerSeq.length}`
    handlerSeq.push(handler)
    out.handlers[handler] = acts
    if (!out.scriptLifecycle) out.scriptLifecycle = []
    out.scriptLifecycle.push({ phase: hook.phase, handler })
  }
  return out
}

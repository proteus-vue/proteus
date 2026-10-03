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
//   不支持：多语句块（`{ a++; b++ }`）、调用表达式（`foo()`）——一律**产诊断**（带修法）。
//   ★事件修饰符（2026-10-03 P2-3 起）：`.stop` / `.self` / `.once` **支持**（语义在运行时
//     `slot-runtime/dispatch.ts` 的共享派发器）；`.prevent` / `.passive` / `.capture` /
//     按键修饰符**产诊断但仍执行 handler**（没有对应语义，忽略是忠实的——见 splitModifiers）。
import type { ExprProgram } from '@proteus-vue/slot-runtime'
import { compileExpr } from './expr'
import { parse as sfcParse } from '@vue/compiler-sfc'
import { parse as domParse } from '@vue/compiler-dom'
import type { VueCompatDeps } from './sources'

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
}

/**
 * ★★★**一个动作**（2026-10-03 · emits 批次增补 `emit`）——handler 跑起来时改什么。
 */
export type HandlerAction =
  /** `source = program`（program 为纯表达式程序） */
  | { op: 'set'; source: string; program: ExprProgram }
  /** `source += program`（自增/自减/复合赋值统一归到这里；program 求值为数值） */
  | { op: 'add'; source: string; program: ExprProgram }
  /**
   * ★★★**`$emit('name', payload?)`**（P1-3 emits）——子组件向父级发一条组件事件。
   *
   * 【语义（与 Vue 对齐的收窄形态）】payload 表达式在**子组件作用域**求值（props/data/父级 read），
   *   结果作为父级 handler 里的 `$event`；父级绑定（`@name="..."`）按**边界节点 + 事件名**查表，
   *   命中就跑其动作表。**不冒泡**（组件事件是直接通知——Vue 语义）。
   * 【诚实边界】本版只支持模板里的 `$emit(...)`（script 里的 `defineEmits` 返回值不执行——
   *   移动端不跑 script，见 entry-vapor 的分工）；payload 最多一个实参（Vue 的多实参形态为
   *   后续批次，编译期诊断）。
   */
  | { op: 'emit'; event: string; program?: ExprProgram }

/** handler 名 → 动作列表（按序执行 ⇒ "先算后写"的顺序语义保留） */
export interface EventHandlers {
  [handler: string]: HandlerAction[]
}

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
  /** 不支持形态的诊断（带修法）——不静默 */
  diagnostics: Array<{ message: string; hint?: string }>
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

const isIdent = (s: string): boolean => /^[A-Za-z_$][\w$]*$/.test(s)

/**
 * 编译 `@event="statement"` 的语句部分 → 动作列表。
 *
 * 【实现取向】只认**单条赋值/自增语句**（模板里 `@click` 的绝大多数写法）；
 *   其余形态产诊断。★不引入通用 JS 解释器（那是另一套语言工程，且违背"封闭集"的既有决策）。
 */
function compileStatement(code: string, diag: (m: string, h?: string) => void): HandlerAction[] {
  const src = code.trim()
  if (!src) {
    diag('handler 为空', '例：@click="count++"')
    return []
  }
  // 多语句（含分号 / 花括号块）⇒ 不支持（明确说清）
  if (src.includes(';') || src.includes('{')) {
    diag(
      `handler 含多条语句或代码块（本版只支持单条赋值/自增）：\`${src.slice(0, 40)}\``,
      '请拆成多个独立 handler（如 @click="a++" 与另一个事件），或用计算属性收敛为一条赋值',
    )
    return []
  }

  // ① 自增 / 自减：`x++` `x--` `++x` `--x`
  const upd = /^(?:([A-Za-z_$][\w$]*)(\+\+|--))|(?:(?:\+\+|--)([A-Za-z_$][\w$]*))$/.exec(src)
  if (upd) {
    const name = upd[1] ?? upd[3]!
    const delta = (upd[2] ?? src.slice(0, 2)) === '++' ? 1 : -1
    return [{ op: 'add', source: name, program: { k: 'lit', v: delta } }]
  }

  // ② 复合赋值：`x += expr` / `x -= expr`
  const comp = /^([A-Za-z_$][\w$]*)\s*([+-])=\s*(.+)$/.exec(src)
  if (comp) {
    const name = comp[1]!
    const sign = comp[2] === '-' ? -1 : 1
    const e = compileExpr(comp[3]!.trim())
    if (!e.ok) {
      diag(`handler 右侧表达式不支持：${e.unsupported}`, '本版支持纯求值表达式（成员访问/算术/比较/逻辑/三元）')
      return []
    }
    const program: ExprProgram = sign === 1 ? e.program : { k: 'bin', op: '*', l: { k: 'lit', v: -1 }, r: e.program }
    return [{ op: 'add', source: name, program }]
  }

  // ②.5 ★★★**`$emit('name', payload?)`**（P1-3 emits，2026-10-03）——子组件 → 父级组件事件。
  //   形态：`$emit('bump')` / `$emit('bump', expr)`（单引号/双引号都认）。
  //   ★为什么在赋值分支**之前**：`$emit(...)` 含逗号/括号，后面几个赋值正则不会误吃它，
  //     但顺序上先判更清晰（也防未来正则放宽时被误匹配）。
  {
    const em = /^\$emit\(\s*(['"])([\w:-]+)\1\s*(?:,\s*([\s\S]+?))?\s*\)$/.exec(src)
    if (em) {
      const event = em[2]!
      const payloadSrc = (em[3] ?? '').trim()
      if (!payloadSrc) return [{ op: 'emit', event }]
      if (payloadSrc.includes(',')) {
        diag(`$emit 的载荷只支持一个实参：\`${src.slice(0, 48)}\``, '把多个值合成一个对象/数组再传（如 $emit(\'x\', {a, b}) 为后续批次，可用单个表达式先算）')
        return []
      }
      const e = compileExpr(payloadSrc)
      if (!e.ok) {
        diag(`$emit 载荷表达式不支持：${e.unsupported}`, '载荷须为纯求值表达式（成员访问/算术/比较/逻辑/三元）')
        return []
      }
      return [{ op: 'emit', event, program: e.program }]
    }
    // 变体误用诊断：`emit(...)`（script 局部名）/ 动态事件名
    const wrong = /^(?:emit|\$emits?)\s*\(/.exec(src)
    if (wrong) {
      diag(
        `handler 里的 \`${src.slice(0, 32)}…\` 不是受支持的 $emit 形态`,
        '模板里请写 `$emit(\'事件名\')` 或 `$emit(\'事件名\', 表达式)`（静态名 + 最多一个实参）',
      )
      return []
    }
  }

  // ③ 赋值：`x = expr`
  const asg = /^([A-Za-z_$][\w$]*)\s*=\s*(.+)$/.exec(src)
  if (asg) {
    const name = asg[1]!
    if (!isIdent(name)) {
      diag(`handler 左侧不是简单标识符：\`${name}\``, '只支持改一个顶层源（如 `count = …`）')
      return []
    }
    const e = compileExpr(asg[2]!.trim())
    if (!e.ok) {
      diag(`handler 右侧表达式不支持：${e.unsupported}`, '本版支持纯求值表达式（成员访问/算术/比较/逻辑/三元）')
      return []
    }
    return [{ op: 'set', source: name, program: e.program }]
  }

  diag(
    `handler 形态不支持：\`${src.slice(0, 40)}\``,
    '本版支持：`x++` / `x--` / `x += n` / `x = <纯表达式>`；调用（如 `submit()`）与多语句待后续批次',
  )
  return []
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
  try {
    body = vueParse(source, { filename: 'anonymous.vue' }).descriptor.template?.content ?? ''
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

  type EvNode = {
    type: number
    tag?: string
    props?: Array<{
      type: number
      name: string
      arg?: { content?: string; isStatic?: boolean }
      exp?: { content?: string }
      modifiers?: Array<{ content?: string } | string>
    }>
    children?: unknown[]
  }

  const handlerSeq: string[] = []
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
          const actions = compileStatement(String(p.exp?.content ?? '').trim(), diag)
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
      // ★★修饰符解析（P2-3）：先拆修饰符再判事件名（否则 `click.stop` 整串当过事件名）
      const { event: evName, stop, self, once, notes: modNotes } = splitModifiers(rawName)
      const name = evName.toLowerCase()
      const semantic = EVENT_ALIAS[name]
      if (!semantic) {
        // ★★★**组件自定义事件**（P1-3 emits，2026-10-03）：组件边界上的非手势事件名
        //   = 监听子组件的 `$emit`（Vue 语义）⇒ 产 **componentEmit 绑定**（不冒泡、不 hitTest）。
        //   ★非组件元素上的自定义事件名仍走"事件未支持"诊断（原生元素没有自定义事件源）。
        if (isComponentTag) {
          const actions = compileStatement(value, diag)
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
      const actions = compileStatement(value, diag)
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
        ...(stop ? { stop: true } : {}),
        ...(self ? { self: true } : {}),
        ...(once ? { once: true } : {}),
      })
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
    for (const raw of children) {
      const n = raw as EvNode
      if (n.type !== 1) continue
      const tag = n.tag ?? ''
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
  return out
}

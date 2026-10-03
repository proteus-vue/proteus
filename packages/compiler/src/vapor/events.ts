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
}

/** 一个动作：改某个源 */
export type HandlerAction =
  /** `source = program`（program 为纯表达式程序） */
  | { op: 'set'; source: string; program: ExprProgram }
  /** `source += program`（自增/自减/复合赋值统一归到这里；program 求值为数值） */
  | { op: 'add'; source: string; program: ExprProgram }

/** handler 名 → 动作列表（按序执行 ⇒ "先算后写"的顺序语义保留） */
export interface EventHandlers {
  [handler: string]: HandlerAction[]
}

export interface EventCompileResult {
  events: EventBinding[]
  handlers: EventHandlers
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
export function compileEvents(source: string): EventCompileResult {
  const out: EventCompileResult = { events: [], handlers: {}, diagnostics: [] }
  const diag = (message: string, hint?: string): void => {
    out.diagnostics.push({ message, hint })
  }

  const tpl = /<template[^>]*>([\s\S]*?)<\/template>/.exec(source)
  if (!tpl) {
    diag('未找到 <template> 块（事件编译跳过）', '请检查 SFC 形态')
    return out
  }
  const body = tpl[1]!

  // ★元素序 id：与 template.ts 同一条纪律（DFS 先序，含自闭合与嵌套）
  let nextId = 0
  /** 显式栈的 DFS：同时收 event 属性（自闭合与普通标签都要覆盖） */
  const tagRe = /<([A-Za-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let m: RegExpExecArray | null
  const handlerSeq: string[] = []
  while ((m = tagRe.exec(body)) !== null) {
    const attrs = m[2] ?? ''
    const id = nextId++
    // ★★动态事件名（`@[ev]`）的**前置探测**（2026-10-03 · P0 静默风险批次）：
    //   本函数的正则 `/@([\w:.-]+)/` **匹配不到 `@[ev]`**（`[` 不在字符类里）⇒ 它既不进产物
    //   也**不进诊断**（静默丢失，比"诊断拒绝"更危险）。⇒ 先扫一遍方括号形态并报诊断。
    //   ★这是"正则解析的盲区"——修法是**显式覆盖已知的高危形态**（而非换解析器，成本过高）。
    {
      const dynRe = /@\s*\[/g
      if (dynRe.test(attrs)) {
        diag('动态事件名未支持：@[expr]（本版只处理静态事件名；正则解析器看不到方括号形态）', '请改用静态事件名（如 @click / @tap）')
      }
    }
    // 收集本元素上的事件属性
    const attrRe = /@([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g
    let am: RegExpExecArray | null
    while ((am = attrRe.exec(attrs)) !== null) {
      const rawName = am[1]!
      const value = (am[3] ?? am[4] ?? '').trim()
      // ★★修饰符解析（P2-3）：先拆修饰符再判事件名（否则 `click.stop` 整串当过事件名）
      const { event: evName, stop, self, once, notes: modNotes } = splitModifiers(rawName)
      // 动态事件名（@[x]）不支持
      if (evName.startsWith('[')) {
        diag(`动态事件名未支持：@${evName}`, '请写静态事件名')
        continue
      }
      const name = evName.toLowerCase()
      const semantic = EVENT_ALIAS[name]
      if (!semantic) {
        // 事件本身不支持 ⇒ 只报事件（修饰符诊断在此时无意义，避免噪音误导修法）
        diag(`事件未支持：@${rawName}`, '本版支持 click / tap / longpress（分别映射宿主的 tap/longpress）')
        continue
      }
      // 修饰符诊断（`.prevent` 等无对应语义 / 按键修饰符 / 未知）——**不阻碍绑定**
      for (const n of modNotes) diag(`@${rawName}：${n}`, '语义修饰符见 packages/slot-runtime/src/dispatch.ts（.stop/.self/.once）')
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
  return out
}

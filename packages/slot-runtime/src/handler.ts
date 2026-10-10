// packages/slot-runtime/src/handler.ts —— ★★★**事件动作表**（契约 + 执行器，App 三端共享）
//
// 【为什么契约定义在这里（消费端）】动作表由编译器 `compileEvents` **发射**、由运行期
//   （`@proteus-vue/render-backend` 的 screen-runtime · 夹具 `entry-vapor`）**执行**。
//   契约放**消费端**是本仓一贯处置（`EventBinding`/`SubscriptionTable` 同）——依赖方向单向：
//   compiler → slot-runtime；两处执行器 **import 同一份**，不许各写一套（否则必然漂移）。
//
// 【T1·T2 覆盖的动作（封闭集；不支持一律**编译期诊断**，不静默）】
//   · `set` / `add`        —— `x = expr` / `x++` / `x += n`（T1）
//   · `emit` / `nav`       —— `$emit(...)` / `$nav('屏')`（T1）
//   · `let`（T2）          —— 方法内**局部变量**：`const y = <纯表达式>`
//   · `if`（T2）           —— `if (cond) {…} else {…}`（两臂降级为动作子列表）
//   运行期只**执行**（无 eval、无字符串解析）——守"编译期产出纯数据、跨端禁 eval"纪律。
//
// 【局部作用域 + $event】执行器持一个局部 `Map`：`let` 写入、后续动作的 `read` 先查它；
//   `$event`（手势/组件事件的载荷）由 `run` 的 `event` 注入（`read('$event')`）。
import { evalExpr } from './expr'
import type { ExprProgram } from './expr'

/**
 * ★★★**一个动作**（handler 跑起来时改什么）——编译器发射、运行期执行。
 *   ○ `set`/`add`/`emit`/`nav` 为 **T1**；`let`/`if` 为 **T2**。
 */
export type HandlerAction =
  /** `source = program`（program 为纯表达式程序） */
  | { op: 'set'; source: string; program: ExprProgram }
  /** `source += program`（自增/自减/复合赋值统一归到这里；program 求值为数值） */
  | { op: 'add'; source: string; program: ExprProgram }
  /** `$emit('name', payload?)`——子组件向父级发一条组件事件（payload 在子作用域求值） */
  | { op: 'emit'; event: string; program?: ExprProgram }
  /** `$nav('目标屏')`——导航一等动作（由运行期/宿主执行） */
  | { op: 'nav'; target: string }
  /**
   * ★★**局部变量绑定**（T2）：`const y = <纯表达式>` / 方法形参绑定 `let p = <实参>`。
   *   写入本 handler 的**局部作用域**（后续动作的 `read` 先查它，再退到数据源）。
   */
  | { op: 'let'; name: string; program: ExprProgram }
  /**
   * ★★**条件动作**（T2）：`if (cond) {then} else {else}`——两臂是**动作子列表**（编译期降级）。
   *   `cond` 求值为 truthy 走 `then`，否则走 `else`（可缺省 ⇒ 空跑）。
   */
  | { op: 'if'; cond: ExprProgram; then: HandlerAction[]; else?: HandlerAction[] }
  /**
   * ★★★**`console.<level>(a, b, …)`**（T3，2026-10-10）——事件处理器里的控制台日志。
   *
   * 【为什么需要】真实页面的 `@click="onTap"` 方法体几乎都会 `console.log(...)` 调试；
   *   而 App 端**不执行 script**（端上只跑动作表）⇒ 此前整个调用被判"形态不支持"、**点了没反应**。
   *   ⇒ 编译期把它降级为**纯数据动作** `log`：`programs` 是各实参的**求值程序**（运行期求值、
   *     交 `onLog` 出口）——仍是"编译期产出纯数据、跨端禁 eval"同一套。
   * 【封闭集】只认 `console.{log,info,warn,error,debug}`；其余（`console.table` / `time` / 等）产诊断。
   * 【去处】由运行期/宿主决定：App 壳 → dev 面板 Console；无面板（release）→ 静默丢弃（如实）。
   */
  | { op: 'log'; level: 'log' | 'info' | 'warn' | 'error' | 'debug'; programs: ExprProgram[] }

/** handler 名 → 动作列表（按序执行 ⇒ "先算后写"的顺序语义保留） */
export interface EventHandlers {
  [handler: string]: HandlerAction[]
}

/** 执行一次 handler 所需的**注入**（数据读写 + $event 载荷） */
export interface HandlerRunContext {
  /** 读一个标识符（数据源 / 组件作用域变量；`$event` 由执行器单独注入，不必在此处理） */
  read(name: string): unknown
  /** 写一个数据源（`set` / `add` 落点） */
  write(name: string, value: unknown): void
  /** `$event` 载荷（手势节点载荷 / 组件 emit 的 payload）——缺省 undefined */
  event?: unknown
}

/** 执行器的**外送钩子**（T1 已有动作：emit/nav 的去处由调用方决定——路由 or 忽略） */
export interface HandlerRunHooks {
  /** 遇 `emit` 动作：调用方决定去处（父子路由 / 如实忽略） */
  onEmit?(event: string, payload: unknown): void
  /** 遇 `nav` 动作：调用方执行导航 */
  onNav?(target: string): void
  /** ★T3 遇 `log` 动作（`console.*`）：调用方决定去处（dev 面板 Console / 静默丢弃） */
  onLog?(level: 'log' | 'info' | 'warn' | 'error' | 'debug', values: unknown[]): void
}

/** 数值化（`add` 的累加语义：非数按 0 起——与 JS `+` 刻意收窄，见 compileEvents 形态说明） */
function numeric(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * ★★★**执行一个动作列表**（App 三端**唯一**实现——`screen-runtime` 与 `entry-vapor` 共用）。
 *
 * 【语义】严格**按序**执行（"先算后写"）；`let`/`if` 通过**局部作用域 + 递归**承接：
 *   · `set`：`write(source, eval(program))`
 *   · `add`：`write(source, numeric(read(source)) + numeric(eval(program)))`
 *   · `let`：置局部变量（后续 read 优先命中）
 *   · `if`：求 `cond` → 递归跑 `then`/`else`
 *   · `emit`/`nav`：交调用方（hooks）
 *   `read` 优先级：局部变量 → `$event` → 注入的 `read`。
 */
export function runHandlerActions(
  actions: readonly HandlerAction[],
  ctx: HandlerRunContext,
  hooks: HandlerRunHooks = {},
): void {
  /** 最外层读取：`$event` → 注入的 `read` */
  const baseRead = (name: string): unknown => (name === '$event' ? ctx.event : ctx.read(name))

  /**
   * 执行一个动作列表——**每个列表一个块级作用域**（`let` 写入本层，读写沿作用域链上溯）。
   *   · 顶层列表 = 方法级作用域（形参绑定 / 方法体 `const` 都在此层 ⇒ 全方法可见）；
   *   · `if` 两臂的列表 = **子作用域**（臂内 `let` 不外泄——与 JS 块级一致）。
   */
  const exec = (acts: readonly HandlerAction[], parentRead: (name: string) => unknown): void => {
    const locals = new Map<string, unknown>()
    const read = (name: string): unknown => (locals.has(name) ? locals.get(name) : parentRead(name))
    const evalp = (p: ExprProgram): unknown => evalExpr(p, { read })
    for (const a of acts) {
      switch (a.op) {
        case 'set':
          ctx.write(a.source, evalp(a.program))
          break
        case 'add':
          ctx.write(a.source, numeric(ctx.read(a.source)) + numeric(evalp(a.program)))
          break
        case 'let':
          locals.set(a.name, evalp(a.program))
          break
        case 'if':
          if (truthy(evalp(a.cond))) exec(a.then, read)
          else if (a.else) exec(a.else, read)
          break
        case 'emit':
          hooks.onEmit?.(a.event, a.program ? evalp(a.program) : undefined)
          break
        case 'nav':
          hooks.onNav?.(a.target)
          break
        case 'log':
          hooks.onLog?.(a.level, a.programs.map((p) => evalp(p)))
          break
      }
    }
  }
  exec(actions, baseRead)
}

/** JS truthiness（与 `if (x)` 同义）——数组/对象/非空串/非零数/真 为真 */
function truthy(v: unknown): boolean {
  return Boolean(v)
}

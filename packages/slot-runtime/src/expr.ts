// packages/slot-runtime/src/expr.ts
// Vapor for Proteus IR —— **表达式程序**（方案 §4.3 Step 4「求值函数生成」的可序列化形态）
//
// 【要解决的问题（本仓实测的功能缺口）】模板里 `{{ n + 1 }}`、`{{ group.title + item.name }}`
//   这类**含运算**的表达式此前被编译器标为 `expr` 形态（原始文本）；而参考实现只支持纯路径
//   ⇒ **该槽位永不更新**（首版还是静默跳过，后改为上报）。实际模板里这类表达式极常见。
//
// 【为什么是「可序列化小程序」而不是 JS 源码字符串（方案 §4.4 硬性要求）】
//   §4.4 明确「编译期产出的不是 JS 源码字符串，而是可序列化的订阅表」——
//   源码字符串要 `eval` / `new Function`，而跨端受限（**小程序端禁 eval**）。
//   ⇒ 编译器把表达式编成**结构化程序**（纯 JSON），各端用自己的解释器执行。
//
// 【为什么不在此层支持**任意**函数调用】
//   调用需要纯度判断（方案 §5.3 的 C1 准入条件）——任意调用仍编不出程序 ⇒ 保持 `expr` 形态
//   ⇒ 由调用方**上报**（不静默）。
//   ★★2026-10-03（P2-8）：**白名单内的纯函数**现在支持（`call` 节点）——
//     表就是 `PURE_CALLS`（Math.* / String() / Number() / parseInt…；**不含** `Math.random`、
//     时间、IO 等不纯者）。"白名单 = 静态可证的纯度"⇒ 这类调用可进 L1。
//
// 【诚实边界：刻意不支持的构造】
//   · `==` / `!=`（宽松相等）：JS 语义微妙（null==undefined、字符串转数字…），
//     实现错了会**静默算错值**。⇒ 宁可判为不支持（上报），也不冒险实现。
//     （模板本应用 `===`；确需宽松相等请自行用函数封装 + `@proteus-pure`。）
//   · **白名单外**的函数/方法调用、`new`、赋值、逗号表达式、`typeof`/`instanceof`/`in`/`delete`
//   · 计算属性键的对象字面量（`{[k]: v}`——键名不确定，无法静态化）
//   · **可选链 `?.`（2026-10-03 起编译期降级为等价的 `cond` 程序——见 compiler 侧注释）**
export type BinOp = '+' | '-' | '*' | '/' | '%' | '===' | '!==' | '<' | '>' | '<=' | '>='
export type UnOp = '!' | '-' | '+'
export type LogicOp = '&&' | '||' | '??'

/**
 * ★★**纯函数白名单**（P2-8，2026-10-03）——模板表达式里**允许调用**的全部函数（唯一事实源）。
 *
 * 【为什么是白名单而不是"纯度分析"】静态证明一个任意函数是纯的不可判定（或需极大代价）
 *   ⇒ 本仓取向（与方案 §5.3 C1 一致）：**枚举可证的**，其余一律拒绝 + 诊断（不猜）。
 * 【为什么表在消费端（本包）】与 `ExprProgram` 同一处置——"能被执行的形状"由执行方定义；
 *   编译器 import 本表做校验（生产端 import 消费端，方向不反转）。
 * 【收录标准】无副作用、无时间/随机/IO、结果只由入参决定、在六端语义一致（内建全局）。
 *   ★刻意**排除**：`Math.random`（不纯）、`Date`（时间）、`JSON.parse`（可产出任意对象，
 *   且失败语义跨端有差异）、一切宿主/业务函数（需 `@proteus-pure` 人工担保走另一条通道）。
 */
export const PURE_CALLS: Record<string, (...args: never[]) => unknown> = {
  // —— Math（纯计算）——
  'Math.abs': Math.abs as never,
  'Math.ceil': Math.ceil as never,
  'Math.floor': Math.floor as never,
  'Math.round': Math.round as never,
  'Math.trunc': Math.trunc as never,
  'Math.sign': Math.sign as never,
  'Math.sqrt': Math.sqrt as never,
  'Math.cbrt': Math.cbrt as never,
  'Math.pow': Math.pow as never,
  'Math.exp': Math.exp as never,
  'Math.log': Math.log as never,
  'Math.log2': Math.log2 as never,
  'Math.log10': Math.log10 as never,
  'Math.min': Math.min as never,
  'Math.max': Math.max as never,
  // —— 类型转换（call 形态，非 new）——
  'String': String as never,
  'Number': Number as never,
  'Boolean': Boolean as never,
  // —— 解析 / 判定（全局）——
  'parseInt': parseInt as never,
  'parseFloat': parseFloat as never,
  'isNaN': isNaN as never,
  'isFinite': isFinite as never,
  'Number.isFinite': Number.isFinite as never,
  'Number.isInteger': Number.isInteger as never,
  'Number.isNaN': Number.isNaN as never,
  // —— 数组判定 ——
  'Array.isArray': Array.isArray as never,
}

/** 该名字是否在白名单内（编译器与各端执行器**共用同一判据**；避免两处清单漂移） */
export function isPureCallName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PURE_CALLS, name)
}

/**
 * ★★**白名单纯方法**（P2-8 续，2026-10-03）——原型上的**非变异、无副作用**方法。
 *
 * 【为什么必须有（本仓实测的回归驱动）】真实项目（showcase 的三个生命周期页）在模板里写
 *   `{{ phases.join(" → ") || "（暂无）" }}`——方法调用此前整类被拒（编不出）⇒ 而这些绑定
 *   原本被判成"静态可证纯"（`hasCall` 漏记成员链调用）⇒ **L1 但永不更新**（静默）。
 *   补上调用记录后它们会掉 L0 ⇒ 正解不是"退回去装作没看见"，而是**把这些可证纯的方法纳入白名单**。
 * 【收录标准】只由接收者与实参决定、**不改动接收者**（非变异）、无时间/随机/IO。
 *   ★刻意**排除**：`sort`/`reverse`/`splice`/`push`/`pop`/`shift`/`unshift`（**变异**）、
 *     `replace`/`split` 的正则形态（跨端正则实现有差异；且编译期无法证明实参不是正则）、
 *     一切异步/迭代器方法。
 * 【运行时守卫】接收者不是对象或方法不可调用 ⇒ 返回 `undefined`（与属性访问同一容错口径；
 *   官方在此时**抛错**——我方选"渲染为空不炸页面"，已在 evalExpr 头注声明）。
 */
export const PURE_METHODS: Record<string, (recv: unknown, ...args: never[]) => unknown> = {
  // —— Array（非变异）——
  join: (recv, sep) => (Array.isArray(recv) ? recv.join(sep === undefined ? ',' : String(sep)) : undefined),
  slice: (recv, a, b) => (typeof recv === 'string' || Array.isArray(recv) ? (recv as string & unknown[]).slice(a as number, b as number) : undefined),
  concat: (recv, ...rest) => (Array.isArray(recv) ? recv.concat(...(rest as unknown[][])) : undefined),
  indexOf: (recv, x) => (typeof recv === 'string' || Array.isArray(recv) ? (recv as string & unknown[]).indexOf(x as never) : undefined),
  includes: (recv, x) => (typeof recv === 'string' || Array.isArray(recv) ? (recv as string & unknown[]).includes(x as never) : undefined),
  // —— String（非变异）——
  toUpperCase: (recv) => (typeof recv === 'string' ? recv.toUpperCase() : undefined),
  toLowerCase: (recv) => (typeof recv === 'string' ? recv.toLowerCase() : undefined),
  trim: (recv) => (typeof recv === 'string' ? recv.trim() : undefined),
  trimStart: (recv) => (typeof recv === 'string' ? recv.trimStart() : undefined),
  trimEnd: (recv) => (typeof recv === 'string' ? recv.trimEnd() : undefined),
  charAt: (recv, i) => (typeof recv === 'string' ? recv.charAt(i as number) : undefined),
  padStart: (recv, n, pad) => (typeof recv === 'string' ? recv.padStart(n as number, pad as string) : undefined),
  padEnd: (recv, n, pad) => (typeof recv === 'string' ? recv.padEnd(n as number, pad as string) : undefined),
  repeat: (recv, n) => (typeof recv === 'string' ? recv.repeat(n as number) : undefined),
  substring: (recv, a, b) => (typeof recv === 'string' ? recv.substring(a as number, b as number) : undefined),
  startsWith: (recv, x) => (typeof recv === 'string' ? recv.startsWith(x as string) : undefined),
  endsWith: (recv, x) => (typeof recv === 'string' ? recv.endsWith(x as string) : undefined),
  // —— Number（非变异）——
  toFixed: (recv, n) => (typeof recv === 'number' ? recv.toFixed(n as number) : undefined),
  toString: (recv: unknown) => (recv === undefined || recv === null ? undefined : String(recv)),
}

/** 该方法名是否在白名单内（**只看末段**：`arr.join` / `s.join` 都命中 `join`） */
export function isPureMethodName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PURE_METHODS, name)
}

/**
 * ★调用名（`deps.calls` 里的形态）是否"可证纯"——两种形态统一判据：
 *   · 自由函数 / 命名空间函数（`Math.round` / `parseInt`）⇒ `PURE_CALLS`
 *   · 方法调用（`arr.join` / `s.trim`）⇒ **末段**在 `PURE_METHODS`
 * 供 C1 分层判定与编译器共用（一处实现，避免两处清单漂移）。
 */
export function isPureCallExprName(name: string): boolean {
  if (isPureCallName(name)) return true
  const last = name.split('.').pop() ?? ''
  return isPureMethodName(last)
}

/**
 * ★★**编译期常量成员表**（P2-8）——`Math.PI` 这类"全局对象上的常量"在**编译期**内联为字面量。
 *
 * 【为什么必须内联（本仓实测的静默错值）】`Math.PI` 此前编译成 `mem(root('Math'), 'PI')`
 *   ⇒ 运行时 `ctx.read('Math')` 是 **undefined** ⇒ 整个表达式求值为 `undefined`
 *   ⇒ **静默渲染成空**（而诊断里什么也没有——因为 `Math` 是"已知全局"，没有"未识别源"告警）。
 *   ⇒ 正解：编译期取值内联（编译器跑在 Node 里，`Math.PI` 就是那个常量）；
 *     不在表内的全局成员访问 ⇒ **诊断**（而不是静默 undefined）。
 *   ★注意 `NaN` / `Infinity` 不在此表：它们是 number 但 **JSON 序列化会变 null**
 *     （程序是纯 JSON 契约）⇒ 由编译器对这两个标识符专门诊断（见 compiler 侧）。
 */
export const GLOBAL_CONST_MEMBERS: Record<string, number> = {
  'Math.PI': Math.PI,
  'Math.E': Math.E,
  'Math.LN2': Math.LN2,
  'Math.LN10': Math.LN10,
  'Math.LOG2E': Math.LOG2E,
  'Math.LOG10E': Math.LOG10E,
  'Math.SQRT2': Math.SQRT2,
  'Math.SQRT1_2': Math.SQRT1_2,
  'Number.MAX_SAFE_INTEGER': Number.MAX_SAFE_INTEGER,
  'Number.MIN_SAFE_INTEGER': Number.MIN_SAFE_INTEGER,
  'Number.EPSILON': Number.EPSILON,
  'Number.MAX_VALUE': Number.MAX_VALUE,
  'Number.MIN_VALUE': Number.MIN_VALUE,
}

/**
 * 表达式程序（**纯 JSON**：树形，便于短路求值与体积控制）
 *
 * ★为什么用树而不是线性字节码：短路语义（`a && a.b`、`c ? x : y`）在树上前序求值天然正确；
 *   线性字节码需要跳转指令与栈平衡，复杂度高而收益小（表达式树通常只有几个节点）。
 */
export type ExprProgram =
  | { k: 'root'; name: string } // ctx.read(name)
  | { k: 'lit'; v: number | string | boolean | null } // 字面量
  /**
   * ★`undefined` 字面量（**独立节点，不可用 `lit: null` 代替**）
   *
   * 【为什么单列（本仓实测的真 bug）】首版把 `undefined` 编成 `{k:'lit', v:null}`
   *   ⇒ `a === undefined` 求值成 `a === null` ⇒ **false**（JS 里 undefined !== null）
   *   ⇒ 静默算错值。⇒ 语义必须精确（`===` 会区分二者）。
   */
  | { k: 'undef' }
  | { k: 'mem'; obj: ExprProgram; key: string } // obj.key（静态键）
  | { k: 'memdyn'; obj: ExprProgram; key: ExprProgram } // obj[key]（动态键）
  | { k: 'un'; op: UnOp; arg: ExprProgram } // 一元
  | { k: 'bin'; op: BinOp; l: ExprProgram; r: ExprProgram } // 二元（无短路）
  | { k: 'logi'; op: LogicOp; l: ExprProgram; r: ExprProgram } // 短路逻辑
  | { k: 'cond'; t: ExprProgram; c: ExprProgram; a: ExprProgram } // t ? c : a
  | { k: 'obj'; props: Array<{ key: string; value: ExprProgram }> } // 对象字面量
  | { k: 'arr'; items: ExprProgram[] } // 数组字面量
  /**
   * ★★**白名单纯函数调用**（P2-8，2026-10-03）——`fn` 必须是 `PURE_CALLS` 的键
   *   （编译期已校验；运行时再查一次表，缺失 ⇒ 抛错而不是静默 undefined）。
   */
  | { k: 'call'; fn: string; args: ExprProgram[] }
  /**
   * ★★**白名单纯方法调用**（P2-8 续）——`recv.method(args)`；`method` 必须在 `PURE_METHODS` 内。
   *   与 `call` 分开是因为**接收者要参与求值**（且依赖分析要按 `recv` 建图）。
   */
  | { k: 'mcall'; recv: ExprProgram; method: string; args: ExprProgram[] }

/** 求值上下文（对应 `LoadResult` 里的 `EvalContext`；此处只依赖最小面） */
export interface ExprContext {
  read(name: string): unknown
}

/** 把值转成数值（对齐 JS 的 `Number()`；无法转则 NaN） */
function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') return v.trim() === '' ? 0 : Number(v)
  if (v === null) return 0
  if (v === undefined) return NaN
  return NaN
}

/**
 * 执行表达式程序（**参考实现**；各端可等价替换为更快的内联实现）
 *
 * 【容错取向】属性访问遇到 `null`/`undefined` **返回 undefined**（不抛）——
 *   与既有 `member` 形态的行为一致（模板里 `a.b.c` 在 a 未就绪时不应炸渲染）。
 */
export function evalExpr(p: ExprProgram, ctx: ExprContext): unknown {
  switch (p.k) {
    case 'root':
      return ctx.read(p.name)
    case 'lit':
      return p.v
    case 'undef':
      return undefined
    case 'mem': {
      const o = evalExpr(p.obj, ctx)
      if (o == null) return undefined
      return (o as Record<string, unknown>)[p.key]
    }
    case 'memdyn': {
      const o = evalExpr(p.obj, ctx)
      if (o == null) return undefined
      const k = evalExpr(p.key, ctx)
      return (o as Record<string, unknown>)[String(k)]
    }
    case 'un': {
      const v = evalExpr(p.arg, ctx)
      // ★先捕获到局部变量再 switch：否则穷尽所有分支后 TS 会把 `p` 收窄成 never，
      //   连 `p.op` 都不再可访问（本仓实测的 TS 边界）
      const uop = p.op
      switch (uop) {
        case '!':
          return !v
        case '-':
          return -toNum(v)
        case '+':
          return +toNum(v)
        default:
          throw new Error(`未知一元运算符：${String(uop)}`)
      }
    }
    case 'bin': {
      const l = evalExpr(p.l, ctx)
      const r = evalExpr(p.r, ctx)
      const bop = p.op // 同上：先捕获再 switch
      switch (bop) {
        case '+':
          // ★JS 语义：任一侧为字符串 ⇒ 拼接（模板里最常见的形态是拼接）
          if (typeof l === 'string' || typeof r === 'string') return String(l) + String(r)
          return toNum(l) + toNum(r)
        case '-':
          return toNum(l) - toNum(r)
        case '*':
          return toNum(l) * toNum(r)
        case '/':
          return toNum(l) / toNum(r)
        case '%':
          return toNum(l) % toNum(r)
        case '===':
          return l === r
        case '!==':
          return l !== r
        case '<':
          return (l as never) < (r as never)
        case '>':
          return (l as never) > (r as never)
        case '<=':
          return (l as never) <= (r as never)
        case '>=':
          return (l as never) >= (r as never)
        default:
          throw new Error(`未知二元运算符：${String(bop)}`)
      }
    }
    case 'logi': {
      const l = evalExpr(p.l, ctx)
      if (p.op === '&&') return l ? evalExpr(p.r, ctx) : l
      if (p.op === '||') return l ? l : evalExpr(p.r, ctx)
      // `??`：仅 null/undefined 才取右侧
      return l === null || l === undefined ? evalExpr(p.r, ctx) : l
    }
    case 'cond':
      return evalExpr(p.t, ctx) ? evalExpr(p.c, ctx) : evalExpr(p.a, ctx)
    case 'obj': {
      const o: Record<string, unknown> = {}
      for (const pr of p.props) o[pr.key] = evalExpr(pr.value, ctx)
      return o
    }
    case 'arr':
      return p.items.map((x) => evalExpr(x, ctx))
    case 'mcall': {
      const recv = evalExpr(p.recv, ctx)
      if (recv === undefined || recv === null) return undefined  // 空接收者 ⇒ 空（与属性访问同口径）
      const impl = PURE_METHODS[p.method]
      if (!impl) {
        throw new Error(`表达式程序引用了非白名单方法：${p.method}（见 slot-runtime/expr.ts 的 PURE_METHODS）`)
      }
      const args = p.args.map((a) => evalExpr(a, ctx))
      return impl(recv, ...(args as never[]))
    }
    case 'call': {
      // ★P2-8：白名单纯函数调用——表外名字**抛错**（编译期已校验；此处是防产物异常的兜底，
      //   与"静默 undefined"区分：静默会让模板渲染成空且无从归因）
      const fn = PURE_CALLS[p.fn]
      if (typeof fn !== 'function') {
        throw new Error(`表达式程序引用了非白名单函数：${p.fn}（见 slot-runtime/expr.ts 的 PURE_CALLS）`)
      }
      const args = p.args.map((a) => evalExpr(a, ctx))
      return (fn as (...a: unknown[]) => unknown)(...args)
    }
    default: {
      const never: never = p
      throw new Error(`未知表达式节点：${JSON.stringify(never)}`)
    }
  }
}

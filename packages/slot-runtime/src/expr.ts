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
// 【为什么不在此层支持函数调用】
//   调用需要纯度判断（方案 §5.3 的 C1 准入条件）——那属编译期分层判定，不属本解释器。
//   带调用的表达式**编不出程序** ⇒ 保持 `expr` 形态 ⇒ 由调用方**上报**（不静默）。
//
// 【诚实边界：刻意不支持的构造】
//   · `==` / `!=`（宽松相等）：JS 语义微妙（null==undefined、字符串转数字…），
//     实现错了会**静默算错值**。⇒ 宁可判为不支持（上报），也不冒险实现。
//     （模板本应用 `===`；确需宽松相等请自行用函数封装 + `@proteus-pure`。）
//   · 函数/方法调用、`new`、赋值、逗号表达式、`typeof`/`instanceof`/`in`/`delete`
//   · 计算属性键的对象字面量（`{[k]: v}`——键名不确定，无法静态化）
//   · 可选链 `?.`、空值合并以外的高级语法（`?.` 可用 `??` 与三元改写）
export type BinOp = '+' | '-' | '*' | '/' | '%' | '===' | '!==' | '<' | '>' | '<=' | '>='
export type UnOp = '!' | '-' | '+'
export type LogicOp = '&&' | '||' | '??'

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
    default: {
      const never: never = p
      throw new Error(`未知表达式节点：${JSON.stringify(never)}`)
    }
  }
}

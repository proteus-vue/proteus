// packages/compiler/src/vapor/expr.ts
// Vapor for Proteus IR —— **模板表达式 → 表达式程序**的编译器（方案 §4.3 Step 4）
//
// 【职责】把 `{{ n + 1 }}` / `{{ group.title + item.name }}` 这类**含运算**的表达式
//   编成 `ExprProgram`（纯 JSON，见 `@proteus-vue/slot-runtime` 的 `expr.ts`）。
//
// 【★为什么不支持的构造要「明确拒绝」而不是「尽力编译」】
//   编译器一旦对某构造**猜错语义**，运行时会算出**错值**且不报错——属本仓最忌的
//   「静默错」。⇒ 本编译器遇到任何无法**确信**的构造就返回 `{ unsupported }`，
//   由上游把它保留为 `expr` 形态并**上报**（不静默）。
//   宁可「不支持但可发现」，不可「支持但可能错」。
import { parse as babelParse } from '@babel/parser'
import { isPureCallName, isPureMethodName, GLOBAL_CONST_MEMBERS } from '@proteus-vue/slot-runtime'
import type { ExprProgram } from '@proteus-vue/slot-runtime'

/** 编译结果：要么给出程序，要么给出**明确的不支持原因**（供上报） */
export type ExprCompileResult = { ok: true; program: ExprProgram } | { ok: false; unsupported: string }

/** 二元运算符白名单（★刻意排除 `==` / `!=`——见 expr.ts 顶注的诚实边界） */
const BIN_OPS = new Set(['+', '-', '*', '/', '%', '===', '!==', '<', '>', '<=', '>='])

const UNSUPPORTED_CALL =
  '含**白名单外**的函数/方法调用（纯度无法证明，属 L1 准入条件 C1）——' +
  '内置纯函数（Math.* / String / Number / parseInt 等，见 slot-runtime 的 PURE_CALLS）可直接用；' +
  '业务函数请加 @proteus-pure 人工担保，或在 computed 里算好再绑定'

/** babel AST 节点（只声明本文件用到的字段） */
interface Node {
  type: string
  [k: string]: unknown
}

/**
 * ★★**ref `.value` 自动解包集合**（2026-10-10 · Vapor 事件方法体批次）
 *
 * 【为什么需要】`<script setup>` 里方法体访问 ref 走 `count.value++`；而 Vapor 端上的
 *   数据模型里 `count` **本身就是值**（`data.count` 存快照、`read('count')` 直接给值——
 *   见 `render-backend` 的 screen-runtime）。若把 `count.value` 原样编成 `mem(root('count'),'value')`，
 *   运行时 `read('count')` 得到数值再取 `.value` ⇒ **undefined** ⇒ 静默算错值。
 *   ⇒ 编译期把**已知 ref 源**上的 `.value` 成员访问**解包为裸源引用**（与模板里 `{{ count }}`
 *     自动 unwrap 的语义一致）。
 *   ★只有调用方**显式注入** ref 名集合时才解包（缺省 undefined ⇒ 既有行为逐字节不变）；
 *     非 ref 对象上的 `.value` 属性**不受影响**（清单由调用方按源声明如实给出）。
 */
export type RefNames = ReadonlySet<string>

export function compileExpr(code: string, refNames?: RefNames): ExprCompileResult {
  let ast: unknown
  const src = code.trim()
  try {
    // 先按「表达式」解析（对象字面量必须包一层括号，否则会被当块语句）
    ast = babelParse(`(${src})`, { sourceType: 'module', plugins: ['typescript'] })
  } catch {
    return { ok: false, unsupported: '表达式解析失败（语法无法识别）' }
  }
  let expr: Node
  try {
    const prog = (ast as { program: { body: Node[] } }).program
    const stmt = prog.body[0]
    if (!stmt || stmt.type !== 'ExpressionStatement') return { ok: false, unsupported: '非单一表达式' }
    // 剥掉为解析加的外层括号
    let e = stmt.expression as Node
    if (e.type === 'ParenthesizedExpression') e = e.expression as Node
    expr = e
  } catch {
    return { ok: false, unsupported: 'AST 结构不符预期' }
  }
  return compileNode(expr, refNames)
}

/**
 * ★★**从已解析的 AST 节点编译**（2026-10-10 · 事件方法体批次）
 *
 * 【为什么需要】方法体语句来自 `<script setup>` 的 babel AST（已解析一次）——若再拼接文本
 *   让 `compileExpr` 重解析，既要维护偏移又要多解析一遍。直接从节点编译 = **同一套表达式语义**
 *   （单点实现），零重复解析。
 */
export function compileExprNode(node: unknown, refNames?: RefNames): ExprCompileResult {
  return compileNode(node as Node, refNames)
}

/** 已知内置全局（其成员访问**不可**静默编成 `mem`——运行时 read() 取不到，会静默 undefined） */
const KNOWN_GLOBAL_ROOTS = new Set(['Math', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Date', 'RegExp', 'Intl', 'console'])

/** 取静态成员链名字（`Math.PI` → 'Math.PI'；非静态/含调用返回 null） */
function staticGlobalName(n: Node): string | null {
  if (n.type === 'Identifier') return typeof n.name === 'string' ? (n.name as string) : null
  if (n.type !== 'MemberExpression' && n.type !== 'OptionalMemberExpression') return null
  if (n.computed === true) return null
  const obj = staticGlobalName(n.object as Node)
  const prop = n.property as Node
  if (!obj || !prop || prop.type !== 'Identifier' || typeof prop.name !== 'string') return null
  return `${obj}.${prop.name as string}`
}

/** 取被调用者的静态名字（`Math.round` → 'Math.round'；`fn` → 'fn'；方法调用 `a.b()` → 'a.b'） */
function staticCalleeName(callee: Node): string | null {
  return staticGlobalName(callee)
}

function compileNode(n: Node, refNames?: RefNames): ExprCompileResult {
  // ★★★**TS 语法节点透明解包**（2026-10-03）——`x as T` / `x!` / `<T>x` / `x satisfies T`
  //   在**运行时没有语义**（纯编译期类型噪音；Vue 官方编译器同样剥掉它们）。
  //   此前它们落到 default 分支 ⇒ 整条表达式被拒（`('primary' as any)` 这类**真实页面里
  //   极常见**的写法——组件库 demo 里就有）⇒ 该槽位静默不更新。
  //   ★解包要**递归**（`(a as any) + 1` 左操作数也是断言）——故放在 compileNode 入口。
  while (n.type === 'TSAsExpression' || n.type === 'TSNonNullExpression'
      || n.type === 'TSTypeAssertion' || n.type === 'TSSatisfiesExpression') {
    n = n.expression as Node
  }
  switch (n.type) {
    case 'Identifier': {
      const name = n.name as string
      // ★★`undefined` 是关键字级标识符（不是源引用）——但**不能**编成 `null`！
      //
      // 【本仓实测的真 bug】首版编成 `{k:'lit', v:null}` ⇒ `a === undefined` 求值成
      //   `a === null` ⇒ **false**（JS 里 undefined !== null）⇒ 静默算错值。
      //   ⇒ 用独立的 `undef` 节点（`expr.ts` 里已加）保持语义精确。
      if (name === 'undefined') return { ok: true, program: { k: 'undef' } }
      return { ok: true, program: { k: 'root', name } }
    }
    case 'NumericLiteral':
      return { ok: true, program: { k: 'lit', v: n.value as number } }
    case 'StringLiteral':
      return { ok: true, program: { k: 'lit', v: n.value as string } }
    case 'BooleanLiteral':
      return { ok: true, program: { k: 'lit', v: n.value as boolean } }
    case 'NullLiteral':
      return { ok: true, program: { k: 'lit', v: null } }

    // ★★P2-9（2026-10-03）：**可选链降级**——`a?.b` 语义上等价于 `a == null ? undefined : a.b`
    //   但 `==` 是被拒绝的（宽松相等），而 `===` 的语义**恰好不同**（null 时 a===undefined 为 false，
    //   于是会去取 `a.b` ⇒ 抛错或错值）。⇒ 用 `cond` 程序**显式**表达：
    //     `a?.b`  ⇒ `(a === null || a === undefined) ? undefined : a.b`
    //   即"**空值检查节点**"——正是 JS 规范 [[Get]] 对可选链的定义。
    //   ★这也是"编译期降级"（可读、可序列化），而非运行时特判（少一条执行器分支）。
    case 'OptionalMemberExpression': {
      const obj = compileNode(n.object as Node, refNames)
      if (!obj.ok) return obj
      const guard: ExprProgram = {
        k: 'logi',
        op: '||',
        l: { k: 'bin', op: '===', l: obj.program, r: { k: 'lit', v: null } },
        r: { k: 'bin', op: '===', l: obj.program, r: { k: 'undef' } },
      }
      let access: ExprProgram
      if (n.computed === true) {
        const key = compileNode(n.property as Node, refNames)
        if (!key.ok) return key
        access = { k: 'memdyn', obj: obj.program, key: key.program }
      } else {
        const prop = n.property as Node
        if (prop.type !== 'Identifier' || typeof prop.name !== 'string') {
          return { ok: false, unsupported: '可选链的属性名不是静态标识符' }
        }
        access = { k: 'mem', obj: obj.program, key: prop.name }
      }
      return { ok: true, program: { k: 'cond', t: guard, c: { k: 'undef' }, a: access } }
    }
    case 'MemberExpression': {
      // ★★**ref `.value` 解包**（2026-10-10 · 事件方法体批次）：`count.value`（count 为已知 ref 源）
      //   ⇒ 裸源引用 `root('count')`。★只对调用方注入的 ref 名生效（非 ref 的 `.value` 不受影响）。
      if (refNames && n.computed !== true) {
        const objNode = n.object as Node
        const propNode = n.property as Node
        if (
          (objNode.type === 'Identifier' || objNode.type === 'TSAsExpression' || objNode.type === 'TSNonNullExpression') &&
          propNode?.type === 'Identifier' &&
          propNode.name === 'value'
        ) {
          const base = compileNode(objNode, refNames)
          if (base.ok && base.program.k === 'root' && refNames.has(base.program.name)) return base
        }
      }
      // ★P2-9：`Math.PI` 这类的**编译期常量内联**——见 GLOBAL_CONST_MEMBERS 头注
      //   （此前编成 `mem(root('Math'),'PI')` ⇒ 运行时 read('Math') = undefined ⇒ 静默渲染成空）
      const constName = staticGlobalName(n)
      if (constName && constName in GLOBAL_CONST_MEMBERS) {
        return { ok: true, program: { k: 'lit', v: GLOBAL_CONST_MEMBERS[constName]! } }
      }
      const obj = compileNode(n.object as Node, refNames)
      if (!obj.ok) return obj
      if (n.computed === true) {
        const key = compileNode(n.property as Node, refNames)
        if (!key.ok) return key
        return { ok: true, program: { k: 'memdyn', obj: obj.program, key: key.program } }
      }
      const prop = n.property as Node
      if (prop.type !== 'Identifier' || typeof prop.name !== 'string') {
        return { ok: false, unsupported: '成员访问的属性名不是静态标识符' }
      }
      // ★P2-9：**已知全局对象**上的非白名单成员（`Math.foo` / `JSON.x`）⇒ 明确拒绝而不是
      //   静默 undefined（`ctx.read('Math')` 恒为 undefined —— 模板会静默渲染成空）
      const knownGlobal = KNOWN_GLOBAL_ROOTS.has(staticGlobalName(n.object as Node) ?? '')
      if (knownGlobal) {
        return {
          ok: false,
          unsupported: `不支持访问内置全局 \`${staticGlobalName(n)}\`（模板层只允许白名单内建）——请改用 Math.* 纯函数（见 PURE_CALLS）或在 computed 里算好`,
        }
      }
      return { ok: true, program: { k: 'mem', obj: obj.program, key: prop.name } }
    }

    case 'UnaryExpression': {
      const op = n.operator as string
      // ★刻意排除 `typeof` / `void` / `delete`（语义与副作用都不适合模板层）
      if (op !== '!' && op !== '-' && op !== '+') return { ok: false, unsupported: `不支持一元运算符 ${op}` }
      const arg = compileNode(n.argument as Node, refNames)
      if (!arg.ok) return arg
      return { ok: true, program: { k: 'un', op: op as '!' | '-' | '+', arg: arg.program } }
    }

    case 'BinaryExpression': {
      const op = n.operator as string
      if (!BIN_OPS.has(op)) {
        return {
          ok: false,
          unsupported:
            op === '==' || op === '!='
              ? '不支持宽松相等 ==/!=（JS 语义微妙，实现错会静默算错值）——请改用 ===/!=='
              : `不支持二元运算符 ${op}`,
        }
      }
      const l = compileNode(n.left as Node, refNames)
      if (!l.ok) return l
      const r = compileNode(n.right as Node, refNames)
      if (!r.ok) return r
      return { ok: true, program: { k: 'bin', op: op as never, l: l.program, r: r.program } }
    }

    case 'LogicalExpression': {
      const op = n.operator as string
      if (op !== '&&' && op !== '||' && op !== '??') return { ok: false, unsupported: `不支持逻辑运算符 ${op}` }
      const l = compileNode(n.left as Node, refNames)
      if (!l.ok) return l
      const r = compileNode(n.right as Node, refNames)
      if (!r.ok) return r
      return { ok: true, program: { k: 'logi', op: op as '&&' | '||' | '??', l: l.program, r: r.program } }
    }

    case 'ConditionalExpression': {
      const t = compileNode(n.test as Node, refNames)
      if (!t.ok) return t
      const c = compileNode(n.consequent as Node, refNames)
      if (!c.ok) return c
      const a = compileNode(n.alternate as Node, refNames)
      if (!a.ok) return a
      return { ok: true, program: { k: 'cond', t: t.program, c: c.program, a: a.program } }
    }

    case 'ObjectExpression': {
      const props: Array<{ key: string; value: ExprProgram }> = []
      for (const raw of (n.properties as Node[]) ?? []) {
        if (raw.type !== 'ObjectProperty') return { ok: false, unsupported: '对象字面量含展开/方法等非静态成员' }
        if (raw.computed === true) return { ok: false, unsupported: '对象字面量的计算键无法静态化' }
        const keyNode = raw.key as Node
        let key: string
        if (keyNode.type === 'Identifier') key = keyNode.name as string
        else if (keyNode.type === 'StringLiteral' || keyNode.type === 'NumericLiteral') key = String(keyNode.value)
        else return { ok: false, unsupported: '对象字面量的键不是静态字面量' }
        const v = compileNode(raw.value as Node, refNames)
        if (!v.ok) return v
        props.push({ key, value: v.program })
      }
      return { ok: true, program: { k: 'obj', props } }
    }

    case 'ArrayExpression': {
      const items: ExprProgram[] = []
      for (const raw of (n.elements as Node[]) ?? []) {
        // 稀疏数组（`[a, , b]`）与展开（`[...a]`）都不支持
        if (!raw || raw.type === 'SpreadElement') return { ok: false, unsupported: '数组字面量含空缺或展开' }
        const it = compileNode(raw, refNames)
        if (!it.ok) return it
        items.push(it.program)
      }
      return { ok: true, program: { k: 'arr', items } }
    }

    case 'TemplateLiteral': {
      // ★模板串**脱糖为字符串拼接**（JS 语义等价：`\`a${x}b\`` === `'a' + x + 'b'`）
      const quasis = (n.quasis as Array<{ value: { cooked?: string } }>) ?? []
      const exprs = (n.expressions as Node[]) ?? []
      if (quasis.length === 0) return { ok: true, program: { k: 'lit', v: '' } }
      // 以首段起头；随后依次接「表达式」与「后续字面段」
      let acc: ExprProgram = { k: 'lit', v: quasis[0]?.value?.cooked ?? '' }
      for (let i = 0; i < exprs.length; i++) {
        const e = compileNode(exprs[i]!, refNames)
        if (!e.ok) return e
        acc = { k: 'bin', op: '+', l: acc, r: e.program }
        const seg = quasis[i + 1]?.value?.cooked
        if (seg !== undefined && seg !== '') acc = { k: 'bin', op: '+', l: acc, r: { k: 'lit', v: seg } }
      }
      return { ok: true, program: acc }
    }

    case 'CallExpression': {
      // ★★P2-8（2026-10-03）：**白名单纯函数 / 纯方法**可编译（表在消费端——唯一事实源）。
      //   · 自由函数（`Math.round` / `parseInt`）⇒ `call` 节点；
      //   · 方法调用（`arr.join` / `s.trim`）⇒ `mcall` 节点（**接收者要参与求值**）；
      //   白名单外一律拒绝（含业务函数）。
      const callee = n.callee as Node
      const calleeName = staticCalleeName(callee)
      const isMemberCallee = callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression'
      const methodName = isMemberCallee && callee.computed !== true
        ? (typeof (callee.property as Node | undefined)?.name === 'string' ? String((callee.property as Node).name) : '')
        : ''
      if (methodName && isPureMethodName(methodName)) {
        // 方法形态：接收者单独编译（依赖分析按接收者建图）
        const recv = compileNode(callee.object as Node, refNames)
        if (!recv.ok) return recv
        const args: ExprProgram[] = []
        for (const raw of (n.arguments as Node[]) ?? []) {
          if (raw.type === 'SpreadElement') return { ok: false, unsupported: '调用实参不支持展开运算符' }
          const a = compileNode(raw, refNames)
          if (!a.ok) return a
          args.push(a.program)
        }
        return { ok: true, program: { k: 'mcall', recv: recv.program, method: methodName, args } }
      }
      if (!calleeName || !isPureCallName(calleeName)) {
        return { ok: false, unsupported: UNSUPPORTED_CALL }
      }
      const args: ExprProgram[] = []
      for (const raw of (n.arguments as Node[]) ?? []) {
        if (raw.type === 'SpreadElement') return { ok: false, unsupported: '调用实参不支持展开运算符' }
        const a = compileNode(raw, refNames)
        if (!a.ok) return a
        args.push(a.program)
      }
      return { ok: true, program: { k: 'call', fn: calleeName, args } }
    }
    case 'NewExpression':
    case 'OptionalCallExpression':
      return { ok: false, unsupported: UNSUPPORTED_CALL }
    case 'AssignmentExpression':
    case 'UpdateExpression':
      return { ok: false, unsupported: '表达式含赋值/自增（模板表达式应为纯求值）' }
    case 'SequenceExpression':
      return { ok: false, unsupported: '不支持逗号表达式' }
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return { ok: false, unsupported: '不支持内联函数字面量' }
    case 'SpreadElement':
      return { ok: false, unsupported: '不支持展开运算符' }
    default:
      return { ok: false, unsupported: `不支持的语法节点 ${n.type}` }
  }
}

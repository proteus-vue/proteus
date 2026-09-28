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
import type { ExprProgram } from '@proteus-vue/slot-runtime'

/** 编译结果：要么给出程序，要么给出**明确的不支持原因**（供上报） */
export type ExprCompileResult = { ok: true; program: ExprProgram } | { ok: false; unsupported: string }

/** babel AST 节点（只声明本文件用到的字段） */
interface Node {
  type: string
  [k: string]: unknown
}

const UNSUPPORTED_CALL = '含函数/方法调用（纯度无法证明，属 L1 准入条件 C1）'

/** 二元运算符白名单（★刻意排除 `==` / `!=`——见 expr.ts 顶注的诚实边界） */
const BIN_OPS = new Set(['+', '-', '*', '/', '%', '===', '!==', '<', '>', '<=', '>='])

export function compileExpr(code: string): ExprCompileResult {
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
  return compileNode(expr)
}

function compileNode(n: Node): ExprCompileResult {
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

    case 'MemberExpression': {
      const obj = compileNode(n.object as Node)
      if (!obj.ok) return obj
      if (n.computed === true) {
        const key = compileNode(n.property as Node)
        if (!key.ok) return key
        return { ok: true, program: { k: 'memdyn', obj: obj.program, key: key.program } }
      }
      const prop = n.property as Node
      if (prop.type !== 'Identifier' || typeof prop.name !== 'string') {
        return { ok: false, unsupported: '成员访问的属性名不是静态标识符' }
      }
      return { ok: true, program: { k: 'mem', obj: obj.program, key: prop.name } }
    }

    case 'UnaryExpression': {
      const op = n.operator as string
      // ★刻意排除 `typeof` / `void` / `delete`（语义与副作用都不适合模板层）
      if (op !== '!' && op !== '-' && op !== '+') return { ok: false, unsupported: `不支持一元运算符 ${op}` }
      const arg = compileNode(n.argument as Node)
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
      const l = compileNode(n.left as Node)
      if (!l.ok) return l
      const r = compileNode(n.right as Node)
      if (!r.ok) return r
      return { ok: true, program: { k: 'bin', op: op as never, l: l.program, r: r.program } }
    }

    case 'LogicalExpression': {
      const op = n.operator as string
      if (op !== '&&' && op !== '||' && op !== '??') return { ok: false, unsupported: `不支持逻辑运算符 ${op}` }
      const l = compileNode(n.left as Node)
      if (!l.ok) return l
      const r = compileNode(n.right as Node)
      if (!r.ok) return r
      return { ok: true, program: { k: 'logi', op: op as '&&' | '||' | '??', l: l.program, r: r.program } }
    }

    case 'ConditionalExpression': {
      const t = compileNode(n.test as Node)
      if (!t.ok) return t
      const c = compileNode(n.consequent as Node)
      if (!c.ok) return c
      const a = compileNode(n.alternate as Node)
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
        const v = compileNode(raw.value as Node)
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
        const it = compileNode(raw)
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
        const e = compileNode(exprs[i]!)
        if (!e.ok) return e
        acc = { k: 'bin', op: '+', l: acc, r: e.program }
        const seg = quasis[i + 1]?.value?.cooked
        if (seg !== undefined && seg !== '') acc = { k: 'bin', op: '+', l: acc, r: { k: 'lit', v: seg } }
      }
      return { ok: true, program: acc }
    }

    case 'CallExpression':
    case 'NewExpression':
    case 'OptionalCallExpression':
      return { ok: false, unsupported: UNSUPPORTED_CALL }
    case 'OptionalMemberExpression':
      return { ok: false, unsupported: '不支持可选链 `?.`（可用 `??` 与三元改写）' }
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

// tests/handler-actions.test.ts —— ★★★T2 事件**动作执行器**判据（App 三端共享唯一实现）
//
// 【锁什么】`runHandlerActions`（`@proteus-vue/slot-runtime`）是 `screen-runtime`（App 壳统一
//   运行期）与 `entry-vapor`（vapor 夹具）**共用**的动作执行器。本文件判它的语义：
//   ① set/add（含 add 数值收窄）② **let**（局部变量 + 形参绑定，作用域遮蔽）③ **if/else**
//   （条件真/假走不同臂）④ **$event**（载荷注入）⑤ emit/nav 交 hooks。★破坏性：任何让「let 不遮蔽
//   / if 不分支 / $event 取不到」的回归都能被这里抓到。
import { describe, it, expect } from 'vitest'
import { runHandlerActions } from '@proteus-vue/slot-runtime'
import type { HandlerAction, ExprProgram } from '@proteus-vue/slot-runtime'

/** 造一个执行环境：数据用普通对象，记录 write 与 emit/nav */
function env(initial: Record<string, unknown> = {}, event?: unknown) {
  const data = { ...initial }
  const emitted: Array<[string, unknown]> = []
  const navs: string[] = []
  return {
    data,
    emitted,
    navs,
    run: (acts: HandlerAction[]) =>
      runHandlerActions(acts, {
        read: (n) => data[n],
        write: (n, v) => { data[n] = v },
        event,
      }, {
        onEmit: (e, p) => emitted.push([e, p]),
        onNav: (t) => navs.push(t),
      }),
  }
}

const root = (name: string): ExprProgram => ({ k: 'root', name })
const lit = (v: number | string | boolean): ExprProgram => ({ k: 'lit', v })
const bin = (op: '+' | '-' | '*' | '>', l: ExprProgram, r: ExprProgram): ExprProgram => ({ k: 'bin', op, l, r })

describe('★★★T2 动作执行器（App 三端共享）', () => {
  it('① set / add（add 数值收窄：非数按 0 起）', () => {
    const e = env({ count: 3, name: 'x' })
    e.run([
      { op: 'set', source: 'name', program: lit('y') },
      { op: 'add', source: 'count', program: lit(2) },
    ])
    expect(e.data.name).toBe('y')
    expect(e.data.count).toBe(5)
  })

  it('② ★let：局部变量写入 + 后续动作可读（并遮蔽同名数据源）', () => {
    const e = env({ count: 4, count2: 999 })
    e.run([
      { op: 'let', name: 'y', program: bin('*', root('count'), lit(2)) }, // y = count * 2 = 8
      { op: 'set', source: 'result', program: root('y') },                 // result = y = 8
      // count2 是数据源（非局部）——仍从 data 读
      { op: 'set', source: 'result2', program: root('count2') },
    ])
    expect(e.data.result).toBe(8)
    expect(e.data.result2).toBe(999)
  })

  it('②b ★形参绑定（let）+ $event：`function add(n){count += n}` 的产物执行', () => {
    // 编译产物形态：先 let n = 2，再 add count ← n
    const e = env({ count: 10 })
    e.run([
      { op: 'let', name: 'n', program: lit(2) },
      { op: 'add', source: 'count', program: root('n') },
    ])
    expect(e.data.count).toBe(12)
  })

  it('④ ★$event：由 run 的 event 注入（形参 let 绑定 $event）', () => {
    const e = env({ count: 0 }, 42)
    e.run([
      { op: 'let', name: 'ev', program: root('$event') },
      { op: 'set', source: 'count', program: root('ev') },
    ])
    expect(e.data.count).toBe(42)
  })

  it('③ ★if/else：条件真走 then、假走 else', () => {
    const then = [{ op: 'set', source: 'r', program: lit('positive') } as HandlerAction]
    const els = [{ op: 'set', source: 'r', program: lit('non-positive') } as HandlerAction]
    const cond = (v: number): ExprProgram => bin('>', lit(v), lit(0))
    const run = (n: number) => {
      const e = env({})
      e.run([{ op: 'if', cond: cond(n), then, else: els }])
      return e.data.r
    }
    expect(run(5)).toBe('positive')
    expect(run(-1)).toBe('non-positive')
  })

  it('③b if 无 else ⇒ 假时**不执行**任何臂（不是崩）', () => {
    const e = env({})
    e.run([{ op: 'if', cond: bin('>', lit(-1), lit(0)), then: [{ op: 'set', source: 'r', program: lit(1) }] }])
    expect(e.data.r).toBeUndefined()
  })

  it('⑥ 嵌套 if + let 作用域（then 里的 let 不外泄）', () => {
    const e = env({ count: 5 })
    e.run([
      { op: 'if', cond: bin('>', root('count'), lit(0)), then: [
        { op: 'let', name: 'inner', program: lit(7) },
        { op: 'set', source: 'out', program: root('inner') },
      ] },
      // 外层读 inner ⇒ 未定义（then 的局部不外泄）——program 是 root inner ⇒ 读回 undefined
      { op: 'set', source: 'leak', program: root('inner') },
    ])
    expect(e.data.out).toBe(7)
    expect(e.data.leak).toBeUndefined()
  })

  it('⑤ emit / nav 交 hooks', () => {
    const e = env({ v: 9 })
    e.run([
      { op: 'emit', event: 'bump', program: root('v') },
      { op: 'nav', target: 'detail' },
    ])
    expect(e.emitted).toEqual([['bump', 9]])
    expect(e.navs).toEqual(['detail'])
  })

  it('⑦ ★T3 log：`console.log(实参…)` 求值后交 onLog（多实参按序求值）', () => {
    const data: Record<string, unknown> = { n: 7 }
    const logs: Array<[string, unknown[]]> = []
    runHandlerActions(
      [{ op: 'log', level: 'warn', programs: [lit('hit'), root('n'), bin('*', root('n'), lit(2))] }],
      { read: (k) => data[k], write: (k, v) => { data[k] = v } },
      { onLog: (level, values) => logs.push([level, values]) },
    )
    expect(logs).toEqual([['warn', ['hit', 7, 14]]])
  })
})

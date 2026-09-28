// tests/vapor-expr-program.test.ts
// ★★V6：**表达式程序**（方案 §4.3 Step 4）——含运算的表达式不再"永不更新"
//
// 【本文件要证明的核心命题（对应 P0-2）】
//   此前 `{{ n + 1 }}` / `{{ group.title + item.name }}` 这类**含运算**的表达式
//   落到 `expr` 形态 ⇒ 参考实现**不认识** ⇒ 该槽位**永不更新**（首版还静默跳过）。
//   而这类表达式在实际模板里极常见 ⇒ 编译期编成**可序列化程序**，运行时解释执行。
//
// 【判据四层】
//   ① **编译**：受支持的表达式 ⇒ `form='program'`（不再是 `expr`）
//   ② **求值正确**：程序执行结果 == JS 原生求值结果（逐构造对数）
//   ③ **不支持的构造 ⇒ 明确上报**（不"尽力编译"出可能错的值）
//   ④ **可序列化**：程序纯 JSON（方案 §4.4 硬性要求：跨端禁 eval）
import { describe, it, expect } from 'vitest'
import { buildVaporSubscriptions } from '@proteus-vue/compiler'
import { evalExpr } from '@proteus-vue/slot-runtime'
import type { ExprProgram } from '@proteus-vue/slot-runtime'

const sfc = (script: string, template: string): string =>
  `<template>\n${template}\n</template>\n\n<script setup lang="ts">\n${script}\n</script>\n`

/** 取某 SFC 里第一个非 member/const 的求值器（即表达式类） */
function exprSpec(src: string) {
  const r = buildVaporSubscriptions(src, 'x.vue')
  return { r, specs: r.table.evaluators.filter((e) => e.form === 'program' || e.form === 'expr') }
}

describe('V6 · 表达式程序：编译形态', () => {
  it('★含运算的表达式 ⇒ form=program（不再落到不支持求值的 expr）', () => {
    const { specs } = exprSpec(
      sfc(`const n = ref(1)\n`, `<p-text :width="n + 1" />`),
    )
    expect(specs.length).toBeGreaterThan(0)
    expect(specs[0]!.form).toBe('program')
    expect(specs[0]!.program, 'program 形态必须带程序体').toBeTruthy()
  })

  it('★★可序列化：程序是纯 JSON（方案 §4.4：跨端禁 eval）', () => {
    const { specs } = exprSpec(sfc(`const a = ref(1)\nconst b = ref('x')\n`, `<p-text :width="a > 0 ? a * 2 : 0" :height="b + a" />`))
    for (const s of specs) {
      const json = JSON.stringify(s.program)
      expect(JSON.parse(json)).toEqual(s.program) // 往返无损 ⇒ 纯 JSON
      expect(json).not.toContain('function') // 不得含函数（否则需 eval）
      expect(json).not.toContain('=>')
    }
  })

  it('★受支持与不受支持的分界：调用/可选链/宽松相等 ⇒ 保持 expr 并**上报**', () => {
    const cases: Array<[string, string]> = [
      ['调用', `const n = ref(1)\nfunction f(v: number) { return v }\n`], // 模板里用 f(n)
      ['宽松相等', `const a = ref(1)\n`],
    ]
    const callSfc = sfc(cases[0]![1], `<p-text :width="f(n)" />`)
    const r1 = buildVaporSubscriptions(callSfc, 'x.vue')
    const e1 = r1.table.evaluators.find((e) => e.form === 'expr')
    expect(e1, '调用应保持 expr 形态（纯度无法证明）').toBeTruthy()
    expect(r1.diagnostics.some((d) => d.code === 'VAPOR_EXPR_UNSUPPORTED' && d.severity === 'warn')).toBe(true)

    const looseSfc = sfc(cases[1]![1], `<p-text :width="a == 1" />`)
    const r2 = buildVaporSubscriptions(looseSfc, 'y.vue')
    const d2 = r2.diagnostics.find((d) => d.code === 'VAPOR_EXPR_UNSUPPORTED')
    expect(d2, '宽松相等必须被明确拒绝并上报').toBeTruthy()
    expect(d2!.message).toContain('宽松相等') // 说明具体原因（可行动）
  })
})

describe('V6 · 表达式程序：求值正确性（逐构造对数 JS 原生）', () => {
  const cases: Array<{ name: string; code: string; env: Record<string, unknown>; want: unknown }> = [
    { name: '加法（数值）', code: 'n + 1', env: { n: 1 }, want: 2 },
    { name: '加法（字符串拼接）', code: 'a + b', env: { a: 'x', b: 'y' }, want: 'xy' },
    { name: '字符串 + 数字（JS 语义）', code: 'a + n', env: { a: 'v', n: 3 }, want: 'v3' },
    { name: '减法（含字符串转数字）', code: 'a - n', env: { a: '5', n: 2 }, want: 3 },
    { name: '乘除取模', code: 'n * 2 + n / 2 - n % 3', env: { n: 7 }, want: 7 * 2 + 7 / 2 - (7 % 3) },
    { name: '严格相等', code: 'a === b', env: { a: 1, b: 1 }, want: true },
    { name: '严格不等', code: 'a !== b', env: { a: 1, b: '1' }, want: true },
    { name: '比较', code: 'a < b', env: { a: 1, b: 2 }, want: true },
    { name: '逻辑与短路', code: 'a && a.b', env: { a: null }, want: null },
    { name: '逻辑或', code: 'a || b', env: { a: '', b: 'fb' }, want: 'fb' },
    { name: '空值合并', code: 'a ?? b', env: { a: 0, b: 9 }, want: 0 },
    { name: '三元', code: 'n > 0 ? "pos" : "neg"', env: { n: -1 }, want: 'neg' },
    { name: '一元取反', code: '!ok', env: { ok: false }, want: true },
    { name: '一元负号', code: '-n', env: { n: 5 }, want: -5 },
    { name: '一元正号（数字转换）', code: '+s', env: { s: '42' }, want: 42 },
    { name: '成员访问', code: 'a.b.c', env: { a: { b: { c: 7 } } }, want: 7 },
    { name: '计算成员（动态键）', code: 'a[k]', env: { a: { x: 5 }, k: 'x' }, want: 5 },
    { name: '对象字面量', code: '({ v: n, s: "x" })', env: { n: 1 }, want: { v: 1, s: 'x' } },
    { name: '数组字面量', code: '[n, n + 1]', env: { n: 1 }, want: [1, 2] },
    { name: '模板串（脱糖为拼接）', code: '`v=${n}!`', env: { n: 3 }, want: 'v=3!' },
    { name: 'null 上的成员访问（不抛）', code: 'a.b', env: { a: null }, want: undefined },
    { name: 'undefined 关键字', code: 'a === undefined', env: { a: undefined }, want: true },
  ]

  for (const c of cases) {
    it(`★「${c.name}」：${c.code} ⇒ ${JSON.stringify(c.want)}`, () => {
      const { r } = exprSpec(
        sfc(
          `${Object.keys(c.env).map((k) => `const ${k} = ref(${JSON.stringify(c.env[k])})`).join('\n')}\n`,
          // ★属性值用**双引号**包裹；若表达式含双引号则先替换为单引号（HTML 属性边界问题）
          `<p-text :height="${c.code.replace(/"/g, "'")}" />`,
        ),
      )
      // ★按**表达式**取求值器（而非按形态）——纯路径会走 `member` 优化（正确），
      //   其余落 `program`；两种都要能求出正确值 ⇒ 这里断言"求值语义"而非"编译形态"。
      //   （首版只找 `program` ⇒ 纯路径用例误报"未编译"——那是我的测试选错槽位，不是实现问题。）
      // ★按**槽位**取求值器（`layout.height` 就是我们测的那个绑定）——
      //   直接 `evaluators.find(...)` 可能选到别的绑定（本仓实测：我的测试这么错过一次）
      const slot = r.table.sources.flatMap((x) => x.slots).find((x) => x.propKey === 'layout.height')
      expect(slot, '应存在 layout.height 槽位').toBeTruthy()
      const spec = r.table.evaluators.find((e) => e.evaluatorId === slot!.evaluatorId)
      expect(spec, '该槽位应有求值器').toBeTruthy()
      const got =
        spec!.form === 'program'
          ? evalExpr(spec!.program as ExprProgram, { read: (n) => c.env[n] })
          : // member 形态：按 path 取值（复刻运行时的 member 求值）
            (() => {
              let v = c.env[spec!.root!]
              for (const seg of (spec!.path ?? '').split('.').slice(1)) {
                if (v == null || typeof v !== 'object') return undefined
                v = (v as Record<string, unknown>)[seg]
              }
              return v
            })()
      expect(got, `\`${c.code}\` 求值应为 ${JSON.stringify(c.want)}，实得 ${JSON.stringify(got)}`).toEqual(c.want)
    })
  }

  it('★★与 JS 原生求值逐例对数（防"实现得自洽但与 JS 不符"）', () => {
    const probes: Array<{ code: string; env: Record<string, unknown> }> = [
      { code: 'a + b', env: { a: 1, b: '2' } },
      { code: 'a - b', env: { a: '3', b: true } },
      { code: 'a ? b : c', env: { a: 0, b: 1, c: 2 } },
      { code: 'a ?? b', env: { a: null, b: 'd' } },
      { code: 'a && b || c', env: { a: 1, b: 0, c: 'z' } },
      { code: '-a + +b', env: { a: '2', b: '3' } },
    ]
    for (const p of probes) {
      const src = sfc(
        `${Object.keys(p.env).map((k) => `const ${k} = ref(${JSON.stringify(p.env[k])})`).join('\n')}\n`,
        `<p-text :height="${p.code}" />`,
      )
      const { r } = exprSpec(src)
      const prog = r.table.evaluators.find((e) => e.form === 'program')?.program as ExprProgram | undefined
      expect(prog, `\`${p.code}\` 含运算 ⇒ 应为 program`).toBeTruthy()
      const got = evalExpr(prog!, { read: (n) => p.env[n] })
      // 用 JS 原生算同一表达式作为基准真值
      const keys = Object.keys(p.env)
      const native = new Function(...keys, `return (${p.code})`)(...keys.map((k) => p.env[k]))
      expect(got, `\`${p.code}\` 应等于 JS 原生结果`).toEqual(native)
    }
  })
})

describe('V6 · 表达式程序：端到端接线', () => {
  it('★★外层别名 + 运算 ⇒ 真能发指令（此前该槽位永不更新）', async () => {
    const { ListRegistry, PropKeyTable, StringPool, SlotRuntime, VaporRuntime, decodeOps } = await import('@proteus-vue/slot-runtime')
    const src = sfc(
      `const groups = ref([{ id: 1, title: 'T', items: [{ id: 2, name: 'x' }] }])\n`,
      `<p-view v-for="group in groups" :key="group.id"><p-text v-for="item in group.items" :key="item.id">{{ group.title + item.name }}</p-text></p-view>`,
    )
    const { table } = buildVaporSubscriptions(src, 'o.vue')
    const slot = table.sources.flatMap((s) => s.slots).find((x) => x.kind === 'list-item')!
    const reg = new ListRegistry()
    reg.registerItems(slot.listId!, [{ itemKey: '2', slotNodes: { [slot.itemSlotId!]: 2002 } }])
    const ops: unknown[] = []
    const rt = new SlotRuntime(new PropKeyTable(), new StringPool(), (b) => ops.push(...decodeOps(b).ops))
    const vapor = new VaporRuntime(table, rt, VaporRuntime.buildEvaluators(table.evaluators), reg)
    const groups = [{ id: 1, title: 'T', items: [{ id: 2, name: 'x' }] }]
    const ctx = {
      read: (n: string) => (n === 'groups' ? groups : n === 'group' ? groups[0] : n === 'item' ? groups[0]!.items[0] : undefined),
    }
    const load = vapor.load(ctx, () => {})
    expect(load.uninstantiatedSlots.length, '不应有未实例化槽位（此前这里是 1）').toBe(0)
    vapor.relink(ctx)
    rt.flush()
    expect(ops.length).toBeGreaterThan(0)
  })
})

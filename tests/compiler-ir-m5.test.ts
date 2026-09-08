// tests/compiler-ir-m5.test.ts
// ★#505 M5 规则治理补全（草案 §6 M5 + §4.2 G2 机器基础）——批 1：治理门禁基线
//   executeRule 公开导出已在 M2 提前闭合；本批补：
//   ① 规则总数/分相快照（删规则/误减 → 红——与 golden 同精神，防「登记规则」静默退场）
//   ② 字段齐全（example.before/after + verify 非空——89 规则实测零缺失后固化）
//   ③ verify 指向存在性（verify 首 token 为文件路径 → 必须存在；非文件 token = 手工/golden 锚定 → 白名单登记）
//   ④ 执行层 apply 规则集快照（校准族六条 + 原生两条——删 apply 即红）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { listTransformRules, executeRule, compileVueSfc } from '@proteus-vue/compiler'

/** 实现文件（分派点扫描面） */
const IMPL_FILES = ['packages/compiler/src/template.ts', 'packages/compiler/src/script.ts', 'packages/compiler/src/style.ts', 'packages/compiler/src/validate.ts', 'packages/compiler/src/index.ts']

type RulePhase = 'template' | 'script' | 'style' | 'validate'
type TransformRule = ReturnType<typeof listTransformRules>[number]

const isApplyRule = (r: TransformRule): boolean => typeof (r as { apply?: unknown }).apply === 'function'

/** ★总数快照：规则加减必须显式更新本快照（删除规则/合并规则 → 红，防止「规则消失但无人在意」） */
const COUNT_SNAPSHOT = { total: 95, template: 50, script: 31, style: 9, validate: 5 }

/** ★执行层快照：已登记 apply 的规则（判定/命名入规则 = 删 apply 即红） */
const APPLY_RULES = [
  'style/px-to-rpx',
  'template/scope-attr',
  'directive/v-bind-style',
  'event/inline-expression',
  'directive/v-model',
  'event/modifier-self-once',
]

/** verify 非文件 token（golden fixture / 手工验证锚定）——白名单登记（新增须评审） */
const VERIFY_NON_FILE = new Set(['node/interpolation', 'script/es5-safe', 'style/semantic-base-wxss', 'style/skyline-selector'])

describe('★#505 M5 批 1：规则治理门禁——总数/分相快照 + verify 机器可解析', () => {
  it('规则总数与分相快照（95 = template 50 + script 31 + style 9 + validate 5——增删规则须同步更新本快照并跑 gen:reference）', () => {
    const rules = listTransformRules()
    const byPhase: Record<string, number> = {}
    for (const r of rules) byPhase[r.phase] = (byPhase[r.phase] ?? 0) + 1
    expect(rules.length, `规则总数漂移（现 ${rules.length}，快照 ${COUNT_SNAPSHOT.total}）——新增规则请在 registry 登记 + 更新快照`).toBe(COUNT_SNAPSHOT.total)
    for (const [phase, n] of Object.entries({ template: 50, script: 31, style: 9, validate: 5 })) {
      expect(byPhase[phase], `phase ${phase} 规则数漂移（现 ${byPhase[phase] ?? 0}，快照 ${n}）`).toBe(n)
    }
  })

  it('字段齐全：全部规则 example.before/after + verify 非空（90/90 实测零缺失后固化——新规则登记必修）', () => {
    const rules = listTransformRules()
    const incomplete = rules.filter((r) => !r.verify || !r.example || !r.example.before || !r.example.after)
    expect(incomplete.map((r) => r.id), `字段不全：${incomplete.map((r) => r.id).join(', ')}（AI 说明书必须含 before→after 示例与 verify 锚点）`).toEqual([])
  })

  it('verify 指向存在性：文件 token 必须存在（防 verify 引用幽灵测试文件——误指向比空更糟）；非文件锚定走白名单', () => {
    const fileRe = /^([\w./-]+\.(?:ts|mjs))/
    const bad: string[] = []
    for (const r of listTransformRules()) {
      const m = (r.verify ?? '').match(fileRe)
      if (!m) {
        if (!VERIFY_NON_FILE.has(r.id)) bad.push(`${r.id}: verify 无文件 token 且未登记白名单 → ${r.verify}`)
        continue
      }
      if (!fs.existsSync(path.resolve(m[1]))) bad.push(`${r.id}: verify 指向不存在 → ${m[1]}`)
    }
    expect(bad, `verify 锚点问题：\n${bad.join('\n')}`).toEqual([])
  })

  it('执行层 apply 规则集快照（判定+命名入规则——新增 apply 规则须补集合并带删 apply 即红用例）', () => {
    const applies = listTransformRules().filter((r) => typeof r.apply === 'function').map((r) => r.id).sort()
    expect(applies).toEqual([...APPLY_RULES].sort())
    // executeRule 对未登记 apply 的规则抛错（护栏在位——M2 已验，这里锁定不退化）
    expect(() => executeRule('tag/div-to-view', { input: {} })).toThrowError(/未登记 apply/)
  })
})

describe('★#505 M5 批 2：apply 规则 example 产物断言 harness——每条执行层规则 = 可编译 fixture + 启/禁用差分 + after 标记', () => {
  const opts = { px2rpx: true, rpxRatio: 2 }
  /** 差分 harness 排除集：disabled 语义未接线/不适用差分验证的 apply 规则（须带原因——防止静默豁免） */
  const DIFF_EXCLUDED: Record<string, string> = {}
  /** 派生自 registry example 的「可编译最小形态」fixture（example 为片段/散文——fixture 是其语义最小化；
   *  after 标记 = 说明书 after 的可判据子串——说明书示例与真实产物机器绑定） */
  const CASES: Array<{ id: string; phase: 'template' | 'style'; sfc: string; marker: string }> = [
    {
      id: 'style/px-to-rpx',
      phase: 'style',
      sfc: '<template><view class="a">x</view></template>\n<style>.a { padding: 48px; }</style>',
      marker: 'padding: 96rpx',
    },
    {
      id: 'template/scope-attr',
      phase: 'template',
      sfc: '<template><div class="card">x</div></template>\n<style>.card { color: red; }</style>',
      marker: 'card-data-v-',
    },
    {
      id: 'directive/v-bind-style',
      phase: 'template',
      sfc: '<script setup lang="ts">import { ref } from "vue"\nconst bg = ref("#fff")</script>\n<template><view :style="{ backgroundColor: bg }">x</view></template>',
      marker: 'background-color:{{bg}}',
    },
    {
      id: 'event/inline-expression',
      phase: 'template',
      sfc: '<script setup lang="ts">import { ref } from "vue"\nconst showModal = ref(false)</script>\n<template><view @click="showModal = !showModal">x</view></template>',
      marker: 'proteusInlineSetShowModalShowModal',
    },
    {
      id: 'directive/v-model',
      phase: 'template',
      sfc: '<script setup lang="ts">import { ref } from "vue"\nconst name = ref("")</script>\n<template><input v-model="name" /></template>',
      marker: 'proteusOnNameInput',
    },
    {
      id: 'event/modifier-self-once',
      phase: 'template',
      sfc: '<script setup lang="ts">const onTap = () => {}</script>\n<template><view @click.self="onTap">x</view></template>',
      marker: 'proteusSelfOnTap',
    },
  ]

  it('六条 apply 规则：启用产物含 after 标记 && 禁用产物无标记 && 启/禁用产物差分（example 说明书与实现不脱节）', () => {
    const applies = new Set(APPLY_RULES)
    const fails: string[] = []
    for (const c of CASES) {
      const enabled = compileVueSfc(c.sfc, { filename: `m5-${c.id.replace('/', '-')}.vue`, ...opts })
      const disabled = compileVueSfc(c.sfc, { filename: `m5-${c.id.replace('/', '-')}.vue`, ...opts, rules: { disabled: [c.id] } })
      const art = (r: typeof enabled): string => (c.phase === 'style' ? r.wxss : r.wxml)
      if (!art(enabled).includes(c.marker)) fails.push(`${c.id}: 启用产物缺 after 标记 ${c.marker}`)
      if (art(disabled).includes(c.marker)) fails.push(`${c.id}: 禁用产物仍含 after 标记 ${c.marker}（规则禁用未生效）`)
      if (enabled.wxml === disabled.wxml && enabled.js === disabled.js && enabled.wxss === disabled.wxss) {
        fails.push(`${c.id}: 启/禁用产物无差分（example 未真实触发规则）`)
      }
    }
    expect(fails, `apply 规则 example 产物断言：\n${fails.join('\n')}`).toEqual([])
    // harness 防退化：CASES ∪ DIFF_EXCLUDED 覆盖全部 apply 规则（豁免须带原因）
    expect(
      [...CASES.map((c) => c.id), ...Object.keys(DIFF_EXCLUDED)].sort(),
      '新增 apply 规则必须补入 CASES（或带原因豁免 DIFF_EXCLUDED）',
    ).toEqual([...applies].sort())
  })
})

describe('★#505 M5 批 4：变换点覆盖——apply 规则必须在实现文件有 executeRule 分派点（禁硬编码旁路）', () => {
  it('六条 apply 规则各 ≥1 处 executeRule("<id>") 分派点（登记 apply 却无分派点 = 规则未真正接线）', () => {
    const src = IMPL_FILES.map((f) => `${f}\n${fs.readFileSync(path.resolve(f), 'utf-8')}`).join('\n')
    const missing = APPLY_RULES.filter((id) => !src.includes(`executeRule('${id}'`))
    expect(missing, `无 executeRule 分派点（登记 apply 但实现未接线）：${missing.join(', ')}`).toEqual([])
  })
})

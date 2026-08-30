// tests/registry-drift.test.ts
// ★反向漂移门禁（底线整改 P1a）：实现 ↔ 注册表永不脱节
// 校验：transform 实现代码（template/script/style/validate/overrides/plugin）中引用的
//   规则 ID（disabled.has / trace.add / executeRule）必须全部能在注册表解析——
//   AI/人类在实现里加了新转换决策但忘登记 → 当场报错（不再靠自律）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getTransformRule, listTransformRules } from '../packages/compiler/src/transforms/registry'

/** 实现文件（消费方）：转换逻辑所在，规则 ID 出现在 disabled/trace/executeRule 调用中 */
const IMPL_FILES = [
  'packages/compiler/src/index.ts',
  'packages/compiler/src/template.ts',
  'packages/compiler/src/script.ts',
  'packages/compiler/src/style.ts',
  'packages/compiler/src/validate.ts',
  'packages/compiler/src/overrides.ts',
]

/** 规则 ID 字面量模式：phase/name（与 transforms/types.ts 的 id 规范一致；component/ 为 2026-08 组件 class 透传决策域，page/ 为页面滚动桥接） */
const ID_RE = /'((?:tag|event|directive|nav|node|annotation|template|script|style|validate|slot|transition|component|page)\/[a-z0-9-]+)'/g

describe('实现 ↔ 注册表反向漂移门禁', () => {
  it('实现文件引用的全部规则 ID 已登记（新增转换决策必须登记 AI 说明书）', () => {
    const referenced = new Set<string>()
    for (const rel of IMPL_FILES) {
      const src = fs.readFileSync(path.resolve(rel), 'utf-8')
      for (const m of src.matchAll(ID_RE)) referenced.add(m[1])
    }
    expect(referenced.size).toBeGreaterThan(20) // 防门禁自身退化
    const missing = [...referenced].filter((id) => !getTransformRule(id))
    expect(missing, `实现引用了未登记的规则 ID：${missing.join(', ')}（新转换决策须在 transforms/ 登记 AI 说明书）`).toEqual([])
  })

  it('注册表无孤儿规则（每条规则都被实现引用或为 limitation/planned）', () => {
    const referenced = new Set<string>()
    for (const rel of IMPL_FILES) {
      const src = fs.readFileSync(path.resolve(rel), 'utf-8')
      for (const m of src.matchAll(ID_RE)) referenced.add(m[1])
    }
    // 表驱动类别（tag/*、semantic/*）经 TAG_RULE_BY_TAG/SEMANTIC_CLASS 动态消费（transforms.test 映射覆盖守护）；
    // validate 规则经产物自校验消费（validate.ts 内部非 ID 字面量引用）；其余 implemented 必须被字面量引用
    const orphans = listTransformRules().filter(
      (r) =>
        r.status === 'implemented' &&
        !referenced.has(r.id) &&
        !r.id.startsWith('validate/') &&
        !r.id.startsWith('tag/') &&
        !r.id.startsWith('semantic/'),
    )
    expect(orphans.map((r) => r.id), `未消费的 implemented 规则（应被实现引用）：${orphans.map((r) => r.id).join(', ')}`).toEqual([])
  })
})

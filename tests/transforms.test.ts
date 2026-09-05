// tests/transforms.test.ts
// 编译规则注册表完整性测试 —— 保证 AI 说明书与实现永不脱节：
// 1. 规则 ID 全局唯一、字段齐全（说明书完整）
// 2. 映射表（TAG_MAP/EVENT_MAP/SEMANTIC_CLASS）每个键都被规则覆盖（改 tags.ts 遗漏会当场报错）
// 3. 查询 API（list / get / format）行为正确
import { describe, it, expect } from 'vitest'
import {
  listTransformRules,
  getTransformRule,
  formatTransformRule,
  formatTransformCatalog,
  TRANSFORM_RULES,
} from '../packages/compiler/src/transforms/registry'
import { TAG_MAP, EVENT_MAP, SEMANTIC_CLASS } from '../packages/compiler/src/tags'

const REQUIRED_FIELDS = ['id', 'phase', 'title', 'description', 'why', 'when', 'example', 'verify', 'status', 'source'] as const

describe('transforms 规则注册表', () => {
  it('规则 ID 全局唯一', () => {
    const ids = TRANSFORM_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每条规则 AI 说明书字段齐全（what/why/when/example/verify/source）', () => {
    for (const rule of TRANSFORM_RULES) {
      for (const field of REQUIRED_FIELDS) {
        expect(rule[field], `${rule.id} 缺少字段 ${field}`).toBeTruthy()
      }
      expect(rule.example.before.length > 0, `${rule.id} 示例 before 为空`).toBe(true)
      expect(rule.example.after.length > 0, `${rule.id} 示例 after 为空`).toBe(true)
      expect(['implemented', 'planned', 'limitation']).toContain(rule.status)
    }
  })

  it('每条规则带英文说明 descriptionEn（★#480 注册表双语——官网 EN 态 Playground 规则目录消费；新增规则必补）', () => {
    for (const rule of TRANSFORM_RULES) {
      expect(typeof rule.descriptionEn, `${rule.id} 缺 descriptionEn`).toBe('string')
      expect((rule.descriptionEn ?? '').length, `${rule.id} descriptionEn 为空`).toBeGreaterThan(0)
      // 语言中立的说明（纯代码映射，如 v-if → wx:if）zh=en 天然相同属合法；含中文却照抄=漏译
      const hasCjk = /[\u4e00-\u9fff]/.test(rule.description)
      expect(rule.descriptionEn === rule.description && hasCjk, `${rule.id} descriptionEn 疑似漏译（照抄中文）`).toBe(false)
    }
  })

  it('id 命名规范：<category>/<name>（category=tag/event/directive/script/style/validate/...）', () => {
    for (const rule of TRANSFORM_RULES) {
      expect(rule.id, `${rule.id} 不符合 <category>/<name> 格式`).toMatch(/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/)
      expect(['template', 'script', 'style', 'validate']).toContain(rule.phase)
    }
  })

  it('TAG_MAP 每个键都被规则 mapping 覆盖（标签映射无遗漏）', () => {
    const covered = new Set<string>()
    for (const rule of TRANSFORM_RULES) {
      if (rule.mapping) for (const key of Object.keys(rule.mapping)) covered.add(key)
    }
    for (const tag of Object.keys(TAG_MAP)) {
      expect(covered.has(tag), `TAG_MAP 的 ${tag} 未被任何规则覆盖（rule.mapping 同步 tags.ts）`).toBe(true)
    }
  })

  it('EVENT_MAP / SEMANTIC_CLASS 每个键都被规则覆盖', () => {
    const covered = new Set<string>()
    for (const rule of TRANSFORM_RULES) {
      if (rule.mapping) for (const key of Object.keys(rule.mapping)) covered.add(key)
    }
    for (const ev of Object.keys(EVENT_MAP)) {
      expect(covered.has(ev), `EVENT_MAP 的 ${ev} 未被规则覆盖`).toBe(true)
    }
    for (const tag of Object.keys(SEMANTIC_CLASS)) {
      expect(covered.has(tag), `SEMANTIC_CLASS 的 ${tag} 未被规则覆盖`).toBe(true)
    }
  })

  it('规则映射值与 tags.ts 常量一致（同源引用，至少匹配一张源表）', () => {
    const tables = [TAG_MAP, EVENT_MAP, SEMANTIC_CLASS]
    for (const rule of TRANSFORM_RULES) {
      if (!rule.mapping) continue
      for (const [k, v] of Object.entries(rule.mapping)) {
        // 语义标签同时存在于 TAG_MAP（→text）与 SEMANTIC_CLASS（→proteus-h1），
        // 不同规则各取一张表的值，只需与其中一张源表一致即可
        const matched = tables.some((t) => k in t && t[k] === v)
        expect(matched, `${rule.id} 的映射 ${k}→${v} 与任何源表都不一致（防漂移失败）`).toBe(true)
      }
    }
  })

  it('listTransformRules 按阶段过滤，数量合理', () => {
    expect(listTransformRules().length).toBe(TRANSFORM_RULES.length)
    for (const phase of ['template', 'script', 'style', 'validate'] as const) {
      const rules = listTransformRules(phase)
      expect(rules.length).toBeGreaterThan(0)
      for (const r of rules) expect(r.phase).toBe(phase)
    }
  })

  it('getTransformRule 按 ID 查询（未知 ID 返回 undefined）', () => {
    expect(getTransformRule('tag/div-to-view')?.title).toBe('div → view')
    expect(getTransformRule('validate/wxml-pairing')?.phase).toBe('validate')
    expect(getTransformRule('not/exist')).toBeUndefined()
  })

  it('formatTransformRule 渲染完整说明书', () => {
    const rule = getTransformRule('script/ref-incdec')
    expect(rule).toBeTruthy()
    const text = formatTransformRule(rule!)
    expect(text).toContain('## script/ref-incdec')
    expect(text).toContain('为什么：')
    expect(text).toContain('如何验证：')
    expect(text).toContain('实现位置：')
  })

  it('formatTransformCatalog 渲染全量目录（四阶段齐全）', () => {
    const text = formatTransformCatalog()
    expect(text).toContain('### template 阶段')
    expect(text).toContain('### script 阶段')
    expect(text).toContain('### style 阶段')
    expect(text).toContain('### validate 阶段')
    expect(text).toContain('`tag/div-to-view`')
  })
})

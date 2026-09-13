// tests/showcase-api-table.test.ts
// ★showcase API 表一致性回归锁（2026-09-13）：演示页的 Props/Events 表必须覆盖组件实现——
//   防止「表写一半、实现一半」的漂移（用户看文档会漏掉能力）。
//   覆盖范围：目前对已建详情页的组件逐一校验（新加组件同步加一行）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

/** 从 .vue 源码提取 defineProps 的 key（对象字面量形式） */
function propsOf(file: string): string[] {
  const src = fs.readFileSync(file, 'utf-8')
  const m = src.match(/defineProps\(\{([\s\S]*?)\n\}\)/)
  if (!m) return []
  const out: string[] = []
  for (const km of m[1].matchAll(/^\s{2}([a-zA-Z][\w]*)\s*:/gm)) out.push(km[1])
  return out
}

/** 从 .vue 源码提取 defineEmits([...]) 的事件名 */
function emitsOf(file: string): string[] {
  const src = fs.readFileSync(file, 'utf-8')
  const m = src.match(/defineEmits\(\[([\s\S]*?)\]\)/)
  if (!m) return []
  return [...m[1].matchAll(/['"]([a-zA-Z][\w]*)['"]/g)].map((x) => x[1])
}

/** 从演示页的 apiRows 表提取第一列（属性名，kebab 或 camel） */
function apiRowsOf(pageFile: string): string[] {
  const src = fs.readFileSync(pageFile, 'utf-8')
  const m = src.match(/const apiRows = ref\(\[([\s\S]*?)\n\]\)/)
  if (!m) return []
  return [...m[1].matchAll(/\['([^']+)'/g)].map((x) => x[1])
}

/** 从演示页的 eventRows 表提取第一列（事件名；可能含 "a / b" 合并写法） */
function eventRowsOf(pageFile: string): string[] {
  const src = fs.readFileSync(pageFile, 'utf-8')
  const m = src.match(/const eventRows = ref\(\[([\s\S]*?)\n\]\)/)
  if (!m) return []
  return [...m[1].matchAll(/\['([^']+)'/g)].map((x) => x[1])
}

const norm = (s: string) => s.replace(/[-:]/g, '').toLowerCase()

describe('★showcase API 表完整性（表 ⊇ 实现）', () => {
  const cases = [
    {
      name: 'p-button',
      impl: path.join(ROOT, 'src/components/p-button/index.vue'),
      page: path.join(ROOT, 'showcase/subpackages/components/pages/p-button.vue'),
    },
    {
      name: 'p-switch',
      impl: path.join(ROOT, 'src/components/p-switch/index.vue'),
      page: path.join(ROOT, 'showcase/subpackages/components/pages/p-switch.vue'),
    },
    {
      name: 'p-checkbox',
      impl: path.join(ROOT, 'src/components/p-checkbox/index.vue'),
      page: path.join(ROOT, 'showcase/subpackages/components/pages/p-checkbox.vue'),
    },
    {
      name: 'p-radio',
      impl: path.join(ROOT, 'src/components/p-radio/index.vue'),
      page: path.join(ROOT, 'showcase/subpackages/components/pages/p-radio.vue'),
    },
    {
      name: 'p-picker',
      impl: path.join(ROOT, 'src/components/p-picker/index.vue'),
      page: path.join(ROOT, 'showcase/subpackages/components/pages/p-picker.vue'),
    },
    {
      name: 'p-slider',
      impl: path.join(ROOT, 'src/components/p-slider/index.vue'),
      page: path.join(ROOT, 'showcase/subpackages/components/pages/p-slider.vue'),
    },
    {
      name: 'p-progress',
      impl: path.join(ROOT, 'src/components/p-progress/index.vue'),
      page: path.join(ROOT, 'showcase/subpackages/components/pages/p-progress.vue'),
    },
    {
      name: 'p-textarea',
      impl: path.join(ROOT, 'src/components/p-textarea/index.vue'),
      page: path.join(ROOT, 'showcase/subpackages/components/pages/p-textarea.vue'),
    },
  ]

  for (const c of cases) {
    it(`${c.name}：Props 表覆盖全部 defineProps`, () => {
      const props = propsOf(c.impl)
      const table = new Set(apiRowsOf(c.page).map(norm))
      const missing = props.filter((p) => !table.has(norm(p)))
      expect(missing, `${c.name} 演示页 Props 表缺：${missing.join(', ')}`).toEqual([])
    })

    it(`${c.name}：Events 表覆盖全部 defineEmits`, () => {
      const emits = emitsOf(c.impl)
      const table = eventRowsOf(c.page).map((r) => r.split('/').map((s) => norm(s.trim()))).flat()
      const missing = emits.filter((e) => !table.includes(norm(e)))
      expect(missing, `${c.name} 演示页 Events 表缺：${missing.join(', ')}`).toEqual([])
    })
  }
})

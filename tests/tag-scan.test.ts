// tests/tag-scan.test.ts
// ★按需组件输出扫描器（`collectUsedFrameworkComponents`）回归门禁。
//
// 背景（2026-09-19 真机暴露的缺陷）：MP 产物「按需输出框架组件」的扫描器**硬编码 `tag.startsWith('p-')`**，
//   而组件库有 `pg-` 前缀（pg-glass，G-07 液态玻璃统一入口）→ 被判「非框架组件」静默剔除，
//   产物只留 index.json（缺 js/wxml/wxss）→ 真机报
//   `pages/system-glass.json: usingComponents["pg-glass"] 未找到组件` 且**模拟器启动失败**。
//   本文件锁住判据：**以组件目录/文件真实存在为准，不依赖命名前缀**。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collectUsedFrameworkComponents, extractTags, collectCompilerEmittedTags } from '@proteus-vue/plugin-vite/tag-scan'

/** 造一个临时「组件库 + 页面」工程 */
function fixture(pageTemplate: string, componentDirs: string[]): { page: string; componentsDir: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-tagscan-'))
  const componentsDir = path.join(dir, 'components')
  for (const name of componentDirs) {
    fs.mkdirSync(path.join(componentsDir, name), { recursive: true })
    fs.writeFileSync(path.join(componentsDir, name, 'index.vue'), '<template><div class="x"><slot /></div></template>')
  }
  const page = path.join(dir, 'page.vue')
  fs.writeFileSync(page, pageTemplate)
  return { page, componentsDir, dir }
}

describe('按需组件输出扫描器（tag-scan）', () => {
  it('★覆盖非 p- 前缀组件（pg-glass——前缀硬编码缺陷的回归锁）', () => {
    const { page, componentsDir } = fixture(
      '<template><pg-glass :intensity="60"><p-text>玻璃</p-text></pg-glass></template>',
      ['pg-glass', 'p-text'],
    )
    const used = collectUsedFrameworkComponents([page], componentsDir)
    expect(used.has('pg-glass'), 'pg-glass 必须被识别（否则产物缺四件套 → 真机启动失败）').toBe(true)
    expect(used.has('p-text')).toBe(true)
  })

  it('未引用的组件不进集合（按需输出本身仍有效）', () => {
    const { page, componentsDir } = fixture('<template><p-text>只用了 text</p-text></template>', ['p-text', 'p-button', 'pg-glass'])
    const used = collectUsedFrameworkComponents([page], componentsDir)
    expect([...used]).toEqual(['p-text'])
  })

  it('非组件标签不误收（div/view/未知 p- 标签）', () => {
    const { page, componentsDir } = fixture('<template><div><view>x</view><p-nonexistent /></div></template>', ['p-text'])
    const used = collectUsedFrameworkComponents([page], componentsDir)
    expect(used.size).toBe(0)
  })

  it('传递依赖闭包：页面 → 组件 → 组件（A 内用 B 时 B 也必须输出）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-tagscan-'))
    const componentsDir = path.join(dir, 'components')
    for (const [name, inner] of [
      ['p-outer', '<template><p-inner /></template>'],
      ['p-inner', '<template><div><slot /></div></template>'],
    ] as const) {
      fs.mkdirSync(path.join(componentsDir, name), { recursive: true })
      fs.writeFileSync(path.join(componentsDir, name, 'index.vue'), inner)
    }
    const page = path.join(dir, 'page.vue')
    fs.writeFileSync(page, '<template><p-outer /></template>')
    const used = collectUsedFrameworkComponents([page], componentsDir)
    expect([...used].sort()).toEqual(['p-inner', 'p-outer'])
  })

  it('注释里的标签不算引用（防「注释即产出」虚胖）', () => {
    const { page, componentsDir } = fixture('<template><!-- <p-button /> --><p-text>x</p-text></template>', ['p-text', 'p-button'])
    expect([...collectUsedFrameworkComponents([page], componentsDir)]).toEqual(['p-text'])
  })

  it('★编译器产出标签计入（动画 SVG → p-svg-canvas，否则按需输出会漏）', () => {
    expect([...collectCompilerEmittedTags('<svg><animate attributeName="cx" /></svg>')]).toContain('p-svg-canvas')
    expect([...collectCompilerEmittedTags('<svg><animate attributeName="opacity" /></svg>')]).not.toContain('p-svg-canvas')
  })

  it('extractTags：只收标签名（不含属性/闭合符）', () => {
    const tags = extractTags('<pg-glass class="g" :intensity="60"><p-view /></pg-glass>')
    expect([...tags].sort()).toEqual(['p-view', 'pg-glass'])
  })
})

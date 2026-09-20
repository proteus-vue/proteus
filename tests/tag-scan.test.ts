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

// ─────────────────────────────────────────────────────────────────────────────
// ★★2026-09-20 外部实战报告 F-30（真机阻断级）回归锁：**遍历不进入应用组件**
//
// 此前 BFS 只解析框架组件目录 → 遇到应用组件（src/components/xxx）直接 `continue` →
//   其模板永不扫描 → 「页面 → 应用组件 → 框架组件」（**官方推荐形态**）的链在第一步就断 →
//   used 恒空 → 76 个框架组件全被判「未引用」，只产出 index.json（缺 js/wxml/wxss）→
//   真机 `usingComponents["p-drawer"] 未找到组件`、**模拟器启动失败**。
//   而构建期「按需输出 0 个」被当作合法结果、无任何告警 → 四道门禁全放行。
//
// 修法：BFS 增加**应用组件目录**解析（解析顺序与 gen-routes 的 collectComponents 同源：
//   应用组件优先 → 再框架组件）。修后 `collectUsedFrameworkComponents` 增加可选第 3 参 appComponentsDir。
// ─────────────────────────────────────────────────────────────────────────────
describe('F-30：经应用组件中转的框架组件收集', () => {
  /** 造「框架组件库 + 应用组件 + 页面」三层 fixture */
  function layeredFixture(opts: {
    fwComponents: string[]
    appComponents: Array<{ tag: string; template: string; flat?: boolean }>
    pageTemplate: string
  }): { page: string; componentsDir: string; appComponentsDir: string; dir: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-f30-'))
    const componentsDir = path.join(dir, 'fw')
    for (const n of opts.fwComponents) {
      fs.mkdirSync(path.join(componentsDir, n), { recursive: true })
      fs.writeFileSync(path.join(componentsDir, n, 'index.vue'), '<template><div><slot /></div></template>')
    }
    const appComponentsDir = path.join(dir, 'app', 'components')
    for (const c of opts.appComponents) {
      if (c.flat) {
        fs.mkdirSync(appComponentsDir, { recursive: true })
        fs.writeFileSync(path.join(appComponentsDir, `${c.tag}.vue`), c.template)
      } else {
        fs.mkdirSync(path.join(appComponentsDir, c.tag), { recursive: true })
        fs.writeFileSync(path.join(appComponentsDir, c.tag, 'index.vue'), c.template)
      }
    }
    const page = path.join(dir, 'app', 'pages', 'a.vue')
    fs.mkdirSync(path.dirname(page), { recursive: true })
    fs.writeFileSync(page, opts.pageTemplate)
    return { page, componentsDir, appComponentsDir, dir }
  }

  it('★★页面 → 应用组件 → 框架组件：两个框架组件都必须被收集（F-30 主锁）', () => {
    const f = layeredFixture({
      fwComponents: ['p-button', 'p-scroll-view'],
      appComponents: [
        { tag: 'my-card', template: '<template><view><p-button>ok</p-button></view></template>' },
        { tag: 'job-drawer', template: '<template><p-scroll-view><slot /></p-scroll-view></template>' },
      ],
      pageTemplate: '<template><view><my-card /><job-drawer /></view></template>',
    })
    const withApp = collectUsedFrameworkComponents([f.page], f.componentsDir, f.appComponentsDir)
    expect([...withApp].sort(), '经应用组件中转的框架组件必须被收集').toEqual(['p-button', 'p-scroll-view'])
    // ★对照：不传应用组件目录（旧行为）→ 恒空。锁住它以防回退（这正是 F-30 的形态）
    const withoutApp = collectUsedFrameworkComponents([f.page], f.componentsDir)
    expect(withoutApp.size, '不传应用组件目录时无法发现中转引用（F-30 形态）').toBe(0)
    fs.rmSync(f.dir, { recursive: true, force: true })
  })

  it('★应用组件自身不计入返回值（返回值语义 = 框架组件），其子组件必须计入', () => {
    const f = layeredFixture({
      fwComponents: ['p-text'],
      appComponents: [{ tag: 'card', template: '<template><view><p-text>t</p-text></view></template>' }],
      pageTemplate: '<template><view><card /></view></template>',
    })
    const used = collectUsedFrameworkComponents([f.page], f.componentsDir, f.appComponentsDir)
    expect([...used], '应用组件名不应出现在框架组件集合里').toEqual(['p-text'])
    fs.rmSync(f.dir, { recursive: true, force: true })
  })

  it('★应用组件用扁平文件（components/<tag>.vue）同样可被遍历', () => {
    const f = layeredFixture({
      fwComponents: ['p-icon'],
      appComponents: [{ tag: 'badge', template: '<template><view><p-icon /></view></template>', flat: true }],
      pageTemplate: '<template><view><badge /></view></template>',
    })
    expect([...collectUsedFrameworkComponents([f.page], f.componentsDir, f.appComponentsDir)]).toEqual(['p-icon'])
    fs.rmSync(f.dir, { recursive: true, force: true })
  })

  it('★页面直接用框架组件（不经应用组件）仍正常——回归边界不受影响', () => {
    const f = layeredFixture({
      fwComponents: ['p-view'],
      appComponents: [],
      pageTemplate: '<template><view><p-view /></view></template>',
    })
    expect([...collectUsedFrameworkComponents([f.page], f.componentsDir, f.appComponentsDir)]).toEqual(['p-view'])
    fs.rmSync(f.dir, { recursive: true, force: true })
  })
})

// tests/plugin-mp-entries.test.ts
// ★2026-09-13 回归锁：MP 待编译清单的「页面 / 组件」分类。
//   故障背景（用户实测）：小程序里组件详情页（如 subpackages/components/pages/p-button）整页无法滚动，
//   而首页正常。根因：分类用「路径含 /components/」反推 → 分包目录名恰好叫 components →
//   页面被误判为组件 → 产物成 Component() 且跳过页面滚动容器包装（scroll-view）→ 整页不滚。
//   本测试锁：**分包根下（哪怕路径含 components 字样）的文件一律是页面**；组件只来自
//   <appDir>/components 与 @proteus-vue/components 包。
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collectMpEntries } from '../packages/plugin-vite/src/plugin'

const tmpDirs: string[] = []
function mkTemp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-mp-entries-'))
  tmpDirs.push(d)
  return d
}
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

/** 造一个与 showcase 同构的工程：分包目录名恰为 components */
/** 在工程根下写文件（模块级——新增用例可复用） */
function writeIn(root: string, rel: string, content = '<template><view /></template>') {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

function makeProject() {
  const root = mkTemp()
  const write = (rel: string, content = '<template><view /></template>') => writeIn(root, rel, content)
  write('src/pages/index.vue')
  // ★关键：分包根叫 components，页面路径含 /components/ —— 旧启发式误判的触发条件
  // ★2026-09-18：页面须**真实引用** p-button——框架组件现按引用闭包输出（未引用即不产出），
  //   故下面「proteus/p-button/index 存在」的断言以此为前提。
  write('src/subpackages/components/pages/p-button.vue', '<template><p-button @tap="go">x</p-button></template>')
  write('src/subpackages/components/pages/p-input.vue')
  write('src/subpackages/capabilities/pages/camera.vue')
  // 真正的组件（两处）
  // ★注意：这是**应用组件目录** <appDir>/components（= src/components），与语义组件库包（@proteus-vue/components）无关
  write('src/components/page-shell/index.vue')
  write('src/components/demo-block/index.vue')
  write('src/framework/p-button/index.vue')
  return root
}

function collect(root: string) {
  return collectMpEntries({
    projectRoot: path.join(root, 'src'),
    appDir: path.join(root, 'src'),
    pagesDir: 'pages',
    subPackages: [
      { root: 'subpackages/components' },
      { root: 'subpackages/capabilities' },
    ],
    componentsDir: path.join(root, 'src/framework'),
  })
}

describe('★MP 待编译清单分类（页面 vs 组件）', () => {
  it('分包目录名含 components → 其页面仍是页面（isComponent=false）', () => {
    const root = makeProject()
    const entries = collect(root)
    const byRel = new Map(entries.map((e) => [e.rel, e.isComponent]))
    // ★核心断言：旧启发式会把这两条误判为组件
    expect(byRel.get('subpackages/components/pages/p-button'), '分包 components 下的页面必须归类为页面').toBe(false)
    expect(byRel.get('subpackages/components/pages/p-input')).toBe(false)
    expect(byRel.get('subpackages/capabilities/pages/camera')).toBe(false)
    expect(byRel.get('pages/index')).toBe(false)
  })

  it('组件只来自 <appDir>/components 与 @proteus-vue/components 包（isComponent=true）', () => {
    const root = makeProject()
    const entries = collect(root)
    const byRel = new Map(entries.map((e) => [e.rel, e.isComponent]))
    expect(byRel.get('components/page-shell/index')).toBe(true)
    expect(byRel.get('components/demo-block/index')).toBe(true)
    // 框架组件产物 rel 规范化为 proteus/<name>/index
    expect(byRel.get('proteus/p-button/index')).toBe(true)
  })

  it('分类不再依赖路径字符串（破坏性验证：即便目录名不是 components 也一致）', () => {
    const root = makeProject()
    // 造一个不含 components 字样的分包页——两侧都应归类为页面
    fs.mkdirSync(path.join(root, 'src/subpackages/order/pages'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src/subpackages/order/pages/list.vue'), '<template><view /></template>')
    const entries = collectMpEntries({
      projectRoot: path.join(root, 'src'),
      appDir: path.join(root, 'src'),
      pagesDir: 'pages',
      subPackages: [{ root: 'subpackages/order' }],
      componentsDir: path.join(root, 'src/framework'),
    })
    const byRel = new Map(entries.map((e) => [e.rel, e.isComponent]))
    expect(byRel.get('subpackages/order/pages/list')).toBe(false)
  })

  it('webOnly 页面被跳过（不进编译清单）', () => {
    const root = makeProject()
    const webOnly = new Set([path.join(root, 'src/pages/index.vue')])
    const entries = collectMpEntries({
      projectRoot: path.join(root, 'src'),
      appDir: path.join(root, 'src'),
      pagesDir: 'pages',
      subPackages: [{ root: 'subpackages/components' }],
      componentsDir: path.join(root, 'src/framework'),
      webOnlyPages: webOnly,
    })
    expect(entries.find((e) => e.rel === 'pages/index')).toBeUndefined()
    expect(entries.find((e) => e.rel === 'subpackages/components/pages/p-button')).toBeTruthy()
  })
})

describe('★框架组件按引用输出（2026-09-18：修「无条件全量输出」体积缺陷）', () => {
  it('未被任何页面引用的框架组件**不进**编译清单', () => {
    const root = makeProject()
    // 造一个未被引用的框架组件
    writeIn(root, 'src/framework/p-unused-xyz/index.vue')
    const byRel = new Map(collectMpEntries({
      projectRoot: root,
      appDir: path.join(root, 'src'),
      pagesDir: 'src/pages',
      subPackages: [{ root: 'src/subpackages/components' }, { root: 'src/subpackages/capabilities' }],
      componentsDir: path.join(root, 'src/framework'),
    }).map((e) => [e.rel, e.isComponent]))
    expect(byRel.get('proteus/p-button/index'), '被引用的组件应产出').toBe(true)
    expect(byRel.get('proteus/p-unused-xyz/index'), '未被引用的组件不应产出').toBeUndefined()
  })

  it('逃生舱：componentEmit=all 时回到全量输出', () => {
    const root = makeProject()
    writeIn(root, 'src/framework/p-unused-xyz/index.vue')
    const byRel = new Map(collectMpEntries({
      projectRoot: root,
      appDir: path.join(root, 'src'),
      pagesDir: 'src/pages',
      subPackages: [{ root: 'src/subpackages/components' }, { root: 'src/subpackages/capabilities' }],
      componentsDir: path.join(root, 'src/framework'),
      componentEmit: 'all',
    }).map((e) => [e.rel, e.isComponent]))
    expect(byRel.get('proteus/p-unused-xyz/index')).toBe(true)
  })

  it('★组件间传递依赖计入闭包（A 用 B → B 也必须产出）', () => {
    const root = makeProject()
    writeIn(root, 'src/framework/p-outer/index.vue', '<template><p-inner /></template>')
    writeIn(root, 'src/framework/p-inner/index.vue', '<template><view>x</view></template>')
    writeIn(root, 'src/pages/uses-outer.vue', '<template><p-outer /></template>')
    const byRel = new Map(collectMpEntries({
      projectRoot: root,
      appDir: path.join(root, 'src'),
      pagesDir: 'src/pages',
      subPackages: [],
      componentsDir: path.join(root, 'src/framework'),
    }).map((e) => [e.rel, e.isComponent]))
    expect(byRel.get('proteus/p-outer/index'), '直接引用').toBe(true)
    expect(byRel.get('proteus/p-inner/index'), '传递依赖（p-outer 内引用了 p-inner）').toBe(true)
  })
})

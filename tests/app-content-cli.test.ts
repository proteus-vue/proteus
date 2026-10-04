// tests/app-content-cli.test.ts —— ★★★App 三端对齐 · 阶段 1b-A（A1）：
//   **`proteus build --target app` 的构建器**（项目路由 → 真实 SFC → 编译器 → 屏内容）（2026-10-04）
//
// 【这张测试锁什么】`buildAppScreenContent(root)`——App 屏内容构建器（CLI `--target app` 的唯一实现，
//   也是 hosts 装置生成器的实现——"一处实现"）。判据：
//   ① 从项目路由（auto-routes.ts）驱动：屏名集合 == 路由集合（同源）
//   ② 逐页编译真实 SFC ⇒ 屏内容有节点（非空）
//   ③ 产物落盘 `dist/app/screen-content.json`，可读、幂等（再跑内容一致）
//   ④ 真实页面（含 class 的页面）也能编出**结构**（class 样式属缺口 C1，但结构不能空）
//   ⑤ 缺路由产物 ⇒ 明确报错（不静默产空）

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildAppScreenContent } from '../packages/cli/src/app-content'

const ROOT = path.resolve(__dirname, '..')
const EXAMPLES = path.join(ROOT, 'examples')

describe('★阶段 1b-A（A1）· App 屏内容构建器（项目路由驱动）', () => {
  it('① 从项目路由驱动：屏名集合 == 路由集合（同源）', async () => {
    const autoRoutes = path.join(EXAMPLES, 'router', 'auto-routes.ts')
    expect(fs.existsSync(autoRoutes), 'examples 路由产物在位（先构建过 examples）').toBe(true)
    const mod = (await import(pathToFileURLStr(autoRoutes))) as { routes: Array<{ name: string }> }
    const r = await buildAppScreenContent(EXAMPLES, 'android')
    const content = JSON.parse(fs.readFileSync(r.outFile, 'utf-8')) as Record<string, unknown>
    expect(r.compiled, '全部路由编译成功').toBe(mod.routes.length)
    expect(r.skipped, '零跳过').toBe(0)
    for (const route of mod.routes) {
      expect(content[route.name], `路由 ${route.name} 有屏内容`).toBeTruthy()
    }
  })

  it('② 逐页编译真实 SFC ⇒ 屏内容有节点（非空结构）', async () => {
    const r = await buildAppScreenContent(EXAMPLES, 'android')
    const content = JSON.parse(fs.readFileSync(r.outFile, 'utf-8')) as Record<string, { nodes: unknown[] }>
    expect(content.index, 'index 页在位').toBeTruthy()
    expect(content.index!.nodes.length, '★index 真实页面有节点（结构非空）').toBeGreaterThan(1)
    // 抽查若干页
    for (const name of ['index', 'mine', 'forms']) {
      if (content[name]) expect(content[name]!.nodes.length, `${name} 有节点`).toBeGreaterThan(0)
    }
  })

  it('③ 产物落盘 + 幂等（再跑内容一致）', async () => {
    const a = await buildAppScreenContent(EXAMPLES, 'android')
    const first = fs.readFileSync(a.outFile, 'utf-8')
    const b = await buildAppScreenContent(EXAMPLES, 'android')
    const second = fs.readFileSync(b.outFile, 'utf-8')
    expect(second, '确定性：两次构建产物逐字节一致').toBe(first)
    expect(a.outFile.endsWith(path.join('dist', 'app', 'android', 'screen-content.json')), '落点契约（按平台分目录）').toBe(true)
  })

  it('④ 诊断如实返回（多为 CSS class / 不支持语法——不静默）', async () => {
    const r = await buildAppScreenContent(EXAMPLES, 'android')
    // examples 真实页面含 v-model/v-html/动态 style 等 —— 应有诊断（如实暴露）
    expect(r.diagnostics.length, '应有诊断（真实页面含不支持语法）').toBeGreaterThan(0)
    expect(r.diagnostics.some((d) => /VAPOR_/.test(d)), '诊断带 Vapor 码').toBe(true)
  })

  it('⑤ App 三端各产各目录（标准目标集：ios/android/harmony）', async () => {
    for (const p of ['ios', 'android', 'harmony'] as const) {
      const r = await buildAppScreenContent(EXAMPLES, p)
      expect(r.platform).toBe(p)
      expect(r.outFile.endsWith(path.join('dist', 'app', p, 'screen-content.json')), `${p} 落 dist/app/${p}/`).toBe(true)
      expect(r.compiled, `${p} 编译页数 >0`).toBeGreaterThan(0)
    }
  })

  it('⑥ 缺路由产物 ⇒ 明确报错（不静默产空）', async () => {
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'no-routes-'))
    await expect(buildAppScreenContent(tmp, 'android'), '缺 auto-routes ⇒ 抛错').rejects.toThrow(/auto-routes|gen-routes/)
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})

/** pathToFileURL 包装（vitest 下动态 import 绝对路径 .ts） */
function pathToFileURLStr(p: string): string {
  return require('node:url').pathToFileURL(p).href
}

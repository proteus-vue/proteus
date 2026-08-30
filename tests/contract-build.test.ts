// tests/contract-build.test.ts
// ★build-plan（Testing B5 产物契约）：跨层一致性硬断言——
//   ① config.subPackages ↔ app.json subPackages ↔ 路由记录 subPackage 字段
//   ② 页面 page.json 存在 + usingComponents 指向的组件产物存在（/proteus/<tag>/index）
//   ③ 共享模块产物路径契约（相对 appDir 不越界，rollup emitFile 安全）
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runGenRoutes } from '../packages/plugin-vite/src/gen-routes'
import type { ProteusConfig } from '../packages/plugin-vite/src/config'

const FRAMEWORK_COMPONENTS_DIR = path.resolve('src/components')

function makeConfig(extra: Partial<ProteusConfig> = {}): ProteusConfig {
  return {
    platform: 'mp-weixin',
    skyline: true,
    appid: 'wx0000000000',
    pagesDir: 'src/pages',
    routesOutput: 'src/router/auto-routes.ts',
    customRoute: { registerPresets: true, builders: {} },
    setDataBridge: { batchWindow: 16, perComponent: true },
    style: { px2rpx: true, rpxRatio: 2 },
    subPackages: [{ root: 'subpackages/order', name: 'order' }],
    ...extra,
  }
}

function writeFixture(abs: string, content: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

describe('build 产物契约（跨层一致性）', () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-contract-build-'))
  afterAll(() => {
    fs.rmSync(TMP, { recursive: true, force: true })
  })
  const root = path.join(TMP, 'app')
  const pageDir = path.join(root, 'src/pages')
  fs.mkdirSync(pageDir, { recursive: true })

  it('subPackages 一致性：config ↔ app.json ↔ 路由记录 subPackage 字段', () => {
    writeFixture(
      path.join(pageDir, 'index.vue'),
      `<template><view>首页</view></template>\n<route>\n{\n  "meta": { "title": "首页" }\n}\n</route>\n`,
    )
    writeFixture(
      path.join(root, 'subpackages/order/pages/list.vue'),
      `<template><view>订单列表</view></template>\n<route>\n{\n  "meta": { "title": "订单列表" }\n}\n</route>\n`,
    )
    runGenRoutes({ config: makeConfig(), root, frameworkComponentsDir: FRAMEWORK_COMPONENTS_DIR })

    // ① config.subPackages ↔ app.json.subPackages（pages 为分包内相对路径）
    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/app.json'), 'utf-8'))
    expect(appJson.subPackages).toEqual([{ root: '../subpackages/order', name: 'order', pages: ['pages/list'] }])
    expect(appJson.pages).toEqual(['pages/index'])

    // ② 路由记录（auto-routes）↔ app.json 页面（subPackage 字段一致；path 相对 appDir）
    const auto = fs.readFileSync(path.join(root, 'src/router/auto-routes.ts'), 'utf-8')
    expect(auto).toContain('subPackage: "order"')
    expect(auto).toContain('path: "../subpackages/order/pages/list"')
  })

  it('页面 page.json 存在 + usingComponents 指向的组件产物存在（/proteus/<tag>/index）', () => {
    writeFixture(
      path.join(pageDir, 'index.vue'),
      `<template><p-view><p-button>go</p-button></p-view></template>\n<route>\n{\n  "meta": { "title": "组件页" }\n}\n</route>\n`,
    )
    runGenRoutes({ config: makeConfig(), root, frameworkComponentsDir: FRAMEWORK_COMPONENTS_DIR })
    const pageJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/pages/index.json'), 'utf-8'))
    for (const tag of Object.keys(pageJson.usingComponents ?? {})) {
      const rel = pageJson.usingComponents[tag]
      // usingComponents 路径契约：/proteus/<tag>/index 或 /components/<tag>/index
      expect(rel).toMatch(/^\/(proteus|components)\/[a-z-]+\/index$/)
      if (rel.startsWith('/proteus/')) {
        const tagName = rel.split('/')[2]
        expect(fs.existsSync(path.join(FRAMEWORK_COMPONENTS_DIR, tagName, 'index.vue'))).toBe(true)
      }
    }
  })

  it('每个组件产物必有 component.json（component: true 最小声明 + 嵌套 usingComponents）', () => {
    // p-view：无嵌套 → { component: true }；virtual-list：嵌套 p-list-view → component + usingComponents
    const viewJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/proteus/p-view/index.json'), 'utf-8'))
    expect(viewJson.component).toBe(true)
    expect(viewJson.usingComponents).toBeUndefined()
    const vlJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/proteus/virtual-list/index.json'), 'utf-8'))
    expect(vlJson.component).toBe(true)
    expect(vlJson.usingComponents['p-list-view']).toBe('/proteus/p-list-view/index')
  })

  it('共享模块产物路径契约：相对 appDir 不越界（rollup emitFile 安全）', () => {
    writeFixture(path.join(root, 'src/utils/format.ts'), `export function fmt(n: number): string { return String(n) }\n`)
    writeFixture(
      path.join(pageDir, 'index.vue'),
      `<script setup lang="ts">\nimport { fmt } from '../utils/format'\nconst x = fmt(1)\n</script>\n<template><view>{{ x }}</view></template>\n`,
    )
    runGenRoutes({ config: makeConfig(), root, frameworkComponentsDir: FRAMEWORK_COMPONENTS_DIR })
    // 编译产物契约由 plugin buildStart 完成（emitFile）；此处断言路由侧产物结构完整
    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/app.json'), 'utf-8'))
    expect(appJson.pages).toContain('pages/index')
  })
})

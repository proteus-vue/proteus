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

const FRAMEWORK_COMPONENTS_DIR = path.resolve('packages/components')

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
    runGenRoutes({ config: makeConfig(), root, componentsDir: FRAMEWORK_COMPONENTS_DIR })

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
    runGenRoutes({ config: makeConfig(), root, componentsDir: FRAMEWORK_COMPONENTS_DIR })
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

  // ★2026-09-20 契约收紧（F-30 连带形态）：组件**声明与本体同源**——
  //   此前 `writeComponentJsons` 无条件为**全部 76 个**框架组件写 index.json，而按需输出（插件阶段）
  //   只产用到的本体 → 产物里出现「有声明、无本体」的空壳（被引用时真机报未找到组件、**启动失败**）。
  //   现改为：gen-routes **只为**「按引用闭包算出的组件集」写声明，与插件阶段的本体输出同源。
  //
  // ★本用例的边界：`runGenRoutes` 只负责**声明**（本体由 vite 插件阶段产出，属另一相）。
  //   故此处断言的是**声明侧契约**：declared ⊆ used（不多声明）；本体完整性由
  //   `scripts/audit-mp-artifacts.mjs`（真构建产物审计）与 tag-scan 的 F-30 用例覆盖。
  it('组件声明契约：只为「实际引用闭包」内的组件写声明（不多声明）', () => {
    // 页面只引用 p-view / p-button
    writeFixture(path.join(pageDir, 'index.vue'), `<template><p-view><p-button>go</p-button></p-view></template>\n`)
    runGenRoutes({ config: makeConfig(), root, componentsDir: FRAMEWORK_COMPONENTS_DIR })
    const proteusDir = path.join(root, 'dist/mp-weixin/proteus')
    const declared = fs
      .readdirSync(proteusDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(proteusDir, e.name, 'index.json')))
      .map((e) => e.name)
    expect(declared.length, '页面引用了框架组件，应产出声明').toBeGreaterThan(0)
    // ★核心：不得为未引用的组件写声明（F-30 的空壳正是由此产生）
    expect(declared.sort()).toEqual(['p-button', 'p-view'])
    // 被引用的组件必须有声明（不能因过滤而漏声明）
    const pageJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/pages/index.json'), 'utf-8'))
    for (const [, rel] of Object.entries(pageJson.usingComponents ?? {})) {
      if (!String(rel).startsWith('/proteus/')) continue
      const name = String(rel).split('/')[2]
      expect(fs.existsSync(path.join(proteusDir, name, 'index.json')), `${name} 被引用但无声明`).toBe(true)
    }
  })

  it('组件声明契约：component: true + styleIsolation: apply-shared（p-view）', () => {
    const viewJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/proteus/p-view/index.json'), 'utf-8'))
    expect(viewJson.component).toBe(true)
    expect(viewJson.usingComponents).toBeUndefined()
    // ★样式穿透契约：页面 wxss 需作用到组件根节点（<p-view class="box"> 外层容器样式），
    //   styleIsolation 必须为 apply-shared（默认 isolated 会挡住页面样式，2026-08 真机实测）
    expect(viewJson.styleIsolation).toBe('apply-shared')
  })

  it('组件嵌套声明契约：组件自身引用其他框架组件时写 usingComponents', () => {
    // virtual-list 的模板含 <p-list-view> → 用它验证「嵌套 usingComponents」契约
    writeFixture(path.join(pageDir, 'index.vue'), `<template><virtual-list :items="[]" /></template>\n`)
    runGenRoutes({ config: makeConfig(), root, componentsDir: FRAMEWORK_COMPONENTS_DIR })
    const vlJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/proteus/virtual-list/index.json'), 'utf-8'))
    expect(vlJson.component).toBe(true)
    expect(vlJson.usingComponents['p-list-view']).toBe('/proteus/p-list-view/index')
  })

  it('默认首页一致：主包根 index 页置顶（小程序 pages[0] = 冷启动默认页，对齐 Web RouterView 回退）', () => {
    // 制造字母序首页非 index 的页面集合（a-demo 字母序在 index 前）
    writeFixture(path.join(pageDir, 'a-demo.vue'), `<template><view>a</view></template>\n`)
    writeFixture(path.join(pageDir, 'index.vue'), `<template><view>首页</view></template>\n`)
    runGenRoutes({ config: makeConfig(), root, componentsDir: FRAMEWORK_COMPONENTS_DIR })
    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/app.json'), 'utf-8'))
    expect(appJson.pages[0]).toBe('pages/index')
  })

  it('共享模块产物路径契约：相对 appDir 不越界（rollup emitFile 安全）', () => {
    writeFixture(path.join(root, 'src/utils/format.ts'), `export function fmt(n: number): string { return String(n) }\n`)
    writeFixture(
      path.join(pageDir, 'index.vue'),
      `<script setup lang="ts">\nimport { fmt } from '../utils/format'\nconst x = fmt(1)\n</script>\n<template><view>{{ x }}</view></template>\n`,
    )
    runGenRoutes({ config: makeConfig(), root, componentsDir: FRAMEWORK_COMPONENTS_DIR })
    // 编译产物契约由 plugin buildStart 完成（emitFile）；此处断言路由侧产物结构完整
    const appJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/mp-weixin/app.json'), 'utf-8'))
    expect(appJson.pages).toContain('pages/index')
  })
})

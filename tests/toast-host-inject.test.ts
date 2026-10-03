// tests/toast-host-inject.test.ts —— ★★★GP4-a：Toast 宿主「按需注入」回归锁
//
// 【要锁什么】"源码零每页引入"是 GP5 判据（八条场景**任一需要每页引入 ⇒ 方案不成立**）的
//   第一道兑现：宿主必须由构建期注入。本文件锁三条：
//   ① **按需**（用过 toast API 才注入——不用的应用零成本）
//   ② **手动优先**（用户自己写了宿主 ⇒ 不注入——双宿主会各渲染一份 ⇒ 同一条显示两次）
//   ③ **★扫描器不自污染**（本组件首版踩的真坑：`page-overlay.ts` 里的**字面量**被自己扫到 ⇒
//      恒判"手动声明" ⇒ 自动注入**永不生效**——最忌的静默失效形态）
//
// 【④ 组件闭环】注入的标签必须在每页 `usingComponents` 注册 + 本体产出（否则真机整块不渲染，F-30 同族）

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectToastUsage, injectToastHost, TOAST_HOST_TAG } from '../packages/plugin-vite/src/page-overlay'

/** 造一个临时应用目录（隔离——不碰真实 examples） */
function fixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-toast-'))
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
  return dir
}

describe('★GP4-a 按需注入 ① 按需（用过才注入）', () => {
  it('页面调用 showToast ⇒ used=true', () => {
    const dir = fixture({
      'pages/a.vue': `<script setup>import { showToast } from '@proteus-vue/runtime'\nshowToast({ text: 'x' })\n</script>`,
    })
    expect(detectToastUsage(dir).used).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('★反向：完全没用 ⇒ used=false（不用的应用不背宿主与 runtime 依赖）', () => {
    const dir = fixture({
      'pages/a.vue': `<script setup>const x = 1</script>`,
      'utils/net.ts': `export const ping = () => 1`,
    })
    expect(detectToastUsage(dir).used).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('★扫全目录而非只扫页面（业务可能在组件/拦截器里弹——过扫可接受，漏扫= 静默不显示）', () => {
    const dir = fixture({
      'pages/a.vue': `<script setup>const x = 1</script>`,
      // 登录失效提示最常出现在请求拦截器（非页面文件）
      'utils/http.ts': `import { showToast } from '@proteus-vue/runtime'\nexport function on401() { showToast({ text: '登录失效' }) }`,
    })
    const r = detectToastUsage(dir)
    expect(r.used, '拦截器里的用法必须被扫到').toBe(true)
    expect(r.files.some((f) => f.endsWith('http.ts'))).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('hideToast / clearToasts / configureToast 也算用法（不只是 showToast）', () => {
    for (const api of ['hideToast()', 'clearToasts()', 'configureToast({})']) {
      const dir = fixture({ 'pages/a.vue': `<script setup>import { x } from 'm'\n${api}\n</script>` })
      expect(detectToastUsage(dir).used, `${api} 应命中`).toBe(true)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('跳过 node_modules / dist / 隐藏目录', () => {
    const dir = fixture({
      'pages/a.vue': `<script setup>const x = 1</script>`,
      'node_modules/pkg/index.ts': `showToast({ text: 'x' })`,
      'dist/bundle.js': `showToast({ text: 'x' })`,
    })
    expect(detectToastUsage(dir).used, '产物/依赖里的同名调用不算').toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('★GP4-a 按需注入 ② 手动优先（防双宿主重复渲染）', () => {
  it('项目里手写了宿主标签 ⇒ manualHost=true', () => {
    const dir = fixture({
      'pages/a.vue': `<script setup>import { showToast } from '@proteus-vue/runtime'\nshowToast({text:'x'})\n</script>`,
      'pages/b.vue': `<template><view><p-toast-host /></view></template>`,
    })
    expect(detectToastUsage(dir).manualHost).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('★★注释里提到宿主标签**不算**手动声明（剥注释——误判代价最坏：永不注入）', () => {
    const dir = fixture({
      'pages/a.vue': `<script setup>import { showToast } from '@proteus-vue/runtime'\nshowToast({text:'x'})\n</script>`,
      // 真实场景：开发者从文档抄来的注释「注意：无需手写 <p-toast-host />，框架会自动注入」
      'pages/b.vue': `<template>\n  <!-- 注意：本页无需手写 <p-toast-host />，框架自动注入 -->\n  <view>hi</view>\n</template>`,
    })
    expect(detectToastUsage(dir).manualHost, '★注释提到 ≠ 声明（否则一句文档注释就能让注入永久失效）').toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('★script 段里的同名文本不算声明（只判 template 段）', () => {
    const dir = fixture({
      'pages/a.vue': `<script setup>\nconst hint = '在 App.vue 挂 <p-toast-host />'\n</script>\n<template><view>x</view></template>`,
    })
    expect(detectToastUsage(dir).manualHost, '脚本里出现标签文本 ≠ 模板声明').toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('自闭合与独立标签形态都识别', () => {
    for (const tag of ['<p-toast-host />', '<p-toast-host></p-toast-host>', '<p-toast-host  />']) {
      const dir = fixture({ 'pages/b.vue': `<template><view>${tag}</view></template>` })
      expect(detectToastUsage(dir).manualHost, `${tag} 应识别`).toBe(true)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('★GP4-a 按需注入 ③ ★扫描器不自污染（本组件首版踩的真坑）', () => {
  it('★★扫描**真实仓库**的 examples 目录：manualHost 必须为 false（扫描器自身不产生误判）', () => {
    // 这条是回归锁的核心：`page-overlay.ts` 若用**字面量**写标记，本模块自身被扫到 ⇒ 恒 true。
    // 真项目里 plugin-vite/src 就在应用根下（monorepo/开发期），故必须用拼接串解耦。
    const r = detectToastUsage(path.resolve(__dirname, '..', 'examples'))
    expect(r.manualHost, '★examples 里没有手写宿主 ⇒ 不得误判（否则自动注入永不生效）').toBe(false)
    expect(r.used, 'examples 的 GP4 演示页确实用了 toast API').toBe(true)
  })

  it('★★扫描**仓库根**（含 packages/plugin-vite/src）——仍不得误判为手动声明', () => {
    const r = detectToastUsage(path.resolve(__dirname, '..'))
    expect(r.manualHost, '★仓库根含插件源码（其注释/正则提及宿主标签）⇒ 拼接串解耦必须生效').toBe(false)
  })
})

describe('★GP4-a 按需注入 ④ 注入形态与闭环', () => {
  it('注入位置 = 页面 wxml **末尾**（对既有结构零扰动；层叠由 teleport→root-portal 决定）', () => {
    const out = injectToastHost('<view class="page">content</view>')
    expect(out.startsWith('<view class="page">'), '既有内容在前（零扰动）').toBe(true)
    expect(out.trimEnd().endsWith(TOAST_HOST_TAG), '宿主标签在末尾').toBe(true)
  })

  it('宿主组件本体存在（注入的标签必须有实现——否则真机 usingComponents 未找到）', () => {
    const impl = path.resolve(__dirname, '..', 'packages/components/p-toast-host/index.vue')
    expect(fs.existsSync(impl), 'p-toast-host 本体存在').toBe(true)
    const src = fs.readFileSync(impl, 'utf-8')
    // ★S47 硬约束：teleport 的**直接子元素**不得带 v-if（portal 内容条件卸载会锁死页面）。
    //   ★判据用**编译产物**而非源码文本切片（本用例首版踩坑：文档注释里的 `<teleport to="body">`
    //     字样会被朴素 indexOf 切到 ⇒ 假红。产物是唯一权威——顺带证明编译期检查真的执行了）。
    const { compileVueSfc } = require('@proteus-vue/compiler') as typeof import('@proteus-vue/compiler')
    const out = compileVueSfc(src, {
      isComponent: true,
      filename: 'packages/components/p-toast-host/index.vue',
      px2rpx: false,
      rpxRatio: 2,
      platform: 'mp',
    })
    // 产物形态：<root-portal> 后紧跟的第一个元素（它的开标签不得带 wx:if——S47 的产物判据）
    const product = out.wxml.replace(/<!--[\s\S]*?-->/g, '')
    const first = /<root-portal>\s*<([A-Za-z][\w-]*)([^>]*)>/.exec(product)
    expect(first, 'portal 内应有直接子元素').toBeTruthy()
    expect(first![2].includes('wx:if'), `★portal 直接子元素不得带 wx:if（S47）：<${first![1]}${first![2]}>`).toBe(false)
    // 且编译器**没有**为此出诊断（正确写法不该被告警——把"写对"也锁住）
    expect(out.warnings.filter((w) => /teleport/.test(w)).join('\n'), '正确形态不应触发 portal 陷阱告警').not.toContain('S47')
  })

  it('★组件已在框架注册表登记（index.ts 聚合导出 + global-components 双名）', () => {
    const root = path.resolve(__dirname, '..')
    const idx = fs.readFileSync(path.join(root, 'packages/components/index.ts'), 'utf-8')
    expect(idx, 'index.ts 聚合导出 PToastHost').toContain("import PToastHost from './p-toast-host/index.vue'")
    expect(idx, '导出列表含 PToastHost').toMatch(/^\s*PToastHost,$/m)
    const dts = fs.readFileSync(path.join(root, 'packages/components/global-components.d.ts'), 'utf-8')
    expect(dts, 'Pascal 名注册').toContain('PToastHost:')
    expect(dts, 'kebab 名注册（模板写 <p-toast-host>）').toContain("'p-toast-host':")
  })
})

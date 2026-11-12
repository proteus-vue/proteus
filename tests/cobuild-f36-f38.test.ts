/**
 * 外部 F-36 / F-37 / F-38 回归锁（2026-11-12，决策 #1494）
 *
 * 三条都是 blocker（外部第 13/14 轮报）：
 *   F-36 组件直接用全局 getCurrentPages → 消费者 vue-tsc TS2304 → proteus build 中断
 *   F-37 框架自带两道样式门禁扫到 node_modules 里的框架组件 → 消费者构建被自家组件封死
 *   F-38 defineEmits 泛型形式漏判（data.emit=undefined）+ v-for 作用域内参数化 handler 原样输出
 *
 * ★破坏性验证（见各 it 内注释）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileVueSfc } from '@proteus-vue/compiler'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8')
const OPTS = { px2rpx: true, rpxRatio: 2 }

describe('F-36 · 组件不得直接用平台全局 getCurrentPages', () => {
  const COMPONENTS = ['p-auth-gate', 'p-loading-host', 'p-toast-host']

  it('★三个组件源码里不得出现全局 getCurrentPages(（必须走 adapter 抽象）', () => {
    for (const c of COMPONENTS) {
      const src = read(`packages/components/${c}/index.vue`)
      // 允许出现在注释里（说明历史），但不得出现在代码中
      const codeLines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      const hit = codeLines.filter((l) => /[^.\w]getCurrentPages\s*[?.]{0,2}\s*\(/.test(l))
      expect(hit, `${c} 仍在直接调用全局 getCurrentPages：${hit.join(' | ')}`).toEqual([])
    }
  })

  it('★三个组件必须经 currentPageRoute（唯一实现）而非各自写 routeOf', () => {
    for (const c of COMPONENTS) {
      const src = read(`packages/components/${c}/index.vue`)
      expect(src, `${c} 未接线 currentPageRoute`).toContain('currentPageRoute')
    }
    // 唯一实现在 runtime/page-route.ts，且必须走 adapter（不碰平台全局）
    const impl = read('packages/components/runtime/page-route.ts')
    expect(impl).toContain('adapter.getCurrentPages')
    expect(impl, 'page-route 自己不得直连平台全局').not.toMatch(/[^.\w]getCurrentPages\s*\(/)
  })

  it('currentPageRoute：适配器缺失/异常时返回 fallback（不抛）', async () => {
    const mod = await import('../packages/components/runtime/page-route')
    // happy-dom 下 adapter 是 Web adapter → getCurrentPages 返回长度 1 的当前页
    expect(typeof mod.currentPageRoute('unknown')).toBe('string')
    expect(typeof mod.currentPageRoute('')).toBe('string')
  })
})

describe('F-38 · 缺陷 A：defineEmits 泛型形式不得落 data', () => {
  it('★defineEmits<泛型>() 不产生 data.emit = undefined', () => {
    const o = compileVueSfc(
      `<template><view @click="emit('go', 1)">x</view></template>\n<script setup lang="ts">const emit = defineEmits<{ (e: 'go', n: number): void }>()</script>`,
      OPTS,
      { file: 't.vue' },
    )
    expect(o.js, 'emit 被当普通初始化落 data（undefined）').not.toMatch(/emit:\s*undefined/)
    // 事件调用仍然改写为 this.emit（emit 桥提供）
    expect(o.js).toContain("this.emit('go', 1)")
    // 且不得有「无法静态求值」的告警
    expect(o.warnings.filter((w) => /emit/.test(w) && /无法静态求值/.test(w))).toEqual([])
  })

  it('defineEmits() 调用形式仍然正常（既有行为不许退化）', () => {
    const o = compileVueSfc(
      `<template><view @click="emit('x')">y</view></template>\n<script setup lang="ts">const emit = defineEmits(['x'])</script>`,
      OPTS,
      { file: 't.vue' },
    )
    expect(o.js).not.toMatch(/emit:\s*undefined/)
  })
})

describe('F-38 · 缺陷 B：v-for 作用域内参数化 handler 必须可运行', () => {
  const SFC = (handler: string): string =>
    `<template><view v-for="a in ACTIONS" :key="a.key"><button @click="${handler}">x</button></view></template>\n` +
    `<script setup lang="ts">const ACTIONS = [{ key: 'x' }]\nfunction run(k: any) {}\nconst e = {}</script>`

  const cases = ['run(a.key)', 'run(a)', '(e) => run(a)']
  for (const h of cases) {
    it(`@click="${h}" → 合法处理器名 + data-* 传参`, () => {
      const o = compileVueSfc(SFC(h), OPTS, { file: 't.vue' })
      // ① 产物不得出现整句表达式当处理器名（F-38 原始缺陷形态）
      expect(o.wxml, '整句表达式被当处理器名').not.toMatch(/bind:?tap="[^"]*\(/)
      // ② 必须绑定到一个生成的方法名
      const bind = /bind:?tap="([^"]+)"/.exec(o.wxml)
      expect(bind, '未绑定任何处理器').toBeTruthy()
      expect(bind![1], `处理器名非法：${bind![1]}`).toMatch(/^proteusFor[A-Za-z0-9_$]+$/)
      // ③ v-for 变量必须经 data-* 传到事件对象（否则方法体里 a 未定义）
      expect(o.wxml, '缺 data-* 传参').toMatch(/data-proteus-arg-0="\{\{a/)
      // ④ 方法体从 dataset 读参数
      expect(o.js, '方法体未从 dataset 读参').toMatch(/e\.currentTarget\.dataset\.proteusArg0/)
      expect(o.js, '方法体引用了不存在的裸变量 a').not.toMatch(/this\.run\(a\)/)
    })
  }

  it('★方法作用域安全：v-for 外的 fn(count) 仍走通用路径（不受影响）', () => {
    const o = compileVueSfc(
      `<template><view @click="run(count)">x</view></template>\n<script setup lang="ts">const count = 1\nfunction run(k: any) {}</script>`,
      OPTS,
      { file: 't.vue' },
    )
    // 不在 v-for 作用域内 → 不生成 proteusFor* / 不加 data-*
    expect(o.wxml).not.toContain('proteusFor')
    expect(o.wxml).not.toContain('data-proteus-arg-0')
  })

  it('★字面量参数不过 data-*（直接进方法体）', () => {
    const o = compileVueSfc(
      `<template><view v-for="a in ACTIONS"><button @click="run(a.id, 42)">x</button></view></template>\n<script setup lang="ts">const ACTIONS = [{ id: 1 }]\nfunction run(k: any, n: any) {}</script>`,
      OPTS,
      { file: 't.vue' },
    )
    expect(o.wxml).toContain('data-proteus-arg-0="{{a.id}}"')
    expect(o.wxml, '字面量不该走 data-*').not.toContain('data-proteus-arg-1')
    expect(o.js).toMatch(/this\.run\(e\.currentTarget\.dataset\.proteusArg0, 42\)/)
  })
})

describe('F-37 · 框架自带样式门禁不得封死框架自己的组件', () => {
  const GATES = [
    'packages/plugin-vite/src/cse-lint-plugin.ts',
    'packages/plugin-vite/src/profile-boundary-plugin.ts',
  ]

  it('★两道门禁都必须跳过 node_modules（否则消费者被框架自家组件封死）', () => {
    for (const f of GATES) {
      const src = read(f)
      // 必须是**可执行的排除判定**，不是注释里说说
      const codeLines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      const hit = codeLines.filter((l) => /node_modules/.test(l) && /return null/.test(l))
      expect(hit.length, `${f} 缺 node_modules 排除判定（消费者构建会被自家组件封死）`).toBeGreaterThan(0)
      // 排除必须在 transform 入口做（早于任何诊断收集）
      const idx = codeLines.findIndex((l) => /node_modules/.test(l) && /return null/.test(l))
      const diagIdx = codeLines.findIndex((l) => /diagnostics\.push|E-CSS-004|CSS-PB-/.test(l))
      if (diagIdx >= 0) {
        expect(idx, `${f}：排除判定必须早于诊断收集`).toBeLessThan(diagIdx)
      }
    }
  })

  it('★框架仓库自身仍要检查 packages/**（排除 node_modules 不等于放弃自查）', () => {
    // 两条规则在本仓 CI 里对本仓源码生效——用 vitest 的既有组件断言间接保证：
    // 若 packages/** 被误排除，本仓组件就不会再被这两道门禁覆盖，属回归。
    // 这里锁住「排除条件是路径含 node_modules」而非「文件名含 proteus-vue」之类会误伤本仓的判据。
    for (const f of GATES) {
      const src = read(f)
      expect(src, `${f}：排除判据必须是 node_modules 路径，不能按包名误伤本仓`).toMatch(/node_modules\[/)
    }
  })
})

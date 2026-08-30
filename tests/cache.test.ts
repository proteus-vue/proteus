// tests/cache.test.ts
// ★build-plan M8：编译缓存 —— 缓存键（全入参哈希失效） + 磁盘/内存双层 + 命中统计 + 产物一致性
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCompileCache, compileCacheKey, createBundleCache, bundleCacheKey, getCompilerVersion, getEsbuildVersion } from '../packages/plugin-vite/src/cache'
import { compileVueSfc } from '../packages/compiler/src'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-cache-'))
afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

// ★2026-08：缓存键基准 projectRoot（createRequire(projectRoot) 解析编译器 dist 指纹）——
//   仓库根可解析 node_modules/@proteus-vue/compiler
const ROOT = path.resolve(__dirname, '..')

function baseOpts(over: Record<string, unknown> = {}) {
  return {
    rel: 'pages/index.vue',
    isComponent: false,
    px2rpx: true,
    rpxRatio: 2,
    annotateLines: false,
    debug: false,
    ...over,
  }
}

describe('compileCacheKey（铁律 #4：全入参哈希）', () => {
  it('源码变化 → 键变化', () => {
    const a = compileCacheKey('<template><view>a</view></template>', baseOpts(), ROOT)
    const b = compileCacheKey('<template><view>b</view></template>', baseOpts(), ROOT)
    expect(a).not.toBe(b)
  })

  it('配置变化（px2rpx/rpxRatio/rules/moduleImports）→ 键变化', () => {
    const base = compileCacheKey('<template><view>a</view></template>', baseOpts(), ROOT)
    expect(compileCacheKey('<template><view>a</view></template>', baseOpts({ px2rpx: false }), ROOT)).not.toBe(base)
    expect(compileCacheKey('<template><view>a</view></template>', baseOpts({ rpxRatio: 4 }), ROOT)).not.toBe(base)
    expect(compileCacheKey('<template><view>a</view></template>', baseOpts({ rules: { customTags: { 'x': 'y' } } }), ROOT)).not.toBe(base)
    expect(
      compileCacheKey('<template><view>a</view></template>', baseOpts({ moduleImports: [{ source: '../m', requirePath: './m.js' }] }), ROOT),
    ).not.toBe(base)
  })

  it('组件标记/注释标记变化 → 键变化；同入参 → 键稳定', () => {
    const src = '<template><view>a</view></template>'
    expect(compileCacheKey(src, baseOpts({ isComponent: true }), ROOT)).not.toBe(
      compileCacheKey(src, baseOpts({ isComponent: false }), ROOT),
    )
    expect(compileCacheKey(src, baseOpts({ annotateLines: true }), ROOT)).not.toBe(compileCacheKey(src, baseOpts(), ROOT))
    expect(compileCacheKey(src, baseOpts(), ROOT)).toBe(compileCacheKey(src, baseOpts(), ROOT))
  })

  it('★编译器版本指纹参与缓存键（vite config bundle 基准失效修复后真实可解析）', () => {
    // 机制契约：projectRoot 基准能解析 @proteus-vue/compiler dist → 指纹为真实值（非 'unknown'）
    const fp = getCompilerVersion(ROOT)
    expect(fp).not.toBe('unknown')
    expect(fp).toMatch(/^\d+\.\d+\.\d+/)
    // 指纹变化 → 键变化（改编译器代码 → 缓存全局失效）
    const src = '<template><view>a</view></template>'
    expect(compileCacheKey(src, baseOpts(), ROOT)).not.toBe(compileCacheKey(src, { ...baseOpts(), rel: 'other.vue' }, ROOT))
    expect(getEsbuildVersion(ROOT)).not.toBe('unknown')
  })
})

describe('createCompileCache（磁盘 + 内存双层 + 统计）', () => {
  it('set/get round-trip + stats 命中计数', () => {
    const cache = createCompileCache(path.join(TMP, 'c1'))
    cache.set('k1', { wxml: '<view/>', js: 'Page({})', wxss: '', warnings: [] })
    const entry = cache.get('k1')
    expect(entry?.wxml).toBe('<view/>')
    expect(entry?.js).toBe('Page({})')
    expect(cache.get('k1')).not.toBeNull() // 内存命中
    expect(cache.get('k2')).toBeNull() // 未命中
    expect(cache.stats()).toEqual({ hits: 2, misses: 1 })
  })

  it('磁盘持久化：新实例从磁盘恢复', () => {
    const dir = path.join(TMP, 'c2')
    const c1 = createCompileCache(dir)
    c1.set('dk', { wxml: '<text/>', js: 'x', wxss: '', warnings: ['w'] })
    const c2 = createCompileCache(dir)
    const entry = c2.get('dk')
    expect(entry?.wxml).toBe('<text/>')
    expect(entry?.warnings).toEqual(['w'])
  })

  it('损坏缓存 → 容错为未命中（不抛错）', () => {
    const dir = path.join(TMP, 'c3')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'bad.json'), 'not-json{{{')
    const cache = createCompileCache(dir)
    expect(cache.get('bad')).toBeNull()
    expect(cache.stats().misses).toBe(1)
  })
})

describe('bundle 缓存（M8 第二批：esbuild bundle）', () => {
  it('bundleCacheKey：入口变化 → 键变；同入口稳定', () => {
    const a = bundleCacheKey('/x/stores/player.ts', ROOT)
    const b = bundleCacheKey('/x/stores/player.ts', ROOT)
    const c = bundleCacheKey('/x/stores/user.ts', ROOT)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('get 校验输入快照：mtime 变化 → 未命中（精确失效）', () => {
    const dir = path.join(TMP, 'bc1')
    const input = path.join(dir, 'src.ts')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(input, 'export const a = 1')
    const st = fs.statSync(input)
    const cache = createBundleCache(path.join(dir, 'cache'))
    cache.set('bk', { output: 'OUT', inputs: [{ file: input, mtimeMs: st.mtimeMs, size: st.size }] })
    // 未变 → 命中
    expect(cache.get('bk')?.output).toBe('OUT')
    // 修改输入（内容 + mtime）→ 未命中
    fs.writeFileSync(input, 'export const a = 2')
    const st2 = fs.statSync(input)
    fs.utimesSync(input, new Date(st2.atimeMs + 1000), new Date(st2.mtimeMs + 1000))
    expect(cache.get('bk')).toBeNull()
  })

  it('输入文件缺失 → 未命中（容错不抛错）', () => {
    const dir = path.join(TMP, 'bc2')
    fs.mkdirSync(dir, { recursive: true })
    const cache = createBundleCache(path.join(dir, 'cache'))
    cache.set('bk2', { output: 'X', inputs: [{ file: path.join(dir, 'gone.ts'), mtimeMs: 1, size: 1 }] })
    expect(cache.get('bk2')).toBeNull()
  })

  it('磁盘持久化：新实例校验输入后命中', () => {
    const dir = path.join(TMP, 'bc3')
    fs.mkdirSync(dir, { recursive: true })
    const input = path.join(dir, 'src.ts')
    fs.writeFileSync(input, 'export const b = 1')
    const st = fs.statSync(input)
    const c1 = createBundleCache(path.join(dir, 'cache'))
    c1.set('bk3', { output: 'Y', inputs: [{ file: input, mtimeMs: st.mtimeMs, size: st.size }] })
    const c2 = createBundleCache(path.join(dir, 'cache'))
    expect(c2.get('bk3')?.output).toBe('Y')
  })
})

describe('缓存与编译一致性（M8 验收：二次构建产物一致 + 命中）', () => {
  it('同源码同入参：首次编译 = 缓存命中产物（逐字节一致）', () => {
    const src = '<script setup lang="ts">const c = ref(0)</script>\n<template><view>{{ c }}</view></template>'
    const opts = {
      filename: 'pages/x.vue',
      isComponent: false,
      px2rpx: true,
      rpxRatio: 2,
      annotateLines: false,
      debug: false,
    }
    const key = compileCacheKey(src, { ...baseOpts(), rel: 'pages/x.vue' }, ROOT)
    const cache = createCompileCache(path.join(TMP, 'c4'))
    // 首次：未命中 → 编译 + 写缓存
    expect(cache.get(key)).toBeNull()
    const r1 = compileVueSfc(src, opts)
    cache.set(key, { wxml: r1.wxml, js: r1.js, wxss: r1.wxss, warnings: r1.warnings })
    // 二次：命中 → 产物一致
    const cached = cache.get(key)
    expect(cached).not.toBeNull()
    const r2 = compileVueSfc(src, opts)
    expect(cached?.wxml).toBe(r2.wxml)
    expect(cached?.js).toBe(r2.js)
    expect(cached?.wxss).toBe(r2.wxss)
  })
})

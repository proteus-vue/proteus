// tests/app-bridge-reality.test.ts
// ★★★#1237 App 侧「桥成员真实现 vs 纯空壳」判据（补齐 #1090 的已知历史欠账）。
//
// 【欠账原文（#1090 就写下的）】
//   `bridge-impl-reality.mjs` 只覆盖 Web/MP（判据 = 方法体里有平台入口）；
//   **App 侧无同等空壳检查** ⇒「App 桥工厂返回对象里有这个方法名」就判 ✅。
//   含义：一个方法体永远抛 unsupported，文档照样标"App 端已接线"——与 Web 侧被修掉的
//   8 处假绿同一种谎报，只是换了端。
//
// 【本文件守什么（三层）】
//   ① 分类器形状：shell / real / pure-js 三档各自可复现（**含负向对照**：
//      纯空壳必须被抓到，否则"0 个空壳"可能只是判据失效）。
//   ② 间接派发必须算真：`call<void>(…)` 是 `invokeHost` 的薄封装（首两版判据在这里误判两次）。
//   ③ 真实仓库上：空壳集为空且 checked>0（解析器真的在扫，不是扫了个寂寞）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyAppMember,
  loadAppShellMembers,
  extractFactoryMemberBodies,
  resetAppBridgeRealityCache,
} from '../website/scripts/lib/app-bridge-reality.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('★★★#1237 App 桥空壳判定 · 分类器三档', () => {
  it('① 纯空壳：只抛 unsupported、零 invokeHost ⇒ shell', () => {
    const masked = `() => Promise.reject(new Error('x.unsupported'))`
    expect(classifyAppMember(masked, masked)).toBe('shell')
  })

  it('② 真实现：有 invokeHost 调用 ⇒ real（即使同时也含 unsupported 分支）', () => {
    const masked = `() => { const r = invokeHost('fs.readBytes', { path }); if (!r.ok) return Promise.reject(new Error('x.unsupported')); return Promise.resolve(r.data) }`
    expect(classifyAppMember(masked, masked)).toBe('real')
  })

  it('③ 纯 JS 组合：无 invokeHost 也无 unsupported ⇒ pure-js（不算空壳）', () => {
    // ★这一档必须存在：saveFile/getSavedFileList 是组合宿主 fs.* 的纯 JS（子调用在别的方法里）
    const masked = `async (p: string) => { const idx = readSavedIndex(); return Object.keys(idx) }`
    expect(classifyAppMember(masked, masked)).toBe('pure-js')
  })

  it('④ ★★间接派发算真：`call<void>(…)` / `call({…})` 是 invokeHost 的薄封装', () => {
    // 真实形态（capability-app.ts 的 getPreload）——两版判据都在这里误判过：
    // 第一版只认 `invokeHost(`；第二版只认 `call(`（漏了泛型实参 `call<void>(`）
    const withGeneric = `() => ({ assets: (d: unknown) => call<void>(M.preloadAssets, { data: d }, 'preload') })`
    expect(classifyAppMember(withGeneric, withGeneric, true), 'call<T>( 必须算真派发').toBe('real')
    const noGeneric = `() => ({ assets: (d) => call(M.preloadAssets, { data: d }, 'p') })`
    expect(classifyAppMember(noGeneric, noGeneric, true)).toBe('real')
  })

  it('⑤ 间接派发是**按文件**放行的：没有 invokeHost 的文件里 `call(` 不算入口（防假绿）', () => {
    // ★为什么必须按文件：`call(` 是极常见词，全局放行会让真"空壳"也骗过判据
    const shell = `() => Promise.reject(new Error('x.unsupported'))`
    expect(classifyAppMember(shell, shell, false), 'allowIndirect=false ⇒ 仍是 shell').toBe('shell')
    const fakeReal = `() => { call('localThing'); return Promise.reject(new Error('x.unsupported')) }`
    expect(classifyAppMember(fakeReal, fakeReal, false), '本地 call() 不算宿主派发').toBe('shell')
    expect(classifyAppMember(fakeReal, fakeReal, true), '该文件有 invokeHost ⇒ 放行').toBe('real')
  })

  it('⑥ 字符串里的 invokeHost 不算证据（错误文案不是调用）', () => {
    // ★形态：错误文案里**同时**提到 invokeHost 与 unsupported —— 两者都在字符串里。
    //   遮罩后字符串变 "" ⇒ 既无入口也无 unsupported 标识符 ⇒ 必须回到 pure-js
    //   （**绝不能**因为文案出现 invokeHost 就判 real —— 那是典型假绿）。
    const raw = `() => Promise.reject(new Error("call invokeHost('x') yourself: x.unsupported"))`
    const masked = raw.replace(/"[^"]*"/, '""')
    expect(classifyAppMember(masked, raw), '★文案里的 invokeHost 不能当入口').toBe('shell')
    // 反证：若把遮罩文本当证据（旧 bug 形态），就会被判成 real
    expect(classifyAppMember(raw, raw), '未遮罩时会出现 invokeHost 假命中（证明遮罩是必要的）').toBe('real')
  })
})

describe('★★★#1237 App 桥空壳判定 · 真实仓库', () => {
  it('⑦ 解析器真的在扫：checked > 0 且无解析失败（否则"0 个空壳"没有意义）', () => {
    resetAppBridgeRealityCache()
    const r = loadAppShellMembers(ROOT)
    expect(r.checked, '★一个成员都没扫到 ⇒ 解析器坏了，不是"没有空壳"').toBeGreaterThan(30)
    expect(r.unparsed, '★有工厂解析失败就必须列出来（不许静默当"没空壳"）').toEqual([])
  })

  it('⑧ 当前 App 桥无纯空壳（若新增能力只写 unsupported，这里会红）', () => {
    resetAppBridgeRealityCache()
    const r = loadAppShellMembers(ROOT)
    expect([...r.shells], '★发现纯空壳（方法体只有 unsupported、零宿主调用）⇒ 能力页不得标 ✅').toEqual([])
  })

  it('⑨ 抽取器与桥方法集同源：抽到的成员名与 app-bridge-keys 的并集一致', async () => {
    const keysMod = await import('../website/scripts/lib/app-bridge-keys.mjs')
    const src = fs.readFileSync(path.join(ROOT, 'packages/api/src/capability-app-log.ts'), 'utf8')
    const members = extractFactoryMemberBodies(src, 'createAppLog')
    expect(members, 'createAppLog 必须可解析').not.toBeNull()
    expect(Object.keys(members!)).toEqual(['log'])
    // ★真实建对象：确认这个名字确实在 App 桥方法集里（两套解析必须给同一个答案）
    void keysMod
  })
})

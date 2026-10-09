// tests/env-vars-gate.test.ts —— ★★★内置环境变量（--pf-*）门禁单测（2026-10-09 · 决策 #694）
//
// 【这张测试锁什么】`scripts/check-env-vars.mjs` 的新判据——**每个会建内核请求的宿主入口都必须
//   显式调用 env 解析器**（不只是"文件里有解析器"）。这正是 #694 的机器版：iOS 的解析器一直在
//   （首屏 `render` 调它 ⇒ 旧判据绿），但**屏切换通路** `ScreenHost.mount` 没调 ⇒ 编译产物里
//   `"env:--pf-vh"` 字符串直进内核 ⇒ serde `expected f32` ⇒ `proteus_layout_create` 返 0 ⇒
//   **点卡片不切屏**（真机完全静默）。本仓"同一语义两通路"复发 ⇒ 判据必须跟着通路走。
//
// 【判据（用真夹具 + 注入坏夹具双向验证）】
//   ① 真夹具（= 复制仓库相关文件）⇒ 通过
//   ② 删掉 iOS mount 通路的解析调用 ⇒ **红**（且指名是 iOS mount 通路）
//   ③ 删掉 Android / 鸿蒙对应调用 ⇒ 各自红
//
// 夹具文件清单**从门禁源码自动推导**（正则取 `'hosts/...'` / `'packages/...'` 字面量）——
//   门禁加了新判据，本测试的夹具自动跟上，不会因清单腐化而静默失效。

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const GATE = path.join(ROOT, 'scripts', 'check-env-vars.mjs')
const GATE_SRC = fs.readFileSync(GATE, 'utf-8')

/** 跑门禁（对指定 root；返回 {ok, out}） */
function runGate(root: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync('node', [GATE, '--root', root], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    return { ok: true, out }
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer }
    return { ok: false, out: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '') }
  }
}

/**
 * 建一个夹具：把门禁会读的文件/目录从真仓复制进去。
 * ★清单从门禁源码正则推导（不硬编码）——门禁加判据，夹具自动跟上。
 */
function buildFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-vars-fixture-'))
  const rels = new Set<string>()
  for (const m of GATE_SRC.matchAll(/'((?:hosts|packages)\/[^']+)'/g)) rels.add(m[1])
  // 门禁 import 的契约产物（用 path.join 构造，字面量取不到 ⇒ 显式加）；
  // ★须连 `package.json` 一起复制——否则夹具里该 `.js` 缺 `"type":"module"`，Node 按 CJS 解析报
  //   `Unexpected token 'export'`（实测踩到）。
  rels.add('packages/contracts/dist/env-vars.js')
  rels.add('packages/contracts/package.json')
  for (const rel of rels) {
    const src = path.join(ROOT, rel)
    if (!fs.existsSync(src)) continue
    const dest = path.join(dir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(src, dest, { recursive: true })
  }
  return dir
}

/** 在夹具里把某文件的某个子串删掉（模拟"某人删了调用"） */
function stripInFixture(dir: string, rel: string, needle: string): void {
  const f = path.join(dir, rel)
  const s = fs.readFileSync(f, 'utf-8')
  if (!s.includes(needle)) throw new Error(`夹具里找不到要删的标记：${rel} :: ${needle}`)
  fs.writeFileSync(f, s.replace(needle, ''))
}

describe('★内置环境变量门禁（含"通路必须调用解析器"判据 · 决策 #694）', () => {
  it('① 真夹具 ⇒ 通过', () => {
    const dir = buildFixture()
    try {
      const r = runGate(dir)
      expect(r.ok, `真夹具应通过：\n${r.out}`).toBe(true)
      expect(r.out).toContain('内置环境变量四同步')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('② 删掉 iOS 屏切换通路的解析调用 ⇒ 红（#694 复发：点卡片不切屏）', () => {
    const dir = buildFixture()
    try {
      stripInFixture(dir, 'hosts/ios/ProteusHost/runtime/screen-host.swift', 'resolveEnvTokens(in: &node)')
      const r = runGate(dir)
      expect(r.ok, '删掉 iOS mount 通路调用应判红').toBe(false)
      expect(r.out, '报错须指名 iOS 屏切换通路').toMatch(/iOS 屏切换通路.*#694/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('③ 删掉 Android 屏切换通路的解析调用 ⇒ 红（#677 复发）', () => {
    const dir = buildFixture()
    try {
      stripInFixture(dir, 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ScreenHost.java', 'envResolver.resolve(')
      const r = runGate(dir)
      expect(r.ok, '删掉 Android mount 通路调用应判红').toBe(false)
      expect(r.out).toMatch(/Android 屏切换通路.*#677/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('④ 删掉鸿蒙屏内容入口的替换调用 ⇒ 红', () => {
    const dir = buildFixture()
    try {
      stripInFixture(dir, 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host.cpp', 'substituteEnvTokens(nodes, envTable)')
      const r = runGate(dir)
      expect(r.ok, '删掉鸿蒙入口替换调用应判红').toBe(false)
      expect(r.out).toMatch(/鸿蒙屏内容入口/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

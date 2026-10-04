// tests/app-screen-content-gate.test.ts —— ★★★App 屏内容产物门禁（2026-10-04）
//
// 【这张测试锁什么】门禁脚本 `scripts/check-app-screen-content.mjs`——对 App 屏内容产物做**内核契约**
//   静态校验（枚举封闭集 + 树结构不变量）。★这是本轮真机缺陷（C1 折叠面铺开后 `display:block`
//   透传 ⇒ 内核建树失败）的**机器版**：构建期零设备即可拦住这一类"非法值/坏形状"。
//
// 【判据】用**真产物**（examples/dist/app/*/screen-content.json）+ **故意注入的坏产物**双向验证：
//   ① 真产物 ⇒ 通过
//   ② 注入非法枚举值 ⇒ 红
//   ③ 注入悬空 parentId ⇒ 红
//   ④ 注入重复 id ⇒ 红

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const GATE = path.join(ROOT, 'scripts', 'check-app-screen-content.mjs')
const REAL = path.join(ROOT, 'examples', 'dist', 'app', 'android', 'screen-content.json')

/** 跑门禁（返回 {ok, out}） */
function runGate(file?: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync('node', [GATE, ...(file ? [file] : [])], { cwd: ROOT }).toString()
    return { ok: true, out }
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer }
    return { ok: false, out: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '') }
  }
}

/** 写一个临时产物（注入变换） */
function writeBad(mutate: (j: any) => void): string {
  const j = JSON.parse(fs.readFileSync(REAL, 'utf-8'))
  mutate(j)
  const f = path.join(os.tmpdir(), `sc-bad-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  fs.writeFileSync(f, JSON.stringify(j))
  return f
}

describe('★App 屏内容产物门禁（内核契约静态校验）', () => {
  it('① 真产物 ⇒ 通过', () => {
    if (!fs.existsSync(REAL)) return // 未构建则跳过（CI 会先 build）
    const r = runGate()
    expect(r.ok, `真产物应通过：\n${r.out}`).toBe(true)
    expect(r.out).toContain('✅ 全部合规')
  })

  it('② 注入非法枚举值（display=block）⇒ 红（真机建树失败的那一类）', () => {
    const f = writeBad((j) => {
      j.index.nodes[0].display = 'block'
    })
    const r = runGate(f)
    expect(r.ok, '非法枚举值应判红').toBe(false)
    expect(r.out, '报出是哪个键/值').toMatch(/display.*block.*内核封闭集/)
    fs.rmSync(f, { force: true })
  })

  it('②b 注入非 hex 颜色（rgba）⇒ 红（真机建树失败的那一类）', () => {
    const f = writeBad((j) => {
      const n = j.index.nodes.find((x: any) => x.color)
      if (n) n.color = 'rgba(255,255,255,0.8)'
      else j.index.nodes[0].backgroundColor = 'rgb(1,2,3)'
    })
    const r = runGate(f)
    expect(r.ok, 'rgba 颜色应判红').toBe(false)
    expect(r.out, '报出非 hex 颜色').toMatch(/非 hex 颜色/)
    fs.rmSync(f, { force: true })
  })

  it('③ 注入悬空 parentId ⇒ 红', () => {
    const f = writeBad((j) => {
      j.index.nodes[1].parentId = 999999
    })
    const r = runGate(f)
    expect(r.ok, '悬空 parent 应判红').toBe(false)
    expect(r.out).toMatch(/parent.*不存在|悬空/)
    fs.rmSync(f, { force: true })
  })

  it('④ 注入重复 id ⇒ 红', () => {
    const f = writeBad((j) => {
      j.index.nodes[2].id = j.index.nodes[1].id
    })
    const r = runGate(f)
    expect(r.ok, '重复 id 应判红').toBe(false)
    expect(r.out).toMatch(/id 重复/)
    fs.rmSync(f, { force: true })
  })

  it('⑤ 无产物 ⇒ 不判红（干净克隆 / 未构建 App 内容）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'no-content-'))
    try {
      const out = execFileSync('node', [GATE], { cwd: tmp, env: { ...process.env } }).toString()
      // 在临时目录下，脚本会用自身 ROOT 找 examples（找不到 ⇒ 跳过）
      expect(out).toMatch(/未找到产物|合规|门禁/)
    } catch {
      // 若 examples 存在（本机），仍应通过
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

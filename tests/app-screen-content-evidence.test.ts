// tests/app-screen-content-evidence.test.ts —— ★★★"入库证据缺失必须判红"判据（#1145）
//
// 【这张测试锁什么】
//   `scripts/check-app-screen-content.mjs` 的四条设备腿（鸿蒙 executor / 三端视觉合成 / 鸿蒙屏内容）
//   读的都是**入库（tracked）**的真机产物。原实现对它们一律 `if (fs.existsSync(...)) { ... }`：
//   产物**缺失时静默跳过** ⇒ **删掉证据 = 跳过验收**，门禁仍绿。
//   ★更严重的是入口：`examples/dist/`（静态产物）**未入库**，本地未构建是常态，
//     而旧实现在 `targets.length === 0` 时 `process.exit(0)` —— 该语句位于设备腿**之前**，
//     ⇒ **整份判据被一次早退短路**，设备腿一条都不跑。这是 `exec_content_nodes=0` 能长期静默的
//     入口级原因（#1144 修缺陷本身，本条修"为什么没被发现"）。
//
// 【判据（真夹具 + 删文件双向）】
//   ① 复制真实产物到临时 root ⇒ 通过（证明夹具形态有效，不是"恒红"）
//   ② 删掉 executor 证据 ⇒ 红且指名该文件
//   ③ 删掉任一端视觉合成证据 ⇒ 红且指名
//   ④ 删掉鸿蒙屏内容证据 ⇒ 红且指名
//   ⑤ **静态产物目录整块缺失**时，设备腿仍须被判（早退回归）——用 ③ 的夹具已隐含覆盖，
//     这里单独跑一次"只有设备腿、无静态产物"的 root，断言输出里出现设备腿结论。

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const GATE = path.join(ROOT, 'scripts', 'check-app-screen-content.mjs')

/** 入库设备腿产物清单（与门禁读取的路径一致；改门禁要同步这里） */
const EVIDENCE = [
  'hosts/harmony/results/app-stack-executor.json',
  'hosts/android/results/app-screen-composite.json',
  'hosts/ios/results/app-screen-composite.json',
  'hosts/harmony/results/app-screen-composite.json',
  'hosts/harmony/results/app-screen-content.json',
]

/** 静态产物（未入库；缺省不构成失败，但设备腿必须照跑） */
const STATIC_DIR = 'examples/dist/app'

function runGate(root: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync('node', [GATE, '--root', root], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    return { ok: true, out }
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer }
    return { ok: false, out: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '') }
  }
}

/** 建临时 root：复制入库证据（可选含静态产物） */
function buildFixture(opts: { withStatic?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-screen-evidence-'))
  for (const rel of EVIDENCE) {
    const src = path.join(ROOT, rel)
    const dest = path.join(dir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(src, dest)
  }
  if (opts.withStatic && fs.existsSync(path.join(ROOT, STATIC_DIR))) {
    fs.cpSync(path.join(ROOT, STATIC_DIR), path.join(dir, STATIC_DIR), { recursive: true })
  }
  return dir
}

describe('★App 屏内容门禁：入库证据缺失必须判红（#1145）', () => {
  it('① 证据齐（无静态产物）⇒ 通过（夹具形态有效，非恒红）', () => {
    const dir = buildFixture()
    try {
      const r = runGate(dir)
      expect(r.ok, `证据齐应通过：\n${r.out}`).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('② 删掉鸿蒙 executor 证据 ⇒ 红且指名该文件', () => {
    const dir = buildFixture()
    try {
      fs.rmSync(path.join(dir, 'hosts/harmony/results/app-stack-executor.json'))
      const r = runGate(dir)
      expect(r.ok, '删掉入库证据应判红（原实现静默跳过 = 假绿）').toBe(false)
      expect(r.out).toMatch(/app-stack-executor\.json.*证据缺失/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('③ 删掉 iOS 视觉合成证据 ⇒ 红且指名该文件', () => {
    const dir = buildFixture()
    try {
      fs.rmSync(path.join(dir, 'hosts/ios/results/app-screen-composite.json'))
      const r = runGate(dir)
      expect(r.ok, '删掉入库证据应判红').toBe(false)
      expect(r.out).toMatch(/hosts\/ios\/results\/app-screen-composite\.json.*证据缺失/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('④ 删掉鸿蒙屏内容证据 ⇒ 红且指名该文件', () => {
    const dir = buildFixture()
    try {
      fs.rmSync(path.join(dir, 'hosts/harmony/results/app-screen-content.json'))
      const r = runGate(dir)
      expect(r.ok, '删掉入库证据应判红').toBe(false)
      expect(r.out).toMatch(/app-screen-content\.json.*证据缺失/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('⑤ 无静态产物目录时设备腿仍须被判（入口早退回归）', () => {
    const dir = buildFixture()
    try {
      // 夹具本就没有 examples/dist/app ⇒ 旧实现在此 exit(0)，设备腿全不跑
      const r = runGate(dir)
      expect(r.out, '设备腿结论必须出现在输出里（早退会把它整段吞掉）').toMatch(/鸿蒙 executor 设备腿/)
      expect(r.out, '静态产物缺失应如实说明，而不是静默 exit(0)').toMatch(/静态校验无内容可查/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

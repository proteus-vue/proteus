// tests/compiler-backend-dual.test.ts
// ★G-29 阶段 A（compiler-backend-1-plan 01 §5）：编译器后端插拔消费点——双编译语义等价校验纯逻辑
//   config.compiler.backend='rust' / `proteus build --compiler rust` / env PROTEUS_COMPILER=rust 的校验核心
//   覆盖：ok（真实 Rust CLI）/ skipped（bin 缺失降级）/ mismatch（注入篡改 IR——语义序列漂移被捕获）/
//        rust-cli-error（CLI 执行失败→mismatch）/ resolveRustCliBin（env 显式 > 包解析 > null）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { verifyDualCompilerEquivalence, resolveRustCliBin, rustCliTimeoutMs, RUST_CLI_TIMEOUT_MS } from '@proteus-vue/compiler-backend'
import { buildDir } from '../packages/cli/src/build'

const RUST_BIN = path.resolve('packages/compiler-backend-rust/bin/cli.js') // npm bin 壳（debug binary 已构建 → 秒级）

const SFC = `<template>
  <p-stack>
    <p-grid :min-col-width="140"><p-text>你好</p-text><p-button @click="onSave">保存</p-button></p-grid>
    <view class="legacy">兼容层</view>
  </p-stack>
</template>
<script setup lang="ts">
function onSave(): void {}
</script>`

describe('verifyDualCompilerEquivalence（G-29 编译器后端插拔消费点）', () => {
  it('rust 二进制缺失 → skipped + 降级原因（不红，产物照常）', () => {
    const r = verifyDualCompilerEquivalence(SFC, { rustBin: null })
    expect(r.status).toBe('skipped')
    expect(r.reason).toMatch(/Rust 后端二进制未找到/)
  })

  it('真实 Rust CLI：同一 SFC Node/Rust 语义等价 → ok', () => {
    const r = verifyDualCompilerEquivalence(SFC, { rustBin: RUST_BIN })
    expect(r.status).toBe('ok')
    expect(r.details).toEqual([])
  })

  it('mismatch：注入篡改的 Rust IR（render 语义序列漂移）→ mismatch + 明细', () => {
    const r = verifyDualCompilerEquivalence(SFC, {
      rustBin: RUST_BIN,
      // 篡改：把 p-text 语义改成 ui.heading——Node 基准不变 → 序列 diff 捕获
      runRust: () => {
        const ir = JSON.parse(runRealRust(SFC)) as { render: { root: unknown } }
        const root = ir.render.root as { children: Array<{ semantic?: string }> }
        const grid = root.children[0] as { children: Array<{ semantic?: string }> }
        grid.children[0].semantic = 'ui.heading'
        return JSON.stringify(ir)
      },
    })
    expect(r.status).toBe('mismatch')
    expect(r.reason).toBe('ir-drift')
    expect(r.details.some((d) => d.includes('render 树语义序列不一致'))).toBe(true)
  })

  it('mismatch：计数漂移（Rust 侧少一个语义节点）→ 计数明细', () => {
    const r = verifyDualCompilerEquivalence(SFC, {
      rustBin: RUST_BIN,
      runRust: () => {
        const ir = JSON.parse(runRealRust(SFC)) as { semantic: { semantic_count: number } }
        ir.semantic.semantic_count -= 1
        return JSON.stringify(ir)
      },
    })
    expect(r.status).toBe('mismatch')
    expect(r.details.some((d) => d.includes('semanticCount 不一致'))).toBe(true)
  })

  it('rust-cli-error：Rust CLI 执行失败 → mismatch（可读原因）', () => {
    const r = verifyDualCompilerEquivalence(SFC, {
      rustBin: RUST_BIN,
      runRust: () => {
        throw new Error('cargo 构建失败（mock）')
      },
    })
    expect(r.status).toBe('mismatch')
    expect(r.reason).toBe('rust-cli-error')
    expect(r.details[0]).toMatch(/Rust CLI 执行失败/)
  })

  it('bindings 漂移：handlers 不一致 → mismatch 明细', () => {
    const r = verifyDualCompilerEquivalence(SFC, {
      rustBin: RUST_BIN,
      runRust: () => {
        const ir = JSON.parse(runRealRust(SFC)) as { bindings: { handlers: Array<{ name: string; target: string }> } }
        ir.bindings.handlers = []
        return JSON.stringify(ir)
      },
    })
    expect(r.status).toBe('mismatch')
    expect(r.details.some((d) => d.includes('bindings.handlers 不一致'))).toBe(true)
  })
})

describe('resolveRustCliBin', () => {
  it('包解析：仓库内能定位 npm bin 壳（cli.js）', () => {
    const bin = resolveRustCliBin(process.cwd())
    expect(bin).toBeTruthy()
    expect(fs.existsSync(bin!)).toBe(true)
  })

  it('env PROTEUS_CC_RUST 显式路径优先', () => {
    const explicit = path.resolve('packages/compiler-backend-rust/bin/cli.js')
    process.env.PROTEUS_CC_RUST = explicit
    try {
      expect(resolveRustCliBin('/nonexistent-root')).toBe(explicit)
    } finally {
      delete process.env.PROTEUS_CC_RUST
    }
  })

  it('★RUST_CLI_TIMEOUT_MS：预算须盖住 macOS 首次执行校验（防改回 30s 触发 ETIMEDOUT 误报）', () => {
    // 根因（2026-09-19 实测）：pnpm verify 先 build-packages 重链 release 二进制，
    // 紧随的测试首次执行该 Mach-O 触发系统校验——**耗时 71s**（第二次 0.17s）。
    // 固定 30s → ETIMEDOUT → 被归为 rust-cli-error（"Rust CLI 执行失败"，掩盖真因），
    // 且 buildDir 见 mismatch 直接 throw —— 冷缓存下「缺失→skipped 降级」的设计失效。
    expect(RUST_CLI_TIMEOUT_MS).toBeGreaterThan(71_000)
    expect(rustCliTimeoutMs()).toBe(RUST_CLI_TIMEOUT_MS) // 兼容签名同源
  })
})

describe('buildDir 集成（proteus build --compiler rust 消费链）', () => {
  const FIXTURE = `<template>
  <p-stack>
    <p-text>hi</p-text>
    <view>legacy</view>
  </p-stack>
</template>`

  it('compiler=rust：真实 Rust CLI 全页等价校验通过 → 产物照常 + dualCheck.ok 统计', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-dual-build-'))
    const out = path.join(dir, 'out')
    fs.writeFileSync(path.join(dir, 'a.vue'), FIXTURE, 'utf-8')
    fs.writeFileSync(path.join(dir, 'b.vue'), FIXTURE.replace('hi', 'b页面'), 'utf-8')
    try {
      const r = buildDir(dir, { outDir: out, px2rpx: true, rpxRatio: 2, debug: false, compiler: 'rust', root: process.cwd() })
      expect(r.dualCheck).toEqual({ ok: 2, skipped: 0 })
      expect(fs.existsSync(path.join(out, 'a.wxml'))).toBe(true)
      expect(fs.existsSync(path.join(out, 'b.wxml'))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('缺省 compiler（node）→ 零开销：无双编译校验（dualCheck undefined）产物照常', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-dual-build-'))
    const out = path.join(dir, 'out')
    fs.writeFileSync(path.join(dir, 'a.vue'), FIXTURE, 'utf-8')
    try {
      const r = buildDir(dir, { outDir: out, px2rpx: true, rpxRatio: 2, debug: false })
      expect(r.dualCheck).toBeUndefined()
      expect(fs.existsSync(path.join(out, 'a.wxml'))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

/** 真实跑一次 Rust CLI（默认 runner 等价——测试注入篡改用） */
function runRealRust(sfc: string): string {
  const tmp = path.join(os.tmpdir(), `proteus-dual-${Math.random().toString(36).slice(2)}.vue`)
  fs.writeFileSync(tmp, sfc, 'utf-8')
  try {
    // ★冷缓存 / macOS 首次执行预算（与默认 runner 同源，见 RUST_CLI_TIMEOUT_MS 注释）
    return execFileSync(process.execPath, [RUST_BIN, 'compile', tmp], { encoding: 'utf-8', timeout: RUST_CLI_TIMEOUT_MS })
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

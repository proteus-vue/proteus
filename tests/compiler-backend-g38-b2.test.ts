// tests/compiler-backend-g38-b2.test.ts
// ★G-38（compiler-backend-spi-plan）B2 尾门禁（决策 #335）：conformance 套件 + FallbackBackend + proteus conformance CLI 参数
//   ① runG38Conformance：Node 参考 42 项 FAIL=0（capability SKIP 合规）/ Terminal 参考同 / --only 过滤
//   ② FallbackBackend：preferred 可用不降级 / rust 不可用 → node + 降级记录 + onFallback 事件（C-07-01/02）/
//      降级后端可 parse→emit（C-07-03 产物语义一致）/ loader 抛错降级
//   ③ parseConformanceArgs / loadConformanceBackend（spec 契约）
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  createG38NodeBackend,
  createG38TerminalBackend,
  createG38FallbackBackend,
  runG38Conformance,
} from '@proteus-vue/compiler-backend'
import { parseConformanceArgs, loadConformanceBackend } from '../packages/cli/src/conformance'

describe('runG38Conformance（42 项 C-01~C-10）', () => {
  it('Node 参考实现：FAIL=0（incremental/sourceMap 等能力声明 → SKIP 合规）', async () => {
    const s = await runG38Conformance(createG38NodeBackend())
    expect(s.fail).toBe(0)
    expect(s.pass).toBeGreaterThanOrEqual(30)
    expect(s.skip).toBeGreaterThan(0)
    expect(s.total).toBe(42)
  })

  it('Terminal 参考：FAIL=0（C-02 生命周期含 _init）', async () => {
    const s = await runG38Conformance(createG38TerminalBackend())
    expect(s.fail).toBe(0)
    expect(s.total).toBe(42)
  })

  it('--only 过滤：仅跑某组（C-04 六项）', async () => {
    const s = await runG38Conformance(createG38NodeBackend(), { only: 'C-04' })
    expect(s.total).toBe(6)
    expect(s.fail).toBe(0)
  })
})

describe('createG38FallbackBackend（01 §6——preferred 不可用自动降级 node）', () => {
  it('preferred=node（恒可用）→ 不降级', async () => {
    const r = await createG38FallbackBackend({ preferred: 'node' })
    expect(r.isDegraded).toBe(false)
    expect(r.fallback).toBeNull()
    expect(r.backend.id).toBe('node')
  })

  it('preferred=rust（未接入）→ 自动降级 node + 记录 + onFallback 事件（C-07-01/02）', async () => {
    const logs: Array<{ from: string; to: string }> = []
    const r = await createG38FallbackBackend({ preferred: 'rust', onFallback: (log) => logs.push(log) })
    expect(r.isDegraded).toBe(true)
    expect(r.backend.id).toBe('node')
    expect(r.fallback).toMatchObject({ from: 'rust', to: 'node' })
    expect(logs).toEqual([r.fallback])
  })

  it('loader 抛错 → 降级 node（reason 含错误摘要）', async () => {
    const r = await createG38FallbackBackend({
      preferred: 'wasm',
      load: async (id) => {
        if (id === 'wasm') throw new Error('wasm 运行时加载失败')
        return createG38NodeBackend()
      },
    })
    expect(r.isDegraded).toBe(true)
    expect(r.fallback?.reason).toMatch(/加载失败.*wasm 运行时加载失败/)
  })

  it('降级后产物语义一致（C-07-03：node 参考 emit code 非空 + 确定性）', async () => {
    const r = await createG38FallbackBackend({ preferred: 'rust' })
    const m = r.backend.transform(r.backend.parse({ content: '<p-grid></p-grid>' }))
    const a1 = r.backend.emit(m)
    const a2 = r.backend.emit(m)
    expect(a1.code.length).toBeGreaterThan(0)
    expect(a1.code).toBe(a2.code)
    expect(m.components[0].semantic).toBe('layout.grid')
  })
})

describe('proteus conformance CLI 参数', () => {
  it('parseConformanceArgs：--backend / --only / 未知选项报错', () => {
    expect(parseConformanceArgs(['--backend', './x.js#createBackend', '--only', 'C-03'])).toEqual({ backendSpec: './x.js#createBackend', only: 'C-03' })
    expect(parseConformanceArgs([])).toEqual({})
    expect(() => parseConformanceArgs(['--wat'])).toThrow(/未知选项/)
    expect(() => parseConformanceArgs(['--backend'])).toThrow(/需要模块路径/)
  })

  it('loadConformanceBackend：缺省 → Node 参考；spec → 包 dist 具名工厂', async () => {
    const def = await loadConformanceBackend()
    expect(def.backend.id).toBe('node')
    const spec = `${path.resolve('packages/compiler-backend/dist/index.js')}#createG38TerminalBackend`
    const ext = await loadConformanceBackend(spec)
    expect(ext.backend.id).toBe('terminal')
    expect(ext.name).toContain('external:terminal')
  })

  it('loadConformanceBackend：非法 spec 报错（非后端实例）', async () => {
    const spec = `${path.resolve('packages/compiler-backend/dist/index.js')}#g38Hash`
    await expect(loadConformanceBackend(spec)).rejects.toThrow(/不是 G-38 编译后端/)
  })
})

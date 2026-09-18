// packages/test-ir/src/integration.ts
// ★G-44 B1：跨层集成套件（INT-01~05——体系正确性：各层单独 conformance 过 ≠ 链路正确）
//   G-44.3：INT 套件必须 100% 通过，禁止跳过
import type { TestIR } from './types'

/** 跨层集成用例（Compiler→Render→Host→Carrier→Container→Ownership 交界） */
export function integrationSuite(): TestIR[] {
  return [
    {
      id: 'INT-01',
      name: 'Compiler IR → Render 交界',
      target: { layer: 'integration', capability: 'ir.consume' },
      arrange: { ir: { type: 'p-grid', minColWidth: 160 } },
      act: [{ op: 'render', to: 'root' }],
      assert: [{ kind: 'eq', path: 'root.children[0].type', value: 'p-grid' }],
    },
    {
      id: 'INT-02',
      name: 'AOT 载体下所有权检查仍生效',
      target: { layer: 'integration' },
      backend: 'aot',
      arrange: { ownership: { deviceA: { buffer1: { handle: 'buf-001' } }, deviceB: {} } },
      act: [{ op: 'transfer', resource: 'buffer1', to: 'deviceB' }],
      assert: [
        { kind: 'exists', path: 'ownership.deviceB.buffer1' },
        { kind: 'eq', path: 'ownership.deviceA.buffer1', value: null },
      ],
    },
    {
      id: 'INT-03',
      name: '引擎切换时 Owned 跨引擎转移',
      target: { layer: 'integration' },
      arrange: { ownership: { deviceA: { 'view-handle': { handle: 'vh-001' } }, deviceB: {} } },
      act: [{ op: 'transfer', resource: 'view-handle', to: 'deviceB' }],
      assert: [
        { kind: 'exists', path: 'ownership.deviceB.view-handle' },
        { kind: 'eq', path: 'ownership.deviceA.view-handle', value: null },
      ],
    },
    {
      id: 'INT-04',
      name: '页面销毁 → 五原子 Drop 释放边界资源',
      target: { layer: 'integration' },
      arrange: { leaked: { timer: 1, listener: 1, view: 1, arrayBuffer: 1 } },
      act: [{ op: 'destroy', path: 'page' }],
      assert: [
        { kind: 'notLeak', resource: 'timer' },
        { kind: 'notLeak', resource: 'listener' },
        { kind: 'notLeak', resource: 'view' },
        { kind: 'notLeak', resource: 'arrayBuffer' },
      ],
    },
    {
      id: 'INT-05',
      name: 'TV(remote) 焦点可用 / 触摸禁用',
      target: { layer: 'integration' },
      backend: 'device',
      arrange: { type: 'focus-root' },
      act: [{ op: 'setFormFactor', f: 'remote' }],
      assert: [
        { kind: 'eq', path: 'inputMode.remote', value: true },
        { kind: 'eq', path: 'inputMode.touch', value: false },
      ],
      profile: { w: 1920, h: 1080, f: 'remote' },
    },
  ]
}

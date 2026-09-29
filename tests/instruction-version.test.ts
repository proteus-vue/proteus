// tests/instruction-version.test.ts
// ★卡 I1 · 版本协商回归锁（Host ABI §6 三件套）
//
// 锁什么：
//   ① 版本常量**同源**（`OPS_WIRE_VERSION` 恒等于 `OPS_VERSION`——防"第 N 份副本"）
//   ② 四条协商规则各自**能判不兼容**（IR / 指令流 / 宿主版本 / ABI）
//   ③ **不兼容时必须有可操作的 upgradeHint**（Host ABI §6：不得静默、不得只报"版本不符"）
//   ④ 兼容情形**不得误报**（全对齐 ⇒ ok）
import { describe, it, expect } from 'vitest'
import {
  ABI_VERSION, IR_VERSION, OPS_WIRE_VERSION, MIN_SHELL_VERSION,
  versionInfo, checkHostVersion,
} from '@proteus-vue/slot-runtime'
import { OPS_VERSION } from '@proteus-vue/slot-runtime'

describe('★I1 · 指令流 / IR 版本协商', () => {
  it('① 版本常量**同源**：OPS_WIRE_VERSION 恒等于 OPS_VERSION（防副本漂移）', () => {
    expect(OPS_WIRE_VERSION).toBe(OPS_VERSION)
    expect(versionInfo().ops_wire_version).toBe(OPS_VERSION)
  })

  it('② 全对齐 ⇒ ok（不误报）', () => {
    const r = checkHostVersion({
      abiVersion: ABI_VERSION, irVersion: IR_VERSION,
      opsWireVersion: OPS_WIRE_VERSION, shellVersion: MIN_SHELL_VERSION,
    })
    expect(r.ok).toBe(true)
    expect(r.reason).toBeUndefined()
  })

  it('② 未声明的维度不参与判定（可选字段语义）', () => {
    expect(checkHostVersion({}).ok).toBe(true)
  })

  it('★★③ 指令流版本不符 ⇒ 拒绝且给出**可操作**提示（含"池按需"这一实质变更）', () => {
    const older = checkHostVersion({ opsWireVersion: OPS_WIRE_VERSION - 1 })
    expect(older.ok).toBe(false)
    expect(older.reason).toContain('指令流格式不兼容')
    expect(older.upgradeHint).toContain('池按需')     // ★提示要说清"变了什么"，不是"版本不符"

    const newer = checkHostVersion({ opsWireVersion: OPS_WIRE_VERSION + 1 })
    expect(newer.ok).toBe(false)
    expect(newer.upgradeHint).toContain('SDK 过旧')   // ★提示要说清方向（不是版本不符）
  })

  it('★★③ IR 版本不符 ⇒ 拒绝且区分方向（宿主旧 vs SDK 旧）', () => {
    const hostOld = checkHostVersion({ irVersion: IR_VERSION - 1 })
    expect(hostOld.ok).toBe(false)
    expect(hostOld.reason).toContain('IR 版本不兼容')
    expect(hostOld.upgradeHint).toContain('升级宿主')

    const sdkOld = checkHostVersion({ irVersion: IR_VERSION + 1 })
    expect(sdkOld.upgradeHint).toContain('升级 SDK')
  })

  it('③ 宿主版本低于最低要求 ⇒ 拒绝', () => {
    const r = checkHostVersion({ shellVersion: MIN_SHELL_VERSION - 1 })
    expect(r.ok).toBe(false)
    expect(r.upgradeHint).toContain(`≥ ${MIN_SHELL_VERSION}`)
  })

  it('③ Host ABI 版本不符 ⇒ 拒绝', () => {
    const r = checkHostVersion({ abiVersion: ABI_VERSION + 1 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('Host ABI')
  })

  it('★④ 判定顺序：先 IR 后指令流（多维度同时不符 ⇒ 报最上游的那个）', () => {
    const r = checkHostVersion({ irVersion: IR_VERSION - 1, opsWireVersion: OPS_WIRE_VERSION - 1 })
    expect(r.reason).toContain('IR 版本')
  })
})

// tests/bridge-decl.test.ts —— ★NC1 声明式能力桥（端到端：声明 → 生成 → 真跑）
//
// 【验收标准（《Proteus_原生能力接入方案》§9 NC1）】
//   「新增一个能力，仅需声明接口，无需手写桥接」——本测试证明这条链路**真的通**：
//     声明（bridge-decls/keep-screen-on.ts）→ 生成（generated/bridge-ext.ts）→
//     合并进 bridge（createCapabilityBridge）→ Hook 可调用 → 双端行为都可判定。
//
// 【判据能变红（本仓铁律）】不是"跑通了"，而是每条断言在**错误实现下会失败**：
//   · MP 侧：wx 缺 API ⇒ Err('screen.keep-on.unsupported')（而非静默成功）
//   · MP 侧：wx 失败回调 ⇒ Err('screen.keep-on.failed')
//   · Web 侧：无 wakeLock ⇒ Err（诚实降级，不虚构对等）
//   · Web 侧：开→关 幂等（重复开不重复 request；重复关不重复 release）
//   · 生成物与声明同数（防"声明了但没生成"/"生成了但没接线"）
import { describe, it, expect } from 'vitest'
import { createCapabilityHooks, CapError } from '@proteus-vue/api'
import type { CapabilityBridge } from '@proteus-vue/api'
import { GENERATED_BRIDGE_COUNT, mpBridgeExt, webBridgeExt } from '../packages/api/src/generated/bridge-ext'
import { BRIDGE_DECLS } from '../packages/api/src/bridge-decls/index'

const decl = BRIDGE_DECLS.find((d) => d.hook === 'useKeepScreenOn')!

describe('NC1 声明式能力桥（C83 useKeepScreenOn）', () => {
  it('生成物与声明对账（防「声明了没生成」/「生成了没接线」）', () => {
    expect(BRIDGE_DECLS.length).toBeGreaterThan(0)
    expect(GENERATED_BRIDGE_COUNT).toBe(BRIDGE_DECLS.length)
    // 生成物必须真的含该方法（不是空对象）
    const mp = mpBridgeExt({} as never, CapError)
    const web = webBridgeExt({} as never, CapError)
    expect(typeof mp.setKeepScreenOn).toBe('function')
    expect(typeof web.setKeepScreenOn).toBe('function')
  })

  it('MP 侧：真实调用 wx.setKeepScreenOn 并映射参数名（on → keepScreenOn）', async () => {
    const calls: Array<{ keepScreenOn?: boolean }> = []
    const wx = {
      setKeepScreenOn: (opt: { keepScreenOn: boolean; success?: () => void }) => {
        calls.push({ keepScreenOn: opt.keepScreenOn })
        opt.success?.()
      },
    }
    const ext = mpBridgeExt(wx as never, CapError)
    await ext.setKeepScreenOn!(true)
    await ext.setKeepScreenOn!(false)
    // ★参数映射正确（否则就是个"看起来能跑"的空壳）
    expect(calls).toEqual([{ keepScreenOn: true }, { keepScreenOn: false }])
  })

  it('MP 侧：wx 缺 API ⇒ Err(unsupported)（诚实降级，不静默成功）', async () => {
    const ext = mpBridgeExt({} as never, CapError)
    await expect(ext.setKeepScreenOn!(true)).rejects.toThrow(/screen\.keep-on\.unsupported/)
  })

  it('MP 侧：wx 失败回调 ⇒ Err(failed)（错误必须传播，不吞掉）', async () => {
    const wx = {
      setKeepScreenOn: (opt: { fail?: (e: unknown) => void }) => opt.fail?.(new Error('device denied')),
    }
    const ext = mpBridgeExt(wx as never, CapError)
    await expect(ext.setKeepScreenOn!(true)).rejects.toThrow(/screen\.keep-on\.failed/)
  })

  it('Web 侧：无 wakeLock ⇒ Err（诚实降级；web 不是所有环境都有该 API）', async () => {
    const ext = webBridgeExt({} as never, CapError)
    await expect(ext.setKeepScreenOn!(true)).rejects.toThrow(/screen\.keep-on\.unsupported/)
  })

  it('Web 侧：开→取句柄；重复开幂等；关→释放并允许重取（状态机完整）', async () => {
    let requests = 0
    let releases = 0
    const g = {
      navigator: {
        wakeLock: {
          request: async () => {
            requests++
            return { release: async () => { releases++ } }
          },
        },
      },
    }
    const ext = webBridgeExt(g as never, CapError)
    await ext.setKeepScreenOn!(true)
    await ext.setKeepScreenOn!(true) // 幂等：不重复 request
    expect(requests).toBe(1)
    await ext.setKeepScreenOn!(false)
    expect(releases).toBe(1)
    await ext.setKeepScreenOn!(false) // 幂等：不重复 release
    expect(releases).toBe(1)
    await ext.setKeepScreenOn!(true) // 释放后可重取（状态清空）
    expect(requests).toBe(2)
  })

  it('Hook 层：桥缺失 ⇒ Err（G-32.3 降级语义，非抛异常）', async () => {
    const hooks = createCapabilityHooks({} as CapabilityBridge)
    const r = await hooks.useKeepScreenOn(true)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('screen.keep-on.unsupported')
  })

  it('Hook 层：桥可用 ⇒ 透传成功（端到端接线成立）', async () => {
    const wx = {
      setKeepScreenOn: (opt: { keepScreenOn: boolean; success?: () => void }) => opt.success?.(),
    }
    const bridge = { ...mpBridgeExt(wx as never, CapError) } as CapabilityBridge
    const hooks = createCapabilityHooks(bridge)
    const r = await hooks.useKeepScreenOn(true)
    expect(r.ok).toBe(true)
  })

  it('声明字段自洽（防止把"形态"写错——生成器按 kind 分派模板）', () => {
    expect(decl.semantic).toBe('capability.keep-screen-on')
    expect(decl.mp.kind).toBe('callback')
    expect(decl.web.kind).toBe('stateful')
    expect(decl.errPrefix).toBe('screen.keep-on')
  })
})

describe('NC1 声明式能力桥（C84 useOpenDocument）', () => {
  const docDecl = BRIDGE_DECLS.find((d) => d.hook === 'useOpenDocument')!

  it('MP 侧：真实调用 wx.openDocument 并透传 filePath', async () => {
    const calls: string[] = []
    const wx = {
      openDocument: (opt: { filePath: string; success?: () => void }) => {
        calls.push(opt.filePath)
        opt.success?.()
      },
    }
    const ext = mpBridgeExt(wx as never, CapError)
    await ext.openDocument!('wxfile://tmp/a.pdf')
    expect(calls).toEqual(['wxfile://tmp/a.pdf'])
  })

  it('MP 侧：缺 API ⇒ Err(unsupported)（诚实降级）', async () => {
    const ext = mpBridgeExt({} as never, CapError)
    await expect(ext.openDocument!('x.pdf')).rejects.toThrow(/document\.open\.unsupported/)
  })

  it('MP 侧：失败回调 ⇒ Err(failed)（错误必须传播）', async () => {
    const wx = { openDocument: (opt: { fail?: (e: unknown) => void }) => opt.fail?.(new Error('unsupported format')) }
    const ext = mpBridgeExt(wx as never, CapError)
    await expect(ext.openDocument!('x.pdf')).rejects.toThrow(/document\.open\.failed/)
  })

  it('Web 侧：调用 window.open(url, _blank)（浏览器查看器；office 格式通常转下载——声明里已写明）', async () => {
    const opened: string[] = []
    const g = {
      open: (url: string, target?: string) => {
        opened.push(`${url}|${target}`)
        return { closed: false }
      },
    }
    const ext = webBridgeExt(g as never, CapError)
    await ext.openDocument!('https://x/a.pdf')
    expect(opened).toEqual(['https://x/a.pdf|_blank'])
  })

  it('Web 侧：★弹窗被拦截（返回 null）⇒ Err(failed)——不静默无反应（assert 判据）', async () => {
    const g = { open: () => null }
    const ext = webBridgeExt(g as never, CapError)
    await expect(ext.openDocument!('https://x/a.pdf')).rejects.toThrow(/document\.open\.failed/)
  })

  it('Web 侧：缺 window.open ⇒ Err(unsupported)（非浏览器环境）', async () => {
    const ext = webBridgeExt({} as never, CapError)
    await expect(ext.openDocument!('https://x/a.pdf')).rejects.toThrow(/document\.open\.unsupported/)
  })

  it('Hook 层：桥缺失 ⇒ Err / 桥可用 ⇒ 透传（端到端接线成立）', async () => {
    const missing = createCapabilityHooks({} as CapabilityBridge)
    const r1 = await missing.useOpenDocument('x.pdf')
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.error.code).toBe('document.open.unsupported')

    const wx = { openDocument: (opt: { success?: () => void }) => opt.success?.() }
    const bridge = { ...mpBridgeExt(wx as never, CapError) } as CapabilityBridge
    const hooks = createCapabilityHooks(bridge)
    const r2 = await hooks.useOpenDocument('x.pdf')
    expect(r2.ok).toBe(true)
  })

  it('声明字段自洽（形态分派正确）', () => {
    expect(docDecl.semantic).toBe('capability.document-preview')
    expect(docDecl.mp.kind).toBe('callback')
    expect(docDecl.web.kind).toBe('direct')
    if (docDecl.web.kind === 'direct') expect(docDecl.web.assert).toBeTruthy()
  })
})

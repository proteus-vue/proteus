// tests/mcp-plugin-tools.test.ts
// ★决策 #1471：插件开发 MCP 工具（4 个，全只读/静态校验）
//
// 【这组判据在守什么】
//   ① 硬边界：MCP **不得**出现 install / enable / 任意能力执行 —— 客户端是 AI，
//      能装插件就等于能给自己（或别人的仓库）装后门。这条用"名字黑名单"判，
//      防的不是现在，是将来有人顺手加一个。
//   ② manifest 校验必须与安装闸同规则：`implemented: false` 是 **error**（装上也是点了没反应），
//      `status: proposed` 是 **warning**（方向对但未收编）。
//   ③ scaffold 生成的东西必须**自己能过自己的校验**，否则模板会批量生产非法插件。
import { describe, it, expect } from 'vitest'
import { MCP_TOOLS, validateManifest, toProtocolCallResult } from '@proteus-vue/mcp'

const legal = {
  name: '@proteus-studio/plugin-demo',
  version: '0.1.0',
  tier: 'third-party',
  engines: { studio: '>=0.4.0 <0.6.0' },
  permissions: [{ id: 'readWorkspace' }],
}

const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code)
const warnCodes = (r: { warnings: { code: string }[] }) => r.warnings.map((w) => w.code)

describe('#1471 插件开发工具：硬边界', () => {
  it('4 个插件工具全为只读，且不存在 install/enable/exec 类工具', () => {
    const names = MCP_TOOLS.map((t) => t.name)
    const pluginTools = names.filter((n) => n.startsWith('plugin_'))
    expect(pluginTools).toEqual([
      'plugin_list_capabilities',
      'plugin_validate_manifest',
      'plugin_scaffold',
      'plugin_describe_provider',
    ])
    for (const n of pluginTools) {
      expect(MCP_TOOLS.find((t) => t.name === n)?.readonly, `${n} 必须只读`).toBe(true)
    }

    /* ★硬边界：任何工具名都不许出现"安装/启用/执行"的语义。
       MCP 客户端是 AI ⇒ 一旦 AI 能装插件，权限模型（G-58）就整体失效。 */
    const forbidden = /install|enable|activate|uninstall|spawn|exec/i
    const offenders = names.filter((n) => forbidden.test(n))
    expect(offenders, `MCP 不得提供安装/执行类工具：${offenders.join(', ')}`).toEqual([])
  })
})

describe('#1471 manifest 校验（安装闸规格）', () => {
  it('合法 manifest 通过', () => {
    const r = validateManifest(legal)
    expect(r.valid).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('包名前缀非法 ⇒ E_NAME', () => {
    expect(codes(validateManifest({ ...legal, name: 'evil-package' }))).toContain('E_NAME')
  })

  it('未知 capability ⇒ E_UNKNOWN_CAP（并列出可选值）', () => {
    const r = validateManifest({ ...legal, permissions: [{ id: 'readEverything' }] })
    expect(codes(r)).toContain('E_UNKNOWN_CAP')
    expect(r.errors[0].message).toContain('readWorkspace')
  })

  it('★tier 不足 ⇒ E_TIER_TOO_LOW（第三方声明 spawnProcess）', () => {
    const r = validateManifest({
      ...legal,
      permissions: [{ id: 'spawnProcess', reason: '跑 rustfmt', commands: ['rustfmt'] }],
    })
    expect(codes(r)).toContain('E_TIER_TOO_LOW')
  })

  it('★第三方声明 system.* ⇒ E_SYSTEM_SCOPE（结构性封印）', () => {
    const r = validateManifest({ ...legal, permissions: [{ id: 'system.internal' }] })
    expect(codes(r)).toContain('E_SYSTEM_SCOPE')
    expect(codes(r)).toContain('E_TIER_TOO_LOW')
  })

  it('需要理由的能力缺 reason ⇒ E_REASON', () => {
    const r = validateManifest({ ...legal, permissions: [{ id: 'writeWorkspace', paths: ['a.ts'] }] })
    expect(codes(r)).toContain('E_REASON')
  })

  it('带参能力缺白名单 ⇒ E_REQUIRES', () => {
    const r = validateManifest({
      ...legal,
      tier: 'trusted',
      permissions: [{ id: 'spawnProcess', reason: '跑格式化器' }],
    })
    expect(codes(r)).toContain('E_REQUIRES')
  })

  it('★宿主未实现的能力 ⇒ E_NOT_IMPLEMENTED（装上也是点了没反应）', () => {
    const r = validateManifest({ ...legal, permissions: [{ id: 'kernel.spiTopology' }] })
    expect(codes(r)).toContain('E_NOT_IMPLEMENTED')
  })

  it('★提案能力 ⇒ 只给 warning（W_PROPOSED），不阻断安装', () => {
    const r = validateManifest({
      ...legal,
      tier: 'trusted',
      permissions: [{ id: 'terminal', reason: '需要跑用户命令来构建项目' }],
    })
    expect(r.valid, `terminal 是 proposed 而非 error：${JSON.stringify(r.errors)}`).toBe(true)
    expect(warnCodes(r)).toContain('W_PROPOSED')
  })

  it('engines 缺失 ⇒ E_ENGINES', () => {
    const { engines: _drop, ...rest } = legal
    expect(codes(validateManifest(rest))).toContain('E_ENGINES')
  })

  it('manifest 不是对象 ⇒ E_MANIFEST（不抛异常）', () => {
    expect(codes(validateManifest(null))).toContain('E_MANIFEST')
    expect(codes(validateManifest('x'))).toContain('E_MANIFEST')
  })
})

describe('#1471 工具行为（直接调 run，走与 server 相同的入参）', () => {
  const byName = (n: string) => {
    const t = MCP_TOOLS.find((x) => x.name === n)
    if (!t) throw new Error(`工具不存在：${n}`)
    return t
  }

  it('list_capabilities：third-party 拿不到 trusted 档能力', () => {
    const out = byName('plugin_list_capabilities').run({ tier: 'third-party' }, { writeEnabled: false }) as {
      capabilities: { id: string }[]
    }
    const ids = out.capabilities.map((c) => c.id)
    expect(ids).toContain('readWorkspace')
    expect(ids).not.toContain('spawnProcess')
    expect(ids).not.toContain('terminal')
    expect(ids).not.toContain('system.internal')
  })

  it('list_capabilities：implementedOnly 过滤掉 kernel.*', () => {
    const out = byName('plugin_list_capabilities').run(
      { tier: 'third-party', implementedOnly: true },
      { writeEnabled: false },
    ) as { capabilities: { id: string }[] }
    expect(out.capabilities.map((c) => c.id)).not.toContain('kernel.spiTopology')
  })

  it('★scaffold 产出的 manifest 必须能过自己的校验', () => {
    const out = byName('plugin_scaffold').run(
      { name: '@proteus-studio/plugin-demo', capabilities: ['readWorkspace'] },
      { writeEnabled: false },
    ) as {
      scaffolded: boolean
      selfCheck: { valid: boolean }
      files: { path: string; content: string }[]
      wroteToDisk: boolean
    }

    expect(out.wroteToDisk).toBe(false)
    const manifestFile = out.files.find((f) => f.path === 'proteus.plugin.json')
    expect(manifestFile).toBeTruthy()
    const parsed = JSON.parse(manifestFile!.content)
    expect(validateManifest(parsed).valid).toBe(true)
    expect(out.selfCheck.valid).toBe(true)
  })

  it('describe_provider：10 个插槽，foldingRange/codeAction 尚无通道', () => {
    const all = byName('plugin_describe_provider').run({}, { writeEnabled: false }) as {
      total: number
      kinds: { kind: string; status: string }[]
    }
    expect(all.total).toBe(10)
    expect(all.kinds.find((k) => k.kind === 'foldingRange')?.status).toBe('no-channel')
    expect(all.kinds.find((k) => k.kind === 'documentFormatting')?.status).toBe('has-channel')
  })

  /* ★★这条判据守的是一个只在真实协议链路上才暴露的陷阱（决策 #1471 端到端实测）：
     `toProtocolCallResult` 会把 `payload.ok === false` 判成"**工具执行失败**"，
     于是"校验不通过"这个**业务结论**会被压成一行 `error: 操作失败`，errors 全丢。
     单测直接调 `run()` 拿得到完整对象，所以永远测不出这段——必须显式走协议转换。 */
  it('★校验不通过是正常结果，不能被协议层当成工具失败', () => {
    const core = byName('plugin_validate_manifest').run(
      { manifest: { ...legal, permissions: [{ id: 'not-a-real-cap' }] } },
      { writeEnabled: false },
    )
    const protocol = toProtocolCallResult({
      ok: true,
      tool: 'plugin_validate_manifest',
      result: core,
    })
    expect(protocol.isError, '校验不通过不是工具故障，不该标 isError').toBeFalsy()
    const payload = JSON.parse(protocol.content[0].text) as { valid: boolean; errors: { code: string }[] }
    expect(payload.valid).toBe(false)
    expect(payload.errors.map((e) => e.code)).toContain('E_UNKNOWN_CAP')
  })
})

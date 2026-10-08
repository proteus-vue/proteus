// tests/cli-help.test.ts
// ★决策 #689：单命令 help（`proteus <cmd...> --help` / `-h` / `proteus help <cmd...>`）。
//   背景（用户）：「cli 命令不支持子命令的 help」——此前 `proteus build --help` 报「未知选项」、
//   `proteus doctor --help` 报「未知参数」，而全量 help 页脚恰恰承诺了 `proteus <command> --help`。
//   验收：命中命令 → 打该命令条目；未命中 → 回落全量 help（不吞请求）；`-h` 别名；子命令路径前缀匹配。
import { describe, it, expect } from 'vitest'
import { formatCommandHelp, formatHelpText, isHelpRequest } from '../packages/cli/src/args'

describe('★#689 单命令 help', () => {
  it('isHelpRequest：认 --help / -h，不认其它', () => {
    expect(isHelpRequest(['--help'])).toBe(true)
    expect(isHelpRequest(['-h'])).toBe(true)
    expect(isHelpRequest(['--out', 'x', '--help'])).toBe(true)
    expect(isHelpRequest(['--out', 'x'])).toBe(false)
    expect(isHelpRequest(['--help-extra'])).toBe(false) // 不算（避免子串误判）
  })

  it('formatCommandHelp：顶层命令命中（build/doctor/test/conformance/explain）', () => {
    for (const c of ['build', 'doctor', 'test', 'conformance', 'explain']) {
      const t = formatCommandHelp([c], false)
      expect(t, c).toBeTruthy()
      expect(t!, c).toContain(`proteus ${c}`)
      expect(t!, c).toContain('Proteus CLI')
    }
  })

  it('★子命令路径前缀匹配：host signing / mcp serve', () => {
    const hs = formatCommandHelp(['host', 'signing'], false)
    expect(hs).toBeTruthy()
    expect(hs!).toContain('proteus host signing')
    const ms = formatCommandHelp(['mcp', 'serve'], false)
    expect(ms).toBeTruthy()
    expect(ms!).toContain('proteus mcp serve')
  })

  it('★带 flag 值不误伤：路径 token 过滤掉 - 开头的', () => {
    // `proteus build --help`：调用方传 ['build']（已滤 flag）；此处再验 formatCommandHelp 自身也滤
    const t = formatCommandHelp(['build', '--out', '/tmp'], false)
    expect(t).toBeTruthy()
    expect(t!).toContain('proteus build')
  })

  it('★未命中 ⇒ null（调用方回落全量 help，不吞请求）', () => {
    expect(formatCommandHelp(['nosuchcmd'], false)).toBeNull()
    expect(formatCommandHelp([], false)).toBeNull()
  })

  it('非 TTY（color=false）⇒ 零 ANSI', () => {
    const t = formatCommandHelp(['build'], false)!
    expect(t.includes('\u001b[')).toBe(false)
    expect(formatHelpText(false).includes('\u001b[')).toBe(false)
  })

  it('全量 help 仍含全部分组（重构渲染不回归）', () => {
    const all = formatHelpText(false)
    expect(all).toContain('构建与开发')
    expect(all).toContain('检查与门禁')
    expect(all).toContain('proteus doctor')
    expect(all).toContain('proteus host signing')
  })
})

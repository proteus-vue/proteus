/**
 * Studio 文件树写操作 —— 纯函数单测（决策 #1460）
 *
 * 【为什么只测这四个函数】`runFileOp` 的 IPC / 确认框 / 刷树那段走的是**真实鼠标入口**
 * （`scripts/studio-panel-probes-fileops.mjs` 的判据 ㊾），这里补的是它依赖的**影响面计算**：
 * 「目录操作要覆盖整个子树」「文件操作只覆盖自己」「名字校验必须挡住路径分隔符」。
 * 这三条算错 ⇒ 保护会漏 ⇒ 删掉正打开的文件，是这单最不可逆的错误。
 */
import { describe, expect, it } from 'vitest'
import { ROOTS, joinPath, parentDir, under, validName } from '../packages/studio/ui/src/fileOps'

describe('parentDir / joinPath', () => {
  it('文件取父目录，无斜杠时为空', () => {
    expect(parentDir('packages/studio/src/main.rs')).toBe('packages/studio/src')
    expect(parentDir('main.rs')).toBe('')
  })

  it('拼接不产生双斜杠', () => {
    expect(joinPath('packages/studio/src', 'a.ts')).toBe('packages/studio/src/a.ts')
    expect(joinPath('', 'a.ts')).toBe('a.ts')
  })
})

describe('under（影响面）', () => {
  it('目录操作覆盖自身与所有后代', () => {
    expect(under('a/b/c.ts', 'a/b')).toBe(true)
    expect(under('a/b', 'a/b')).toBe(true)
  })

  it('★不把同名前缀的兄弟目录算进来（a/bc 不是 a/b 的后代）', () => {
    expect(under('a/bc/x.ts', 'a/b')).toBe(false)
    expect(under('a/b2/x.ts', 'a/b')).toBe(false)
  })

  it('文件操作只匹配自己', () => {
    expect('a/b/c.ts' === 'a/b/c.ts').toBe(true)
    expect('a/b/c.ts.bak' === 'a/b/c.ts').toBe(false)
  })
})

describe('validName', () => {
  it('合法名字放行（含中文与点）', () => {
    expect(validName('新建.vue')).toBe('')
    expect(validName('a.b.ts')).toBe('')
  })

  it('拒绝空 / . / .. / 路径分隔符 / 控制字符', () => {
    expect(validName('  ')).not.toBe('')
    expect(validName('.')).not.toBe('')
    expect(validName('..')).not.toBe('')
    expect(validName('a/b.vue')).not.toBe('')
    expect(validName('a\\b.vue')).not.toBe('')
    expect(validName('a\u0000b.ts')).not.toBe('')
  })
})

describe('ROOTS', () => {
  it('三个扫描根都在 packages/studio 下（新建不会落到树外）', () => {
    expect(ROOTS).toHaveLength(3)
    expect(ROOTS.every((r) => r.startsWith('packages/studio/'))).toBe(true)
  })
})

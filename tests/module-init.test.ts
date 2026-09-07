// tests/module-init.test.ts
// ★module-plan B9（整合）：proteus init module —— 生成 proteus-module.config.ts 骨架
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeModuleConfigSkeleton, MODULE_CONFIG_SKELETON } from '../packages/cli/src/module-init'
import { parseModuleInitArgs } from '../packages/cli/src/args'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-init-'))

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('proteus init module（契约骨架生成）', () => {
  it('生成 proteus-module.config.ts（defineModule 模板 + 校验可用）', () => {
    const out = writeModuleConfigSkeleton(TMP)
    expect(path.basename(out)).toBe('proteus-module.config.ts')
    const content = fs.readFileSync(out, 'utf-8')
    expect(content).toContain("import { defineModule } from '@proteus-vue/module'")
    expect(content).toContain("name: 'app'")
    expect(content).toContain('dependencies: {}')
    expect(content).toContain(MODULE_CONFIG_SKELETON)
  })

  it('已存在 → 不覆盖抛错', () => {
    expect(() => writeModuleConfigSkeleton(TMP)).toThrow(/不覆盖/)
  })

  it('args 解析：缺省当前目录', () => {
    const { root } = parseModuleInitArgs([])
    expect(root).toBe(path.resolve('.'))
    const { root: root2 } = parseModuleInitArgs(['some/dir'])
    expect(root2).toBe(path.resolve('some/dir'))
  })
})

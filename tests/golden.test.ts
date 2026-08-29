// tests/golden.test.ts
// P6-2 转换 golden test：fixtures + 快照锁定产物
// fixtures 位于 tests/fixtures/pages/（不在 src/ 下，不会进入真实构建管线）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileVueSfc } from '../packages/compiler/src'

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/pages')
const FIXTURES = ['basic', 'input', 'rich', 'tab']

describe('golden test（fixtures → 快照锁定产物）', () => {
  for (const name of FIXTURES) {
    it(`fixtures/pages/${name}.vue 产物与快照一致`, () => {
      const source = fs.readFileSync(path.join(fixturesDir, `${name}.vue`), 'utf-8')
      const { wxml, js, wxss, warnings } = compileVueSfc(source, {
        filename: `pages/${name}`,
        px2rpx: true,
        rpxRatio: 2,
      })
      expect({ wxml, js, wxss, warnings }).toMatchSnapshot()
    })
  }
})

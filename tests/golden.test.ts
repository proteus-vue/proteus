// tests/golden.test.ts
// P6-2 转换 golden test：fixtures + 快照锁定产物（★test-framework B2 升级：结构快照）
// fixtures 位于 tests/fixtures/pages/（不在 src/ 下，不会进入真实构建管线）
// B2：wxml 经 canonicalizeWxml 规范化（属性序/空白/注释不敏感）+ sourcemap 回源校验 + JS 关键导出存在性
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileVueSfc } from '../packages/compiler/src'
import { canonicalizeWxml, verifySourceMap, checkJsExports } from '@proteus-vue/test-core/snapshot'

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/pages')
const FIXTURES = ['basic', 'input', 'rich', 'tab']

describe('golden test（fixtures → 快照锁定产物）', () => {
  for (const name of FIXTURES) {
    it(`fixtures/pages/${name}.vue 产物与快照一致`, () => {
      const source = fs.readFileSync(path.join(fixturesDir, `${name}.vue`), 'utf-8')
      const { wxml, js, wxss, warnings, sourcemap } = compileVueSfc(source, {
        filename: `pages/${name}`,
        px2rpx: true,
        rpxRatio: 2,
      })
      // 结构快照：wxml 规范化（属性序/空白不敏感），js/wxss/warnings 确定性字符串
      expect({ wxml: canonicalizeWxml(wxml), js, wxss, warnings }).toMatchSnapshot()
      // B2 sourcemap 回源：每个映射段行号都在产物/源码范围内（02 §快照对象 source map）
      expect(verifySourceMap(sourcemap, js, source)).toEqual([])
      // B2 JS 关键导出存在性：页面配置顶层键（data + onLoad 生命周期必在）
      expect(checkJsExports(js, ['data', 'onLoad'])).toEqual([])
    })
  }
})

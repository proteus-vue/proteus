// tests/stores-purity.test.ts
// stores/ 目录平台纯净性校验（docs/proteus-pinia-plan M6 §2.3 + 铁律：禁止平台分支代码）
// 同一份 store 四端一致的前提：store 源码不感知平台——差异必须收敛在 @proteus/runtime 工厂与 shared/storage
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const STORES_DIR = path.resolve('examples/stores')

/** 平台分支关键词：出现在 store 源码中即视为违规（window/wx./getPlatform/typeof process.env） */
const FORBIDDEN = [
  'window.',
  'wx.',
  'getPlatform(',
  'typeof window',
  'localStorage',
  'setStorageSync',
]

describe('stores/ 平台纯净性（铁律：禁止平台分支）', () => {
  it('全部 store 源码不含平台分支关键词', () => {
    const files = fs.readdirSync(STORES_DIR).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const src = fs.readFileSync(path.join(STORES_DIR, f), 'utf-8')
      for (const kw of FORBIDDEN) {
        expect(src, `${f} 含平台分支关键词 "${kw}"`).not.toContain(kw)
      }
    }
  })
})

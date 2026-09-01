// tests/dist-integrity.test.ts —— 构建产物完整性：共享单例实现不得被内联进其他包 dist
// ★防回归（决策 #250）：devtools 曾把 devtools-runtime 内联进 bundle → getProteusTraceBus 双实例
//   （main.ts setEnabled 设给包模块单例 A，install/面板订阅 bundle 内联副本 B → 面板 timeline 永远空）
//   共享模块级可变状态（bus 单例等）必须 external 引用，保证业务侧多包解析到同一模块实例
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = path.join(root, 'packages')

/** 共享单例实现的所有者包（只有它能定义这些函数；其他包必须 external 引用） */
const SINGLETON_OWNERS = new Set(['devtools-runtime'])
/** 共享单例实现特征（内联 = 双实例风险）——带括号精确匹配（避免命中 createTraceBusSource/WsBridge 前缀） */
const SINGLETON_FNS = ['function getProteusTraceBus(', 'function createTraceBus(']

describe('dist 构建产物完整性（共享单例不内联）', () => {
  it('getProteusTraceBus/createTraceBus 实现只存在于 devtools-runtime，其余包 dist 零内联', () => {
    const offenders: string[] = []
    for (const dir of readdirSync(packagesDir)) {
      const distFile = path.join(packagesDir, dir, 'dist', 'index.js')
      if (!existsSync(distFile) || SINGLETON_OWNERS.has(dir)) continue
      const code = readFileSync(distFile, 'utf8')
      for (const fn of SINGLETON_FNS) {
        if (code.includes(fn)) offenders.push(`${dir}: ${fn}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('devtools dist 必须 external 引用 devtools-runtime（import 而非内联实现）', () => {
    const code = readFileSync(path.join(packagesDir, 'devtools', 'dist', 'index.js'), 'utf8')
    expect(code).toContain('@proteus-vue/devtools-runtime') // external import 保留
    expect(code).not.toContain('function getProteusTraceBus') // 不内联单例实现
  })
})

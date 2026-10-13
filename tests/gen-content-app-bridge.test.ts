// tests/gen-content-app-bridge.test.ts
// ★决策 #881：官网能力页「App 端（iOS/Android）是否接线」由 `capability-app.ts` 的**桥方法名**推导。
//   旧实现是 gen-content.mjs 内一条窄正则 `/^\s{4}(get[A-Z]\w*)\(/`（**只认方法简写**）⇒
//   13 个桥方法只抽到 3 个 ⇒ 8+ 能力被误标「渲染核心已落地——能力桥未接线」（对外谎报）。
//   本测试锁三件事：① 真实源码抽全集（≥13）且**两种声明风格都收**；② 破坏性：符号/返回对象缺失 ⇒ 报错（不静默）；
//   ③ 与能力页实际分档一致（App 端 ✅ 数 ≥ 11）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractAppBridgeKeys, loadAppBridgeKeys, APP_BRIDGE_FACTORIES } from '../website/scripts/lib/app-bridge-keys.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_SRC = path.join(ROOT, 'packages', 'api', 'src', 'capability-app.ts')
const CAP_DIR = path.join(ROOT, 'website', 'content', 'capabilities')

// 属性箭头风格（`getXxx: () => …`）——旧正则全部漏掉的那一批
const ARROW_STYLE = [
  'getHostContext',
  'getUpdateManager',
  'createWorker',
  'loadExtension',
  'getPreload',
  'getIdle',
  'getWindow',
  'getNavigationGuard',
  'navigateMiniProgram',
]
// 方法简写风格（`getXxx(): T {…}`）——旧正则唯一认得的那三个
const SHORTHAND_STYLE = ['getAppLifecycle', 'getPageLifecycle', 'getBackground']

describe('App 宿主桥方法集抽取（生成器 ↔ 源码 显式契约 · #881）', () => {
  it('真实源码：抽全集（≥13）且两种声明风格都收', () => {
    const { keys, perFn, misses } = extractAppBridgeKeys(fs.readFileSync(APP_SRC, 'utf8'))
    expect(misses).toEqual([])
    for (const fn of APP_BRIDGE_FACTORIES) expect(perFn[fn], fn).toBeGreaterThan(0)
    for (const k of ARROW_STYLE) expect(keys.has(k), `应含属性箭头风格 ${k}`).toBe(true)
    for (const k of SHORTHAND_STYLE) expect(keys.has(k), `应含方法简写风格 ${k}`).toBe(true)
    expect(keys.size).toBeGreaterThanOrEqual(13)
  })

  it('破坏性：工厂函数改名 ⇒ 报错（不静默得空集）', () => {
    const src = fs
      .readFileSync(APP_SRC, 'utf8')
      .replace('export function createAppNativeCapabilities', 'export function createAppNativeCapabilities_X')
    const { misses, keys } = extractAppBridgeKeys(src)
    expect(misses.join(' ')).toContain('createAppNativeCapabilities')
    expect(keys.has('getWindow')).toBe(false)
  })

  it('破坏性：源码为空 ⇒ 两个工厂都报「函数未找到」，键集为空', () => {
    const { misses, keys } = extractAppBridgeKeys('')
    expect(misses).toHaveLength(APP_BRIDGE_FACTORIES.length)
    expect(keys.size).toBe(0)
  })

  it('loadAppBridgeKeys：源文件缺失 ⇒ 抛错（数据源缺失 = 硬失败）', () => {
    expect(() => loadAppBridgeKeys(path.join(ROOT, 'packages', 'api', 'src', '__no_such_bridge__.ts'))).toThrow()
  })

  it('loadAppBridgeKeys：真实文件 ⇒ ≥13 个桥方法', () => {
    const { keys } = loadAppBridgeKeys(APP_SRC)
    expect(keys.size).toBeGreaterThanOrEqual(13)
  })

  it('与能力页分档一致：App 端应判 ✅ 的 11 项逐项落页（旧窄正则下只有 3）', () => {
    const EXPECTED = [
      'app-lifecycle',
      'background',
      'embedded',
      'extension',
      'idle',
      'navigation-guard',
      'page-lifecycle',
      'preload',
      'update',
      'window',
      'worker',
    ]
    const files = fs.readdirSync(CAP_DIR).filter((f) => f.endsWith('.md') && !f.startsWith('00-'))
    const iosOk = new Set<string>()
    const androidOk = new Set<string>()
    let iosTotal = 0
    for (const f of files) {
      const t = fs.readFileSync(path.join(CAP_DIR, f), 'utf8')
      const i = t.indexOf('## 兼容进度')
      if (i < 0) continue
      const seg = t.slice(i, i + 1500)
      if (seg.match(/\|\s*iOS 原生\s*\|\s*✅/)) iosOk.add(f.replace('.md', ''))
      if (seg.match(/\|\s*Android 原生\s*\|\s*✅/)) androidOk.add(f.replace('.md', ''))
      if (seg.match(/\|\s*iOS 原生\s*\|\s*✅/)) iosTotal++
    }
    expect(iosTotal).toBeGreaterThanOrEqual(11)
    for (const slug of EXPECTED) {
      expect(iosOk.has(slug), `章节 ${slug} 的 iOS 原生应为 ✅`).toBe(true)
      expect(androidOk.has(slug), `章节 ${slug} 的 Android 原生应为 ✅`).toBe(true)
    }
  })
})

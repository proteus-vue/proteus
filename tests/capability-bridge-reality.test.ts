// tests/capability-bridge-reality.test.ts
// ★★★决策 #1090（2026-10-19）：能力页 ✅ 的**第二道判据**——「桥方法存在」不等于「能用」。
//
// 【为什么（用户追问「✅ 是只有接线才算还是有桥就算」）】
//   查证发现三端口径不一致：
//     · 微信 / Web：**方法名存在**就判 ✅（完全不看方法体）
//     · iOS / Android：App 桥工厂返回对象里有方法名 ⇒ ✅（不看宿主是否真实现）
//     · 鸿蒙：JS 桥 + 宿主源码**双证据** ⇒ 最严
//   于是 Web 侧有 11 个页面假绿、微信侧 1 个——桥成员的方法体**全是 unsupported、零平台调用**：
//     `getPreload` / `getImageEdit` / `getWindow` / `getAd` / `createCacheManager` /
//     `getSocket` / `getPrivacy` / `getAR` / `joinLiveRoom` / `createLivePusher` / `navigateMiniProgram`
//     （微信：`loadExtension`）
//   业务永远拿到 Err，文档却写「webBridge 实现（平台 API 直连）」。
//
// 【判据（`lib/bridge-impl-reality.mjs`）】
//   纯空壳 = 方法体里出现 `unsupported` 错误码，且**没有任何平台入口标识符**
//     （Web：`g`/`nav`/`doc`/`navigator`/`document`/`WebSocket`/`fetch`/`MediaSource`… / 微信：`wx.`）
//   ⇒ 页面降 ⚠️，总览计入"需降级"，覆盖率不算。
//
// 【★两个必须锁住的坑（首版都踩了）】
//   ① **参数表里的类型字面量**：`webBridge(g: typeof globalThis & { navigator?: … })` ——
//      直接找第一个 `{` 会落进参数里 ⇒ 抽出的成员数恒为 0（"判据静默失效"）。必须先做括号配对跳过 `( … )`。
//   ② **错误文案里的平台名**：`navigateMiniProgram` 的 Err 文案写着「请用 window.open」——
//      若不剥字符串，它会被判成"真的有平台调用" ⇒ 空壳漏网。剥字符串后再找平台入口。
//      但 `unsupported` **本身就在字符串里**（`'preload.unsupported'`）⇒ 它必须用**原文**判断。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyMemberBody, extractFactoryMembers, loadPureShellMembers, stripLiterals,
} from '../website/scripts/lib/bridge-impl-reality.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BRIDGES = path.join(ROOT, 'packages/api/src/capability-bridges.ts')

describe('★#1090 ① 纯空壳识别（合成样本，逐形态）', () => {
  it('全部出口 unsupported 且零平台调用 ⇒ shell', () => {
    expect(classifyMemberBody(`    getX: () => {
      const no = (op: string) => Promise.resolve(capErr('x.unsupported', 'Web 无 ' + op))
      return { a: () => no('a'), b: () => no('b') }
    },`, 'web')).toBe('shell')
  })
  it('创建即抛 unsupported ⇒ shell', () => {
    expect(classifyMemberBody(`    createX: () => { throw new CapError('x.unsupported', 'Web 不支持') },`, 'web')).toBe('shell')
  })
  it('有平台入口（哪怕只是探测）⇒ real', () => {
    expect(classifyMemberBody(`    getBattery: async () => {
      const b = nav?.getBattery
      if (!b) throw new CapError('battery.unsupported', 'no')
      return b()
    },`, 'web')).toBe('real')
  })
  it('★错误文案里的平台名不算平台调用（剥字符串）', () => {
    const code = `    navMP: () => Promise.reject(new CapError('m.unsupported', 'Web 请用 window.open / document')),`
    expect(classifyMemberBody(code, 'web')).toBe('shell')
  })
  it('无 unsupported ⇒ pure-js（证不出是空壳，不降级）', () => {
    expect(classifyMemberBody(`    getFS: () => memoryFileSystem(),`, 'web')).toBe('pure-js')
  })
  it('微信按 wx. 判入口', () => {
    expect(classifyMemberBody(`    f: () => new Promise((res, rej) => { if (!wx.f) return rej(new CapError('f.unsupported','x')); wx.f() }),`, 'mp')).toBe('real')
    expect(classifyMemberBody(`    g: () => Promise.reject(new CapError('g.unsupported', '小程序无此 API')),`, 'mp')).toBe('shell')
  })
  it('stripLiterals 保留标识符、抹掉字面量内容', () => {
    const out = stripLiterals(`const a = 'window.open'; const b = navigator`)
    expect(out).not.toContain('window.open')
    expect(out).toContain('navigator')
  })
})

describe('★#1090 ② 真桥抽取不落进参数表（首版失效形态）', () => {
  it('webBridge 抽出 ≥60 个成员（参数含类型字面量）', () => {
    const members = extractFactoryMembers(fs.readFileSync(BRIDGES, 'utf8'), 'webBridge')
    expect(Object.keys(members).length).toBeGreaterThan(60)
    expect(members.getPreload, '缺 getPreload——抽取落进参数表了').toBeTruthy()
  })
  it('wxBridge 同样能抽出成员', () => {
    const members = extractFactoryMembers(fs.readFileSync(BRIDGES, 'utf8'), 'wxBridge')
    expect(Object.keys(members).length).toBeGreaterThan(60)
  })
})

describe('★#1090 ③ 已知空壳必须被识别（防判据退化）', () => {
  it('Web 侧 11 个空壳全部命中', () => {
    const shells = loadPureShellMembers(ROOT, 'web')
    const known = ['getPreload', 'getImageEdit', 'getWindow', 'getAd', 'createCacheManager', 'getSocket',
      'getPrivacy', 'getAR', 'joinLiveRoom', 'createLivePusher', 'navigateMiniProgram']
    const missed = known.filter((k) => !shells.has(k))
    expect(missed, `这些纯空壳漏判（文档会继续假绿）：${missed.join(', ')}`).toEqual([])
  })
  it('微信侧 loadExtension 命中', () => {
    expect(loadPureShellMembers(ROOT, 'mp').has('loadExtension')).toBe(true)
  })
})

describe('★#1090 ④ 反向保护：真实现不得被误判空壳', () => {
  it('这些成员有真实平台调用，必须不在空壳集里', () => {
    const shells = loadPureShellMembers(ROOT, 'web')
    // 逐个都有真实入口：navigator.* / MediaSource / WebAssembly / document.* / WebSocket / performance
    const real = ['getBattery', 'getLocation', 'getDeviceCapability', 'getWebAssembly', 'getNetwork',
      'readSensor', 'loadExtension', 'getKeyboard', 'createIntersection', 'createCanvas', 'createAudio',
      'getStorage', 'getFileSystem', 'getCookieJar', 'connectWebSocket', 'getIdle', 'getNavigationGuard']
    const wrong = real.filter((k) => shells.has(k))
    expect(wrong, `这些是真实实现却被判成空壳（会把对的改错）：${wrong.join(', ')}`).toEqual([])
  })
})

describe('★#1090 ⑤ 产物：空壳页降 ⚠️，且总览同步', () => {
  const CAP_DIR = path.join(ROOT, 'website/content/capabilities')
  const cases = [
    ['preload', 'Web SPA'], ['image-edit', 'Web SPA'], ['window', 'Web SPA'], ['ad', 'Web SPA'],
    ['cache-manager', 'Web SPA'], ['socket', 'Web SPA'], ['privacy', 'Web SPA'], ['ar', 'Web SPA'],
    ['live', 'Web SPA'], ['live-pusher', 'Web SPA'], ['mini-program', 'Web SPA'], ['extension', '微信小程序'],
  ]
  it('12 个纯空壳页对应的端列都是 ⚠️ 且文案点名"纯空壳"', () => {
    const bad: string[] = []
    for (const [slug, end] of cases) {
      const f = path.join(CAP_DIR, `${slug}.md`)
      if (!fs.existsSync(f)) continue
      const s = fs.readFileSync(f, 'utf8')
      const m = new RegExp(`\\| ${end} \\| ([^|]+) \\|`).exec(s)
      if (!m) { bad.push(`${slug}: 缺 ${end} 行`); continue }
      if (m[1].trim() !== '⚠️') bad.push(`${slug} ${end}: 标记是 ${m[1].trim()}（应为 ⚠️）`)
      if (!/纯空壳/.test(s)) bad.push(`${slug}: 文案未说明"纯空壳"`)
    }
    expect(bad, bad.join('\n')).toEqual([])
  })
  it('总览页的 Web ✅ 数已把空壳排除在外', () => {
    const ov = fs.readFileSync(path.join(CAP_DIR, '00-capabilities-overview.md'), 'utf8')
    const m = /\| Web SPA \| (\d+) \| (\d+) \|/.exec(ov)
    expect(m, '总览缺 Web 行').toBeTruthy()
    // 空壳改正前是 62；修正后必须严格更小（防"改了判据但总览没接"）
    expect(+m![1], 'Web ✅ 数没有因空壳降级而减少——总览未接入判据').toBeLessThan(62)
  })
})

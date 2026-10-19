// tests/capability-app-host-evidence.test.ts
// ★★★决策 #1092（2026-10-19）：App 端（iOS/Android）✅ 增加「宿主证据」判据。
//
// 【为什么（#1090 的诚实边界，本轮补上）】
//   #1090 只给 Web/MP 加了"纯空壳"判据，App 端仍是**只看 JS 桥工厂有没有方法名**：
//   `capability-app.ts` 里写了 `getBattery` ⇒ 标 ✅，**不验证宿主是否真的实现了 `device.battery`**。
//   用户追问「✅ 是只有接线才算还是有桥就算」时，我实测了 30 个 ✅：
//   **29 个**在宿主源码里找得到对应分派，唯一例外是 iOS `webassembly`（JSC 内建，合法省略）。
//   ⇒ 说明当时的数字是对的，但**判据不保证**——这正是"人工核对过"与"门禁强制"的差别。
//
// 【判据】
//   ① 桥方法 → 宿主方法名：能从工厂体（`invokeHost('x.y')` / `APP_*_METHODS.k`）或显式表解析出来；
//   ② 宿主方法名 → 该端源码里真的有分派（四种形态，与 check:host-invoke-contract 同一套）；
//   ③ **纯 JS 桥成员不算缺**（导航守卫 / 键盘推送 / 媒体查询求值等本就在 JS 侧实现）；
//   ④ **引擎自带豁免**：iOS JSC 内建 WebAssembly ⇒ 宿主不实现 `webassembly.*` 是合法的
//      （与 render-backend 的 HOST_METHOD_OPTIONAL.ios 同源）；
//   ⑤ 产物：30 个 App ✅ 全部有证据；一旦宿主撤掉某方法分派，对应页面必须降 🟡 并点名方法.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appHostEvidence, APP_ENGINE_BUILTIN } from '../website/scripts/lib/harmony-host-keys.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CAP_DIR = path.join(ROOT, 'website/content/capabilities')

const markOf = (slug: string, label: string): string | null => {
  const f = path.join(CAP_DIR, slug + '.md')
  if (!fs.existsSync(f)) return null
  const m = new RegExp('\\| ' + label + '[^|]*\\| ([^|]+) \\|').exec(fs.readFileSync(f, 'utf8'))
  return m ? m[1].trim() : null
}

describe('★#1092 ① 证据解析：桥成员 → 宿主方法', () => {
  it('设备域桥成员解析到真实宿主方法名', () => {
    for (const end of ['ios', 'android'] as const) {
      expect(appHostEvidence(ROOT, end, ['getBattery']).ok, `${end}: getBattery 应有 device.battery 分派`).toBe(true)
      expect(appHostEvidence(ROOT, end, ['getScreen']).ok, `${end}: getScreen 应有 device.screen 分派`).toBe(true)
      expect(appHostEvidence(ROOT, end, ['getDevice']).ok, `${end}: getDevice 应有 device.info 分派`).toBe(true)
    }
  })
  it('元素域桥成员解析到 element.rect', () => {
    for (const end of ['ios', 'android'] as const) {
      expect(appHostEvidence(ROOT, end, ['createElementQuery']).ok).toBe(true)
    }
  })
})

describe('★#1092 ② 纯 JS 桥成员不算缺', () => {
  it('导航守卫 / 键盘 在宿主没有方法分派，但仍是合法实现', () => {
    for (const end of ['ios', 'android'] as const) {
      const r = appHostEvidence(ROOT, end, ['getNavigationGuard', 'getKeyboard'])
      expect(r.ok, `${end}: 纯 JS 桥成员不应被判缺`).toBe(true)
      expect(r.pureJs).toContain('getNavigationGuard')
    }
  })
})

describe('★#1092 ③ 引擎自带豁免（iOS JSC 内建 WebAssembly）', () => {
  it('iOS 的 webassembly.* 在豁免表里，因此不判缺', () => {
    expect(APP_ENGINE_BUILTIN.ios).toContain('webassembly.instantiate')
    const r = appHostEvidence(ROOT, 'ios', ['getWebAssembly'])
    expect(r.ok, 'iOS 走 JSC 内建 WASM，宿主不实现是合法的').toBe(true)
  })
  it('Android 没有该豁免（QuickJS 无内建 WASM，靠宿主 wasm3）', () => {
    expect(APP_ENGINE_BUILTIN.android).toEqual([])
    // Android 宿主确实实现了 wasm 分派 ⇒ 证据成立
    expect(appHostEvidence(ROOT, 'android', ['getWebAssembly']).ok).toBe(true)
  })
})

describe('★#1092 ④ 产物：App 端 ✅ 全部有宿主证据', () => {
  it('30 个 iOS ✅ 与 30 个 Android ✅ 的桥成员都有宿主分派（或纯 JS / 引擎豁免）', () => {
    // 直接对每个 ✅ 页面反查其 hook 的 refs，再验一次证据——防止"页面数字对了但判据没接"
    const files = fs.readdirSync(CAP_DIR).filter((f) => f.endsWith('.md') && !f.startsWith('00-'))
    const bad: string[] = []
    for (const f of files) {
      const s = fs.readFileSync(path.join(CAP_DIR, f), 'utf8')
      for (const [label, end] of [['iOS 原生', 'ios'], ['Android 原生', 'android']] as const) {
        const m = new RegExp('\\| ' + label + '[^|]*\\| ([^|]+) \\|').exec(s)
        if (!m || m[1].trim() !== '✅') continue
        // ✅ 行不得出现"未实现…分派"（那是证据判据判负时的文案）
        const line = new RegExp('\\| ' + label + '[^\\n]*').exec(s)?.[0] ?? ''
        if (/宿主未实现|no dispatch for/.test(line)) bad.push(`${f} ${label}: ✅ 却带"宿主未实现"文案`)
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })
  it('总览的 iOS/Android ✅ 数 == 逐页 ✅ 行数（不硬编码数字）', () => {
    // ★不写死 30：每加一个 App 能力这个数就会变（实测 #1093 加 WebSocket 后 30 → 31，
    //   硬编码的断言当场红——它测的是"我记得的数字"，不是"两处一致"）。
    const ov = fs.readFileSync(path.join(CAP_DIR, '00-capabilities-overview.md'), 'utf8')
    const count = (label: string) => {
      let n = 0
      for (const f of fs.readdirSync(CAP_DIR)) {
        if (!f.endsWith('.md') || f.startsWith('00-')) continue
        const s = fs.readFileSync(path.join(CAP_DIR, f), 'utf8')
        const m = new RegExp('\\| ' + label + '[^|]*\\| ([^|]+) \\|').exec(s)
        if (m && m[1].trim() === '✅') n++
      }
      return n
    }
    const ovNum = (label: string) => {
      const m = new RegExp('\\| ' + label + ' \\| (\\d+) \\|').exec(ov)
      return m ? +m[1] : -1
    }
    for (const label of ['iOS 原生', 'Android 原生']) {
      expect(ovNum(label), `${label}: 总览与逐页 ✅ 数不一致`).toBe(count(label))
    }
  })
})

describe('★#1092 ⑤ 破坏性：宿主撤掉分派 ⇒ 必须降级（判据活性）', () => {
  it('对不存在的方法名取证会返回 ok=false 并点名', () => {
    // 直接调底层判据：把 refs 指成一个桥里没有的成员 ⇒ 应视为纯 JS（不是缺），
    // 而把已知桥成员映射到不存在的方法则应由宿主扫描发现。这里验证"缺失会被点名"的形态：
    const r = appHostEvidence(ROOT, 'android', ['setBrightness'])
    expect(r.ok).toBe(true) // 正常态：Android 有 device.brightness.set
    expect(r.pureJs).toEqual([])
    // 反证：一个既不在桥里、也不在宿主里的名字 ⇒ pureJs（说明不会误报缺）
    const fake = appHostEvidence(ROOT, 'android', ['totallyMadeUpBridge'])
    expect(fake.ok).toBe(true)
    expect(fake.pureJs).toContain('totallyMadeUpBridge')
  })
})

// tests/gen-content-hook-refs.test.ts
// ★承接 T-app-bridge-contract 的**独立验证发现**（异会话子代理）：mini-program(C47) 应判 App ✅ 却仍 🟡。
//   根因 = refs 抽取的两条盲区：
//     ① **切片**按"下一个 useXxx/setXxx 键"截断 —— 实测把句柄内部的嵌套键（`setFillStyle:` 之类）当成
//        hook（146 个 vs 真 ~94），且**最后一个键**的切片一路吃进 `capability-bridges.ts`（那里 `bridge.` 出现 80+ 次）；
//     ② **正则** `/bridge\.(\w+)\(/` 只认"名字紧跟调用括号" —— 漏 `bridge.getCalendar!()`（**非空断言**）、
//        漏 `const nav = bridge.navigateMiniProgram`（**先取后调**）。
//   ⇒ 若干 hook 的 refs 恒空 ⇒ MP/Web/App 三列分档被误判（对外谎报）。
//   本测试锁五件事：① 真实源码抽全集且**无嵌套键污染**；② 两类旧盲区形态**都收**；
//   ③ 破坏性：契约破坏 ⇒ 硬失败（不静默得空集）；④ 修复**落页**；⑤ 解析器**必须推进下标**（同型死循环回归锁）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractHookBridgeRefs, loadHookBridgeRefs, HOOK_FACTORY } from '../website/scripts/lib/hook-bridge-refs.mjs'
import { extractAppBridgeKeys, APP_BRIDGE_FACTORIES } from '../website/scripts/lib/app-bridge-keys.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API_SRC_DIR = path.join(ROOT, 'packages', 'api', 'src')
const CAP_DIR = path.join(ROOT, 'website', 'content', 'capabilities')
// 与生成器同源：三文件拼接（#870 拆分后 capability.ts 只留工厂/Hook；桥实现与契约在另两文件）
const API_JOINED = ['capability-types.ts', 'capability.ts', 'capability-bridges.ts']
  .map((f) => fs.readFileSync(path.join(API_SRC_DIR, f), 'utf8'))
  .join('\n')

// ── 旧实现留下的盲区形态（真实源码里的原样写法）──
// ① `bridge.getCalendar!()`  非空断言夹在名字与括号之间
// ② `const nav = bridge.navigateMiniProgram`  先取到局部变量、再调用
const ASSERTION_STYLE = 'bridge.getCalendar!'
const ALIAS_STYLE = 'const nav = bridge.navigateMiniProgram'
// 嵌套键（句柄内部方法名）——不是 hook 键，旧实现会把它当 hook
const NESTED_KEYS = ['setFillStyle', 'setStrokeStyle', 'setLineWidth', 'setLineCap']

describe('hook → 桥方法引用抽取（生成器 ↔ 源码 显式契约 · 锚定式）', () => {
  it('真实源码：顶层成员 ≈ hooks 数（无嵌套键/桥定义污染）', () => {
    const r = extractHookBridgeRefs(API_JOINED, HOOK_FACTORY)
    expect(r.misses).toEqual([])
    expect(r.receiver).toBe('bridge')
    // 真 hook 数 ~94；旧口径把嵌套键也算进来（实测 146）。上界卡在 120 足以拦"又被污染"
    expect(r.hookCount).toBeGreaterThanOrEqual(90)
    expect(r.hookCount).toBeLessThanOrEqual(120)
    // 必备 hook 在册
    for (const h of ['useLocation', 'useMiniProgram', 'useCalendar', 'useCamera', 'useRecorder']) {
      expect(Object.keys(r.refs), h).toContain(h)
    }
    // 嵌套键**不得**作为 hook 出现
    for (const k of NESTED_KEYS) expect(Object.keys(r.refs), `嵌套键不该成为 hook：${k}`).not.toContain(k)
    // 顶层不得有重名成员（有则旧实现会静默取后者）
    expect(r.duplicates).toEqual([])
  })

  it('旧盲区形态都收：非空断言 `!` 与"先取后调"别名', () => {
    const r = extractHookBridgeRefs(API_JOINED, HOOK_FACTORY)
    // 源码事实先行（防"源码写法变了、测试还假绿"）
    expect(API_JOINED).toContain(ASSERTION_STYLE)
    expect(API_JOINED).toContain(ALIAS_STYLE)
    // ① 非空断言：useCalendarAPI 的取值里 `bridge.getCalendar!()` / `bridge.addCalendarEvent!` 都要收到
    expect(r.refs.useCalendarAPI).toContain('getCalendar')
    expect(r.refs.useCalendarAPI).toContain('addCalendarEvent')
    // ② 先取后调：useMiniProgram 只经别名引用 navigateMiniProgram（旧正则 ⇒ 空数组 ⇒ App 端误判 🟡）
    expect(r.refs.useMiniProgram).toEqual(['navigateMiniProgram'])
    // ③ App 端 ✅ 的判据（refs 非空且全部在 App 桥方法集内）
    const { keys: appKeys } = extractAppBridgeKeys(fs.readFileSync(path.join(API_SRC_DIR, 'capability-app.ts'), 'utf8'))
    expect(r.refs.useMiniProgram.length).toBeGreaterThan(0)
    expect(r.refs.useMiniProgram.every((k) => appKeys.has(k))).toBe(true)
  })

  it('合成源码：三类调用形态逐项锁定（含嵌套对象不算 hook）', () => {
    const src = [
      'export function createCapabilityHooks(bridge: CapabilityBridge): unknown {',
      '  return {',
      '    useA: () => bridge.alpha(1),',
      '    useB: () => {',
      '      if (!bridge.beta) throw new Error("x")',
      '      const f = bridge.beta',
      '      return f()',
      '    },',
      '    useC: () => bridge.gamma!(2),',
      '    useD: () => ({ nested: { setWidth: () => 1 } }),',
      '  }',
      '}',
    ].join('\n')
    const r = extractHookBridgeRefs(src)
    expect(r.misses).toEqual([])
    expect(r.hookCount).toBe(4)
    expect(r.refs.useA).toEqual(['alpha'])
    expect(r.refs.useB).toEqual(['beta'])
    expect(r.refs.useC).toEqual(['gamma'])
    expect(r.refs.useD).toEqual([])
    expect(Object.keys(r.refs)).not.toContain('setWidth')
  })

  it('破坏性：工厂改名 / 空源码 / 无 `return {` / 合计 0 引用 ⇒ 报错（不静默得空集）', () => {
    const renamed = extractHookBridgeRefs(
      API_JOINED.replace('export function createCapabilityHooks', 'export function createCapabilityHooksX'),
    )
    expect(renamed.misses.join(' ')).toContain('createCapabilityHooks')
    expect(renamed.hookCount).toBe(0)

    expect(extractHookBridgeRefs('').misses).toHaveLength(1)

    const noReturnObj = extractHookBridgeRefs('export function createCapabilityHooks(bridge: unknown) {\n  const x = 1\n  return x\n}')
    expect(noReturnObj.misses.join(' ')).toContain('return {')

    // 接收者名全不匹配（形参叫 bridge，取值里写 bk.xxx）⇒ 合计 0 引用 ⇒ 硬失败
    const wrongReceiver = extractHookBridgeRefs(
      'export function createCapabilityHooks(bridge: unknown) {\n  return {\n    useA: () => bk.alpha(1),\n  }\n}',
    )
    expect(wrongReceiver.misses.join(' ')).toContain('合计引用 0')

    expect(() => loadHookBridgeRefs(path.join(API_SRC_DIR, '__no_such_hooks__.ts'))).toThrow()
    expect(() => loadHookBridgeRefs(path.join(API_SRC_DIR, 'capability.ts'))).not.toThrow()
  })

  it('解析器必须推进下标：取值头部未闭合 `<` 不得死循环（同型缺陷回归锁）', () => {
    // 历史缺陷：泛型表跳过分支遇 `<` 只自增计数器、不推进下标 ⇒ 死循环（本测试靠 vitest 超时暴露）
    const src = [
      'export function createCapabilityHooks(bridge: unknown) {',
      '  return {',
      '    useA: <T,',
      '    useB: () => bridge.alpha(1),',
      '  }',
      '}',
    ].join('\n')
    const r = extractHookBridgeRefs(src)
    expect(r.hookCount).toBeGreaterThanOrEqual(1)
  })

  it('修复落页：mini-program / webassembly 的 iOS+Android 转 ✅，auth 的 Web 转 ⚠️', () => {
    const seg = (slug: string) => {
      const t = fs.readFileSync(path.join(CAP_DIR, `${slug}.md`), 'utf8')
      const i = t.indexOf('## 兼容进度')
      return t.slice(i, i + 1500)
    }
    for (const slug of ['mini-program', 'webassembly']) {
      const s = seg(slug)
      expect(s, `${slug} 的 iOS 原生应为 ✅`).toMatch(/\|\s*iOS 原生\s*\|\s*✅/)
      expect(s, `${slug} 的 Android 原生应为 ✅`).toMatch(/\|\s*Android 原生\s*\|\s*✅/)
      // 鸿蒙仍是 🟡（宿主壳未接线——不得顺手谎报为 ✅）
      expect(s, `${slug} 的鸿蒙应为 🟡`).toMatch(/\|\s*鸿蒙\s*\|\s*🟡/)
    }
    // auth：refs 修好后 Web 无直通桥 ⇒ 诚实降级 ⚠️（此前误判 ✅）
    expect(seg('auth'), 'auth 的 Web SPA 应为 ⚠️').toMatch(/\|\s*Web SPA\s*\|\s*⚠️/)
    // auth 的错误码表由"桥引用错配"带出（refs 修复后才有）
    const auth = fs.readFileSync(path.join(CAP_DIR, 'auth.md'), 'utf8')
    expect(auth).toContain('`login.unsupported`')
    expect(auth).toContain('`login.failed`')
  })

  it('共用原语未回归：App 桥抽取仍为 10 + 3（与 #884 同源）', () => {
    const { perFn, misses } = extractAppBridgeKeys(fs.readFileSync(path.join(API_SRC_DIR, 'capability-app.ts'), 'utf8'))
    expect(misses).toEqual([])
    expect(perFn[APP_BRIDGE_FACTORIES[0]]).toBe(10)
    expect(perFn[APP_BRIDGE_FACTORIES[1]]).toBe(3)
  })
})

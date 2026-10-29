// tests/gen-content-bridge-keys.test.ts
// ★承接 T-app-bridge-refs 的**独立验证发现**（异会话 AST 复算 refs 零差异时顺带抓出）：
//   keep-screen-on(C83) / document-preview(C84) 两页的 **Web+MP 共 8 格**被错标 ⚠️「桥未提供 xxx → Err 降级」。
//   根因 = 生成器的 `extractFnKeys` 只扫**手写桥**（`wxBridge` / `webBridge` 函数体），
//   而运行时桥是**两源并集**（`capability.ts` 的 `createCapabilityBridge`）：
//     `{ ...wxBridge(g.wx), ...mpBridgeExt(g.wx, CapError) }` / `{ ...webBridge(g), ...webBridgeExt(g, CapError) }`
//   声明式桥成员在 `packages/api/src/generated/bridge-ext.ts` ⇒ 漏抽 ⇒ **对外谎报**（与 #884/#889 同型）。
//   本测试锁四类：① 两源并集都收且与声明数交叉校验（含「声明数被改 0」脱节与「合法空集」两态）；
//   ② 破坏性：工厂改名 / 声明数脱节 / 生成物缺失 / 手写桥缺失 ⇒ 硬失败（不静默）；
//   ③ 手写桥口径未回归（旧行匹配名一个不丢 + 并集无额外名，双向锁）；
//   ④ 修复**落页**（8 格 ✅ + 旧谎报表述消失）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractBridgeKeys,
  loadBridgeKeys,
  HANDWRITTEN_BRIDGE_FACTORIES,
  DECLARATIVE_BRIDGE_FACTORIES,
  DECLARED_COUNT_CONST,
} from '../website/scripts/lib/bridge-keys.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API_SRC_DIR = path.join(ROOT, 'packages', 'api', 'src')
const EXT_PATH = path.join(API_SRC_DIR, 'generated', 'bridge-ext.ts')
const CAP_DIR = path.join(ROOT, 'website', 'content', 'capabilities')
const CAP_EN_DIR = path.join(ROOT, 'website', 'en', 'capabilities')

// 与生成器同源：三文件拼接（#870 拆分后手写桥在 capability-bridges.ts）
const API_JOINED = ['capability-types.ts', 'capability.ts', 'capability-bridges.ts']
  .map((f) => fs.readFileSync(path.join(API_SRC_DIR, f), 'utf8'))
  .join('\n')
const EXT_SRC = fs.readFileSync(EXT_PATH, 'utf8')

// 声明式桥成员（`bridge-decls/*.ts` 声明 → 生成器每个声明产出一个成员）
const DECLARATIVE_MEMBERS = ['setKeepScreenOn', 'openDocument']

describe('平台桥成员集抽取（生成器 ↔ 源码 显式契约 · 两源并集）', () => {
  it('真实源码：手写桥 ∪ 声明式桥，零 misses，且成员数与声明数交叉一致', () => {
    const r = extractBridgeKeys(API_JOINED, EXT_SRC)
    expect(r.misses).toEqual([])
    // 声明数 = 成员数（生成器对每个声明恰好产出一个成员）——两侧各自校验
    expect(r.declaredCount).toBeGreaterThanOrEqual(DECLARATIVE_MEMBERS.length)
    for (const fn of Object.values(DECLARATIVE_BRIDGE_FACTORIES)) {
      expect(r.perFn[fn], fn).toBe(r.declaredCount)
    }
    // 手写桥口径未回归（#889 时实测 89 / 71）
    expect(r.perFn[HANDWRITTEN_BRIDGE_FACTORIES.wx]).toBeGreaterThanOrEqual(85)
    expect(r.perFn[HANDWRITTEN_BRIDGE_FACTORIES.web]).toBeGreaterThanOrEqual(65)
    // 并集 = 手写 + 声明式（不重名，故为相加）
    expect(r.wxKeys.size).toBe(r.perFn[HANDWRITTEN_BRIDGE_FACTORIES.wx] + r.declaredCount)
    expect(r.webKeys.size).toBe(r.perFn[HANDWRITTEN_BRIDGE_FACTORIES.web] + r.declaredCount)
  })

  it('声明式成员两列都收（漏抽 ⇒ MP/Web 误标 ⚠️ 的根因）', () => {
    const r = extractBridgeKeys(API_JOINED, EXT_SRC)
    for (const m of DECLARATIVE_MEMBERS) {
      expect(r.wxKeys.has(m), `wxKeys 应含声明式成员 ${m}`).toBe(true)
      expect(r.webKeys.has(m), `webKeys 应含声明式成员 ${m}`).toBe(true)
    }
    // 手写桥成员仍在（并集不是替换）
    expect(r.wxKeys.has('getLocation')).toBe(true)
    expect(r.webKeys.has('getLocation')).toBe(true)
    // 只在生成物里出现的成员，手写桥里没有（两源确实不同——防"扫描器把生成物当手写桥"）
    expect(API_JOINED).not.toContain('function mpBridgeExt')
    expect(API_JOINED).not.toContain('function webBridgeExt')
  })

  it('破坏性：手写桥工厂改名 ⇒ 报错（不静默得空集）', () => {
    const renamed = extractBridgeKeys(
      API_JOINED.replace('export function wxBridge', 'export function wxBridgeX'),
      EXT_SRC,
    )
    expect(renamed.misses.join(' ')).toContain('wxBridge')
    expect(renamed.wxKeys.has('getLocation')).toBe(false)
  })

  it('破坏性：声明式工厂改名 / 声明数脱节 / 生成物缺失 ⇒ 报错', () => {
    // ① 工厂改名
    const renamedExt = EXT_SRC.replace('export function mpBridgeExt', 'export function mpBridgeExtX')
    expect(extractBridgeKeys(API_JOINED, renamedExt).misses.join(' ')).toContain('mpBridgeExt')

    // ② 声明数与解析到的成员数脱节（生成物被手改 / 生成器与解析器不同步）
    const offByOne = EXT_SRC.replace(new RegExp(`(${DECLARED_COUNT_CONST} = )\\d+`), (_, p1: string) => `${p1}3`)
    const r2 = extractBridgeKeys(API_JOINED, offByOne)
    expect(r2.misses.join(' ')).toContain(DECLARED_COUNT_CONST)

    // ③ 生成物源码为空（拿不到声明数）
    expect(extractBridgeKeys(API_JOINED, '').misses.join(' ')).toContain(DECLARED_COUNT_CONST)

    // ④ 手写桥源码为空 ⇒ 两个工厂都报「函数未找到」
    expect(extractBridgeKeys('', EXT_SRC).misses).toHaveLength(2)

    // ⑤ ★声明数被改成 0 而工厂实含成员 ⇒ 仍须报「脱节」（独立验证抓出的盲区：曾整段跳过解析）
    const zeroCount = EXT_SRC.replace(new RegExp(`(${DECLARED_COUNT_CONST} = )\\d+`), (_, p1: string) => `${p1}0`)
    const r5 = extractBridgeKeys(API_JOINED, zeroCount)
    expect(r5.misses.join(' ')).toContain(DECLARED_COUNT_CONST)
    // ⑥ 真·合法空集（声明 0 + 工厂 `return {}`）⇒ **不**报错
    const emptyExt = [
      `export const ${DECLARED_COUNT_CONST} = 0`,
      'export function mpBridgeExt(): unknown {',
      '  return {',
      '  }',
      '}',
      'export function webBridgeExt(): unknown {',
      '  return {',
      '  }',
      '}',
    ].join('\n')
    expect(extractBridgeKeys(API_JOINED, emptyExt).misses).toEqual([])
  })

  it('loadBridgeKeys：生成物/手写桥源缺失 ⇒ 抛错；真实文件 ⇒ 不抛错', () => {
    const handPath = path.join(API_SRC_DIR, 'capability-bridges.ts')
    expect(() => loadBridgeKeys(path.join(API_SRC_DIR, '__no_such_bridge__.ts'), EXT_PATH)).toThrow()
    expect(() => loadBridgeKeys(handPath, path.join(API_SRC_DIR, 'generated', '__no_such_ext__.ts'))).toThrow()
    const r = loadBridgeKeys(handPath, EXT_PATH)
    expect(r.misses).toEqual([])
    for (const m of DECLARATIVE_MEMBERS) expect(r.webKeys.has(m)).toBe(true)
  })

  it('手写桥口径未回归：旧「行匹配」成员一个不丢，且并集不含额外名字（双向锁）', () => {
    // 旧实现（已删）：indexOf 切片到行首 `}` + /^ {4}([a-zA-Z]+):/gm
    const legacy = (src: string, fnName: string) => {
      const start = src.indexOf(`function ${fnName}`)
      if (start < 0) return new Set<string>()
      const rest = src.slice(start)
      const endM = rest.search(/^}/m)
      const body = endM >= 0 ? rest.slice(0, endM) : rest
      return new Set([...body.matchAll(/^ {4}([a-zA-Z]+):/gm)].map((x) => x[1]))
    }
    const r = extractBridgeKeys(API_JOINED, EXT_SRC)
    for (const [side, fn] of Object.entries(HANDWRITTEN_BRIDGE_FACTORIES)) {
      const old = legacy(API_JOINED, fn)
      const union = r[side === 'wx' ? 'wxKeys' : 'webKeys']
      // ① 旧口径成员一个不丢（漏抽 ⇒ 红）
      for (const k of old) expect(union.has(k), `${fn} 旧口径成员 ${k} 应在并集中`).toBe(true)
      // ② 反向：并集不得含「旧口径 ∪ 声明式」之外的额外名字（多抽 ⇒ 红）——单向子集断言看不出这一类
      const extras = [...union].filter((k) => !old.has(k) && !DECLARATIVE_MEMBERS.includes(k))
      expect(extras, `${fn} 并集出现旧口径/声明式之外的额外名字`).toEqual([])
      // ③ 数量自洽 ⇒ 两侧合起来即「双向逐名一致」
      expect(union.size).toBe(old.size + r.declaredCount)
    }
  })

  it('修复落页：keep-screen-on / document-preview 的 Web + MP 转 ✅（zh + en），旧谎报表述消失', () => {
    for (const dir of [CAP_DIR, CAP_EN_DIR]) {
      // zh 用「## 兼容进度」，en 用「## Compat rollout」——取存在的那个
      const seg = (slug: string) => {
        const t = fs.readFileSync(path.join(dir, `${slug}.md`), 'utf8')
        const zh = t.indexOf('## 兼容进度')
        return t.slice(zh >= 0 ? zh : t.indexOf('## Compat rollout'))
      }
      for (const slug of ['keep-screen-on', 'document-preview']) {
        const s = seg(slug)
        expect(s, `${dir}/${slug} 的 Web 应为 ✅`).toMatch(/\|\s*(Web SPA)\s*\|\s*✅/)
        expect(s, `${dir}/${slug} 的 MP 应为 ✅`).toMatch(/\|\s*(微信小程序|WeChat Mini Program)\s*\|\s*✅/)
        /* ★★#1384（2026-10-29）：**不再写死 App 列的具体状态**。
           原写法 `expectIos = slug === 'keep-screen-on' ? '✅' : '🟡'` 把
           「document-preview 的 openDocument 未接」当成了判据本身——而 #1384 把它真接上后，
           这条断言反过来**惩罚真接线**（注释自己就写着"写死 🟡 会让真接线被测试反向惩罚"，
           结果还是写死了）。⇒ 本判据只守它**真正关心**的两件事（见本用例标题）：
             · Web + MP 两列 ✅（这是 NC1 修复的落点）；
             · 旧"桥未提供"谎报表述消失（这是漏抽造成的）。
           App 列的状态由 `app-bridge-keys` / `harmony-host-keys` 的**源码派生**决定，
           那边有各自的判据（`gen-content-harmony-host` / `appEndStatus`），不在这里重复锁死。 */
        const iosCell = new RegExp(`\\|\\s*(iOS 原生|iOS native)\\s*\\|\\s*([^|]+)\\|`).exec(s)
        expect(iosCell, `${dir}/${slug} 应有 iOS 行`).toBeTruthy()
        expect(
          ['✅', '🟡', '⚠️', '⬜'].some((m) => iosCell![2]!.includes(m)),
          `${dir}/${slug} 的 iOS 状态应是合法枚举之一（实得：${iosCell![2]?.trim().slice(0, 40)}）`,
        ).toBe(true)
      }
      // 旧的「桥未提供」表述在这两页必须消失（那是漏抽造成的谎报）
      for (const slug of ['keep-screen-on', 'document-preview']) {
        const t = fs.readFileSync(path.join(dir, `${slug}.md`), 'utf8')
        expect(t).not.toMatch(/(wx 桥未提供|webBridge 未提供|wx bridge missing|webBridge missing)/)
      }
    }
  })
})

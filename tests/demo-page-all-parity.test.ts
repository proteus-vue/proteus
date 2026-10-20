// tests/demo-page-all-parity.test.ts
// ★★★#1129：**全部 27 个 showcase 能力页**的「文档 vs 实现」对齐门禁
//
// 【#1128 暴露的缺口（本单要补的）】
//   #1128 只给 `fetch` 一页加了"数据表 vs 实现"判据，因为只有它有 `FetchConfig` 这样的
//   可机读类型源。其它 26 页的 API 数据表是手写的 ⇒ **无人校验**，可以任意落后于实现。
//   ⇒ 本文件用三类可机读源覆盖全部 27 页：
//     ① `CapabilityHooks`（capability.ts）——页面声称的 hook 必须真实存在；
//     ② `PAGE_TYPE_SSOT`（每页 data 结构的接口名）——接口必须真实存在；
//     ③ 接口属性表——页面声称的 `data.X` 字段必须在那个接口里存在。
//
// 【★本单最重要的产出其实是抽取器（`lib/ts-ifaces.mjs`）】
//   首版抽取器用带可选 JSDoc 前缀的正则，`[\s\S]*?` 会跨越**前一个接口**去凑匹配 ⇒
//   181 个接口有一批取错体，把 `NetworkType.online`、`CapDeviceInfo.platform`、
//   `BatteryInfo.level`、`OrientationInfo.angle`、`ScreenInfo.dpr` 等**真实存在的字段**
//   判成"不存在"（8 处假红）。
//   ★教训（本仓第 7 次同族）：**判据的解析器必须先自证**——抽取器错了，
//     它报的每一条红都是噪音，而"把假红当真缺陷去改文档"会把正确的文档改错。
//   ⇒ 本文件第一条 describe 就是抽取器的自检（钉住那几个曾经假红的接口/字段）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

const DEMO_GEN = 'scripts/gen-capability-demo-pages.mjs'
const HOOKS_SRC = 'packages/api/src/capability.ts'
const TYPES_SRC = 'packages/api/src/capability-types.ts'
const FETCH_TYPES_SRC = 'packages/api/src/capability-fetch-types.ts'
// ★#1129：AppLifecycle / PageLifecycle 是 alias → capability-app.ts 的 *Handle 接口
const APP_SRC = 'packages/api/src/capability-app.ts'

async function ifacesLib() {
  return (await import('../website/scripts/lib/ts-ifaces.mjs')) as unknown as {
    extractInterfaces: (s: string) => Record<string, { props: Array<{ name: string; type: string }>; methods: Array<{ name: string }> }>
    propsOf: (t: Record<string, { props: Array<{ name: string }> }>, n: string) => Set<string>
    resolveAlias: <T>(t: T) => T
  }
}

/** 从生成器数据表解析出每页的 `{ file, apiRows, compatRows }`。 */
function parsePages(): Array<{ file: string; apiRows: string[][] }> {
  const src = read(DEMO_GEN)
  const out: Array<{ file: string; apiRows: string[][] }> = []
  const re = /file: '([\w-]+)',[\s\S]*?api: \[([\s\S]*?)\n    \],/g
  let m
  while ((m = re.exec(src))) {
    const file = m[1]
    const body = m[2]
    const apiRows: string[][] = []
    for (const rowM of body.matchAll(/\[(\s*'[^\]]*?)\]/g)) {
      // 逐行用可行的 JSON-ish 解析：取三个单引号/双引号字符串
      const strs = [...rowM[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2])
      if (strs.length >= 2) apiRows.push(strs)
    }
    out.push({ file, apiRows })
  }
  return out
}

/** `CapabilityHooks` 声明的成员名集合。 */
function declaredHooks(): Set<string> {
  const s = read(HOOKS_SRC)
  const start = s.indexOf('export interface CapabilityHooks')
  expect(start, '找不到 CapabilityHooks').toBeGreaterThan(0)
  const body = s.slice(start, s.indexOf('\n}', start))
  return new Set([...body.matchAll(/^\s+(\w+)\s*(?:<[^(]*>)?\s*[(<]/gm)].map((m) => m[1]))
}

describe('★★#1129 抽取器自检（它错了，所有红都是噪音）', () => {
  it('★曾假红的 8 个字段必须能抽出来（首版正则跨接口凑匹配导致）', async () => {
    const { extractInterfaces, propsOf } = await ifacesLib()
    const t = extractInterfaces(read(TYPES_SRC))
    const cases: Array<[string, string]> = [
      ['NetworkType', 'online'],
      ['CapDeviceInfo', 'platform'],
      ['CapDeviceInfo', 'model'],
      ['CapDeviceInfo', 'os'],
      ['BatteryInfo', 'level'],
      ['BatteryInfo', 'charging'],
      ['OrientationInfo', 'angle'],
      ['ScreenInfo', 'dpr'],
    ]
    for (const [iface, field] of cases) {
      expect(propsOf(t, iface).has(field), `★${iface}.${field} 抽不出来（抽取器回归）`).toBe(true)
    }
  })

  it('接口数量必须稳定（漏抽会静默缩小覆盖面）', async () => {
    const { extractInterfaces } = await ifacesLib()
    const t = extractInterfaces(read(TYPES_SRC))
    expect(Object.keys(t).length, '★接口抽少了（抽取器回归）').toBeGreaterThan(150)
  })
})

describe('★#1129 27 页 · hook 必须真实存在', () => {
  it('★★每页声称的 hook 都在 CapabilityHooks 里', () => {
    const hooks = declaredHooks()
    expect(hooks.size, 'CapabilityHooks 没解析出成员').toBeGreaterThan(50)
    const pages = parsePages()
    expect(pages.length, '页数解析异常').toBe(27)
    const bad: string[] = []
    for (const p of pages) {
      const first = p.apiRows[0]?.[0] ?? ''
      const hm = /^(\w+)\s*[<(]/.exec(first)
      if (!hm) { bad.push(`${p.file}: 首页 API 行不是 hook 形态（${first}）`); continue }
      if (!hooks.has(hm[1])) bad.push(`${p.file}: 声称 ${hm[1]}()，但 CapabilityHooks 里没有`)
    }
    expect(bad, `★文档声称了不存在的 hook：\n${bad.join('\n')}`).toEqual([])
  })
})

describe('★#1129 27 页 · data 结构必须对得上实现', () => {
  it('★★PAGE_TYPE_SSOT 里声明的接口必须真实存在', async () => {
    const { extractInterfaces, resolveAlias } = await ifacesLib()
    const all = resolveAlias({
      ...extractInterfaces(read(TYPES_SRC)),
      ...extractInterfaces(read(FETCH_TYPES_SRC)),
      ...extractInterfaces(read(APP_SRC)),
    })
    const { PAGE_TYPE_SSOT } = (await import('../website/scripts/lib/demo-page-type-ssot.mjs')) as unknown as {
      PAGE_TYPE_SSOT: Record<string, string | null>
    }
    const pages = parsePages()
    const missing: string[] = []
    for (const p of pages) {
      if (!(p.file in PAGE_TYPE_SSOT)) { missing.push(`${p.file}: 未在 PAGE_TYPE_SSOT 登记`); continue }
      const t = PAGE_TYPE_SSOT[p.file]
      if (t === null) continue // 显式声明"无单一接口"
      if (t === 'string') continue // 基本类型
      if (!all[t]) missing.push(`${p.file}: 声明的 ${t} 接口不存在（改名了？）`)
    }
    expect(missing, `★映射表与实现脱节：\n${missing.join('\n')}`).toEqual([])
  })

  it('★★页面声称的 `data.X` 字段必须在该页接口里存在', async () => {
    const { extractInterfaces, propsOf, resolveAlias } = await ifacesLib()
    const all = resolveAlias({
      ...extractInterfaces(read(TYPES_SRC)),
      ...extractInterfaces(read(FETCH_TYPES_SRC)),
      ...extractInterfaces(read(APP_SRC)),
    })
    const { PAGE_TYPE_SSOT } = (await import('../website/scripts/lib/demo-page-type-ssot.mjs')) as unknown as {
      PAGE_TYPE_SSOT: Record<string, string | null>
    }
    const pages = parsePages()
    const bad: string[] = []
    for (const p of pages) {
      const t = PAGE_TYPE_SSOT[p.file]
      if (!t || t === 'string') continue
      const props = propsOf(all, t)
      if (!props.size) continue // 空接口/句柄型，跳过
      for (const row of p.apiRows) {
        const field = /^data\.(\w+)/.exec(row[0] ?? '')?.[1]
        if (!field) continue
        if (!props.has(field)) bad.push(`${p.file}: 声称 data.${field}，但 ${t} 里没有（实际有：${[...props].join(',')}）`)
      }
    }
    expect(bad, `★文档声称了不存在的字段：\n${bad.join('\n')}`).toEqual([])
  })

  it('★每个 demo 页都必须登记在 PAGE_TYPE_SSOT（新增页不能绕过门禁）', async () => {
    const { PAGE_TYPE_SSOT } = (await import('../website/scripts/lib/demo-page-type-ssot.mjs')) as unknown as {
      PAGE_TYPE_SSOT: Record<string, string | null>
    }
    const pages = parsePages()
    const unregistered = pages.map((p) => p.file).filter((f) => !(f in PAGE_TYPE_SSOT))
    expect(unregistered, `★这些页没登记（门禁覆盖不到）：${unregistered.join(', ')}`).toEqual([])
  })
})

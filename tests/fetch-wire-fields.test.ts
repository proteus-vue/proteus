// tests/fetch-wire-fields.test.ts
// ★★★决策 #1134：**"从门面到线格式"的字段清单必须逐层齐全**——静态判据。
//
// 【它守的是什么（本轮真机抓出来的真缺陷）】
//   `useFetch` 的配置要穿过**四层**才到宿主：
//     ① `FetchConfig`（门面类型）
//     ② `runFetch`（桥调用参数白名单）
//     ③ `appHttpRequest`（App 端 args 白名单）
//     ④ `splitFramePayload`（线格式 meta 归类）
//   每层都是**显式白名单**（不能 spread：未识别字段会被当业务体塞进请求 body）。
//   ⇒ 新增字段漏某一层 = "底层做了、门面传了、**中间吃掉**"——功能静默失效且不报错。
//
//   ★本轮实测：`redirectManual` 在前三层都加了，**唯独第 ③ 层没加**
//     ⇒ 真机读数 `manual_status=200`（宿主照旧跟随）、`cross_seen_count=0`（跨域请求没发）。
//     这条链此前**零判据**，只能靠"构建 + 装真机 + 跑探针"（≈5 分钟一轮）发现。
//
// 【判据口径（三轮修正后——每轮都是"判据自己错"）】
//   Ⅰ 首版用 `/key\s*:/` 抽键 ⇒ `url`（shorthand 写法 `{ url, method }`）抽不到（假红）；
//   Ⅱ 把 `onChunk`/`signal` 也要求出现在 `splitFramePayload` 的字段判定里 ⇒ 它们其实由
//      `appHttpRequest` 分派（流式走 `invokeHostStream`、取消走 signal 参数）而非 meta 归类（假红）；
//   Ⅲ 把 `redirect`/`maxRedirects`/`onRedirect` 列为"不得下传" ⇒ 但 `runFetch` 必须传它们
//      （管线靠 `runFetch` 的**结果**判断是否 3xx，这些字段要能到 web 腿）⇒ 只对 `appHttpRequest`
//      断言"不得下传"（App 腿的线格式没有这些 tag，传了会落进 body）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const LAYERS = {
  runFetch: 'packages/api/src/capability-fetch.ts',
  appRequest: 'packages/api/src/capability-app-request.ts',
  splitFrame: 'packages/api/src/capability-invoke.ts',
  fetchTypes: 'packages/api/src/capability-fetch-types.ts',
} as const

/** 必须下传到**宿主**的字段（线格式 meta 层要有）。 */
const WIRE_FIELDS = [
  'url',
  'method',
  'data',
  'params',
  'headers',
  'timeout',
  'responseType',
  'savePath',
  'onChunk',
  'upload',
  'signal',
  'redirectManual', // ★#1134
]

/** 只在 `FetchConfig` / `runFetch` 层出现、**不落到 App 线格式**的字段。 */
const APP_LAYER_EXCLUDED = ['onChunk', 'signal'] // 由 invokeHostStream / 参数通道处理，不进 meta
const PIPELINE_ONLY_APP = ['retry', 'priority', 'maxRedirects', 'onRedirect'] // 管线字段，App 腿不该有

/**
 * 从对象字面量里抽**键名**（同时支持 `k: v` 与 shorthand `k`）。
 * ★vs 首版：首版只认 `k:` ⇒ `{ url, method }` 的 url 抽不到。
 */
function objectKeys(src: string, startMarker: string): string[] {
  const at = src.indexOf(startMarker)
  if (at < 0) return []
  const braceAt = src.indexOf('{', at)
  if (braceAt < 0) return []
  let depth = 0
  let end = -1
  for (let i = braceAt; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return []
  const body = src.slice(braceAt + 1, end)
  const keys: string[] = []
  // 顶层按逗号切（值里可能含 `?.` / 三元 / 字符串，但本仓这些 args 对象都是扁平 key: value）
  for (const part of body.split(',')) {
    const t = part.trim()
    if (!t || t.startsWith('//') || t.startsWith('/*')) continue
    const m = /^([a-zA-Z_$][\w$]*)\s*(?::|$)/.exec(t)
    if (m) keys.push(m[1]!)
  }
  return keys
}

describe('★★#1134 门面 → 线格式：字段白名单必须逐层齐全', () => {
  it('★runFetch 的桥参数含全部线上字段（漏 = 底层做了门面传不到）', () => {
    const keys = objectKeys(src(LAYERS.runFetch), 'const r = await bridge.request({')
    expect(keys.length, `没解析到参数对象（源码形态变了？）：${LAYERS.runFetch}`).toBeGreaterThan(5)
    const missing = WIRE_FIELDS.filter((f) => !keys.includes(f))
    expect(missing, `★runFetch 漏传：${missing.join(', ')}`).toEqual([])
  })

  it('★★App 端 args 含全部**线格式**字段（本轮真机就是在这里漏了 redirectManual）', () => {
    const keys = objectKeys(src(LAYERS.appRequest), 'const args = {')
    expect(keys.length, `没解析到 args 对象：${LAYERS.appRequest}`).toBeGreaterThan(5)
    const need = WIRE_FIELDS.filter((f) => !APP_LAYER_EXCLUDED.includes(f))
    const missing = need.filter((f) => !keys.includes(f))
    expect(missing, `★appHttpRequest 漏传：${missing.join(', ')}（功能会静默失效）`).toEqual([])
  })

  it('★线格式 meta 归类认得 meta 类字段（漏 = 落到请求 body 里）', () => {
    const s = src(LAYERS.splitFrame)
    const metaFields = WIRE_FIELDS.filter((f) => !APP_LAYER_EXCLUDED.includes(f))
    const missing = metaFields.filter((f) => {
      if (new RegExp(`['"]${f}['"]`).test(s)) return false
      if (new RegExp(`META_(?:STR|HEADERS|ENUM)[^\\n]*\\b${f}\\b`).test(s)) return false
      return true
    })
    expect(missing, `★splitFramePayload 不认识：${missing.join(', ')}（会被当业务体塞进 body）`).toEqual([])
  })

  it('★★管线字段**不得**出现在 App 线格式 args（线格式没有这些 tag）', () => {
    const keys = objectKeys(src(LAYERS.appRequest), 'const args = {')
    const leaked = PIPELINE_ONLY_APP.filter((f) => keys.includes(f))
    expect(leaked, `★appHttpRequest 把管线字段下传了：${leaked.join(', ')}`).toEqual([])
  })

  it('★门面类型里这些字段都存在（防"判据通过但类型没声明"）', () => {
    const s = src(LAYERS.fetchTypes)
    // ★`url` 不在 `FetchConfig` 里是**正当设计**：它是 `useFetch(url, config)` 的**首参**
    //   （与 wx.request 的 `{url}` 扁平对象不同——我们把"资源"和"选项"分开）。
    //   ⇒ 只断言其余字段；写在这里是为了让后来者知道这不是漏。
    const inConfig = WIRE_FIELDS.filter((f) => f !== 'url')
    for (const f of inConfig) {
      expect(new RegExp(`\\b${f}\\??\\s*:`).test(s), `FetchConfig 缺字段 ${f}`).toBe(true)
    }
    // 反向：url 确实**不该**在 config 里（防有人"顺手加上"制造两套来源）
    expect(/\burl\??\s*:/.test(s), 'FetchConfig 不该有 url（它是首参）').toBe(false)
  })
})

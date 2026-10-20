// tests/demo-page-api-parity.test.ts
// ★★★#1128：**showcase 能力页的 API 表必须与实现对齐**（防"演示页落后于实现"）
//
// 【为什么需要（本轮实证）】
//   `showcase/subpackages/capabilities/pages/fetch.vue` 的 API 表此前写着：
//     · `config.timeout` —— 「★诚实边界：契约已声明，两端桥当前均未接线（超时不会主动中止请求）」
//     · 返回 `CapResult<T>` · 错误码只列 `fetch.failed` / `fetch.unsupported`
//   而 #1122/#1127 早已：接上 timeout、返回 `FetchResult<T>`（带 status/headers）、
//   错误码扩到 5 个、新增 responseType/savePath/onChunk/upload/signal。
//   ⇒ **演示页在教用户"这个能力做不到"，而实际已经能做** —— 比"文档缺失"更糟：
//     它会让用户在能用的能力上主动放弃。
//
// 【★为什么现有门禁拦不住】
//   `check:capability-demo` 只比"生成的 .vue 与数据表是否一致"——
//   数据表**自己**落后时，两边一致，它照样说 OK。
//   ⇒ 必须有一条**独立于数据表**的判据：拿 `FetchConfig` 的真实字段去对 API 表。
//
// 【判据（克制，避免假红）】
//   只检查 `fetch` 一页（其它能力页的"实现侧 SSOT"还没有可机读的字段表）。
//   对 `FetchConfig` 的每个字段，要求 API 表里**提到**该字段名（`config.<字段>` 或 `<字段>`）。
//   ★提到 ≠ 描述准确（那需要语义理解），但能抓住"整条没写"这种最常见形态。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

const GEN = 'scripts/gen-capability-demo-pages.mjs'
const PAGE = 'showcase/subpackages/capabilities/pages/fetch.vue'
const TYPES = 'packages/api/src/capability-fetch-types.ts'

/** 从 `FetchConfig` 抽字段名（行级，跳过注释/方法）。 */
function fetchConfigFields(src: string): string[] {
  const start = src.indexOf('export interface FetchConfig')
  if (start < 0) return []
  const body = src.slice(start, src.indexOf('\n}', start))
  const out: string[] = []
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('/**') || t.startsWith('*') || t.startsWith('//')) continue
    const m = t.match(/^(?:readonly\s+)?(\w+)\??\s*:/)
    if (m) out.push(m[1])
  }
  return out
}

describe('★#1128 demo 页 API 表必须覆盖 FetchConfig 的全部字段', () => {
  it('★每个 FetchConfig 字段都要在 fetch 演示页的 API 表里出现', () => {
    const fields = fetchConfigFields(read(TYPES))
    expect(fields.length, '没解析出 FetchConfig 字段').toBeGreaterThan(5)
    const page = read(PAGE)
    // ★只要求"名字出现过"太松（实测：删掉 `config.responseType` 那行后，
    //   "微信小程序 … wx.request（timeout + responseType）" 这行仍让断言通过）。
    //   ⇒ 要求 API 表里出现 **`config.<字段>`** 形态（那就是 API 表的行首约定）。
    // ★API 表允许**合并写法**（`config.method / data`、`config.params / headers`）⇒
    //   判定为"该行以 `config.` 开头且后面若干字段里包含它"。
    const apiLines = page.split('\n').filter((l) => l.includes('config.'))
    const missing = fields.filter((f) => {
      // 行内 `config.X / Y / Z` 拆分：取所有 `config.` 之后到分隔符之间的标识符
      for (const line of apiLines) {
        const seg = line.slice(line.indexOf('config.'))
        const names: string[] = seg.match(/\b[A-Za-z_]\w*\b/g) ?? []
        if (names.includes(f)) return false
      }
      return true
    })
    expect(
      missing,
      `★这些字段在实现里有、但演示页 API 表没提：${missing.join(', ')} —— 用户会以为不存在`,
    ).toEqual([])
  })

  it('★★不得再出现"timeout 未接线"这类**过时的事实错误**', () => {
    const page = read(PAGE)
    // 这条是 #1122 已修的事实：Web 用 AbortController、MP 传 wx.request
    expect(page, '★演示页仍写着"timeout 未接线"——这是过时的事实错误').not.toMatch(/未接线|不会主动中止/)
  })

  it('★返回类型必须写 FetchResult（不是旧的 CapResult）', () => {
    const page = read(PAGE)
    expect(page, '★演示页仍标 CapResult<T>，与实现（FetchResult<T>）不符').toMatch(/FetchResult/)
    // status/headers 是 #1122 新增的、用户最关心的
    expect(page, '★API 表没提 status/headers（业务无法知道能拿到状态码）').toMatch(/res\.status/)
  })

  it('★错误码要列全（aborted / timeout / failed / unsupported）', () => {
    const page = read(PAGE)
    for (const code of ['fetch.aborted', 'fetch.timeout', 'fetch.failed', 'fetch.unsupported']) {
      expect(page.includes(code), `★演示页缺错误码 ${code}`).toBe(true)
    }
  })

  it('生成物与数据表一致（防止改了数据表忘了重生成）', () => {
    const demoSrc = read(GEN)
    // 数据表里也要覆盖字段名（页面是它的产物）
    const fields = fetchConfigFields(read(TYPES))
    const missing = fields.filter((f) => !new RegExp(`\\b${f}\\b`).test(demoSrc))
    expect(missing, `★数据表（生成器源）缺字段：${missing.join(', ')}`).toEqual([])
  })
})

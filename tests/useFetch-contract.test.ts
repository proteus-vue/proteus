// tests/useFetch-contract.test.ts
// ★★★#1122：**走 useFetch 公共门面**的契约判据（不是打底层 `invokeHost*`）
//
// 【为什么必须有这一层（它防的是本单修的那类缺陷）】
//   本轮此前 109 条测试全在打底层（`invokeHostAsync` / `invokeHostStream` / `createAppDownload` …），
//   而 **`useFetch` 这个公共入口一条都没有** ⇒ 于是"底层做了 S3、门面只透传 6 字段、
//   status/headers 被丢弃"这四类缺口**全都能在测试全绿的情况下活着**。
//   ⇒ 本文件只走 `makeCapabilityHooks` / `useFetch`，验证**业务真正看到的那个面**。
//
// 【要证明什么】
//   ① 五个 S3 字段（responseType/savePath/onChunk/upload/signal）**真的传到了桥**；
//   ② 返回值带 `status` / `headers`（此前只有 `data`）；
//   ③ `{ data }` 解构**保持兼容**（不能因为加字段破坏既有写法）；
//   ④ 失败不抛异常（G-32.3），且错误码可区分（`fetch.unsupported` / `fetch.aborted` / `fetch.timeout`）；
//   ⑤ Web/MP 两条腿对做不到的语义**明确报 unsupported**（不静默忽略）。
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** 构造一个捕获入参的假桥（只实现 request）。 */
function bridgeStub(reply: { data?: unknown; status?: number; headers?: Record<string, string> } = {}) {
  const seen: Record<string, unknown>[] = []
  return {
    seen,
    bridge: {
      request: (config: Record<string, unknown>) => {
        seen.push(config)
        return Promise.resolve({
          data: reply.data === undefined ? { ok: 1 } : reply.data,
          status: reply.status ?? 200,
          headers: reply.headers ?? { 'x-trace': 'T1' },
          config,
        })
      },
    },
  }
}

/** 动态引入 hooks 工厂（避免顶层 import 拉进整个能力树）。 */
async function makeHooks(bridge: unknown): Promise<{ useFetch: <T>(u: string, c?: unknown) => Promise<unknown> }> {
  const mod = (await import('../packages/api/src/capability')) as unknown as {
    createCapabilityHooks: (b: unknown, m?: unknown) => { useFetch: <T>(u: string, c?: unknown) => Promise<unknown> }
  }
  return mod.createCapabilityHooks(bridge, undefined)
}

describe('★#1122 useFetch 门面 · 五个 S3 字段真的传下去了', () => {
  it('★responseType / savePath / onChunk / upload / signal 全部到达桥', async () => {
    const { bridge, seen } = bridgeStub()
    const h = await makeHooks(bridge)
    const onChunk = (): void => {}
    const signal = { aborted: false }
    await h.useFetch('/x', {
      responseType: 'arraybuffer',
      savePath: 'download/a.bin',
      onChunk,
      upload: { path: 'u/a.bin', fieldName: 'file', filename: 'a.bin', boundary: 'B1' },
      signal,
    })
    const got = seen[0] as Record<string, unknown>
    expect(got.responseType, '★responseType 未透传（底层做了也白做）').toBe('arraybuffer')
    expect(got.savePath, '★savePath 未透传').toBe('download/a.bin')
    expect(got.onChunk, '★onChunk 未透传 ⇒ 流式业务够不着').toBe(onChunk)
    expect(got.upload, '★upload 未透传').toEqual({
      path: 'u/a.bin', fieldName: 'file', filename: 'a.bin', boundary: 'B1',
    })
    expect(got.signal, '★signal 未透传 ⇒ 取消够不着').toBe(signal)
  })

  it('旧字段仍然照传（不因新增而回归）', async () => {
    const { bridge, seen } = bridgeStub()
    const h = await makeHooks(bridge)
    await h.useFetch('/y', { method: 'POST', data: { a: 1 }, params: { p: '1' }, headers: { h: 'v' }, timeout: 5000 })
    const got = seen[0] as Record<string, unknown>
    expect(got.method).toBe('POST')
    expect(got.data).toEqual({ a: 1 })
    expect(got.params).toEqual({ p: '1' })
    expect(got.headers).toEqual({ h: 'v' })
    expect(got.timeout).toBe(5000)
  })
})

describe('★#1122 useFetch 门面 · 返回值不再丢 status/headers', () => {
  it('★成功时带 status 与 headers（此前只有 data ⇒ 无法区分 404/500）', async () => {
    const { bridge } = bridgeStub({ data: { v: 1 }, status: 404, headers: { 'x-a': 'b' } })
    const h = await makeHooks(bridge)
    const r = (await h.useFetch('/x')) as { ok: boolean; data: unknown; status: number; headers: Record<string, string> }
    expect(r.ok).toBe(true)
    expect(r.status, '★status 被丢弃了').toBe(404)
    expect(r.headers, '★headers 被丢弃了').toEqual({ 'x-a': 'b' })
    expect(r.data).toEqual({ v: 1 })
  })

  it('★`{ data }` 解构保持兼容（既有写法不能坏）', async () => {
    const { bridge } = bridgeStub({ data: { hello: 'world' } })
    const h = await makeHooks(bridge)
    const { data } = (await h.useFetch('/x')) as { data: unknown }
    expect(data).toEqual({ hello: 'world' })
  })
})

describe('★#1122 useFetch 门面 · 失败不抛 + 错误码可区分', () => {
  it('桥缺失 ⇒ ok:false + fetch.unsupported（不抛异常，G-32.3）', async () => {
    const h = await makeHooks({})
    const r = (await h.useFetch('/x')) as { ok: boolean; error: { code: string } }
    expect(r.ok).toBe(false)
    expect(r.error.code).toBe('fetch.unsupported')
  })

  it('★取消/超时/失败三者的码必须可区分（业务据此决定是否重试）', async () => {
    for (const code of ['fetch.aborted', 'fetch.timeout', 'fetch.failed']) {
      const h = await makeHooks({
        request: () => Promise.reject(Object.assign(new Error(code), { code })),
      })
      const r = (await h.useFetch('/x')) as { ok: boolean; error: { code: string } }
      expect(r.ok).toBe(false)
      expect(r.error.code, `码 ${code} 未如实透出`).toBe(code)
    }
  })
})

describe('★#1122 Web / MP 腿 · 做不到的语义必须明确报 unsupported', () => {
  const LEGS = 'packages/api/src/capability-fetch-legs.ts'

  it('★Web：savePath / upload 明确 unsupported（不静默忽略）', () => {
    const s = read(LEGS)
    const start = s.indexOf('export function webRequest')
    expect(start, '找不到 webRequest').toBeGreaterThan(0)
    const seg = s.slice(start, start + 2600)
    expect(seg, '★Web 未拒绝 savePath').toMatch(/savePath 是 App 沙箱文件语义/)
    expect(seg, '★Web 未拒绝 upload').toMatch(/upload 是 App 沙箱流式上传语义/)
  })

  it('★Web：接原生 AbortSignal + timeout + responseType + 流式', () => {
    const s = read(LEGS)
    const start = s.indexOf('export function webRequest')
    // ★#1127：Web 腿加 abortAware 包装后变长 ⇒ 切片窗口扩大（否则尾部断言查不到）
    const seg = s.slice(start, start + 6000)
    expect(seg, '★Web 未用原生 AbortController（平台本来就有）').toMatch(/g\.AbortController/)
    expect(seg, '★Web 未实现 timeout（fetch 无此选项，需 AbortController）').toMatch(/setTimeout\(\(\) => ctl!?\.abort\(\), timeoutMs\)/)
    expect(seg, '★Web 未区分 AbortError 是"用户取消"还是"超时"').toMatch(/byUser[\s\S]{0,120}fetch\.aborted/)
    expect(seg, '★Web 未实现 responseType: arraybuffer').toMatch(/config\.responseType === 'arraybuffer'/)
    expect(seg, '★Web 未实现流式（ReadableStream）').toMatch(/getReader/)
  })

  it('★MP：savePath/onChunk/upload/signal 明确 unsupported + timeout 真传下去', () => {
    const s = read(LEGS)
    const start = s.indexOf('export function mpRequest')
    expect(start, '找不到 mpRequest').toBeGreaterThan(0)
    const seg = s.slice(start, start + 3000)
    // ★断言**真正的 reject 语句**（只查文案的话，注释里也有那句 ⇒ 把分支关掉仍绿，本轮实测）
    for (const field of ['savePath', 'onChunk', 'upload', 'signal']) {
      const idx = seg.indexOf(`if (config.${field}) {`)
      expect(idx, `★MP 缺 ${field} 分支`).toBeGreaterThanOrEqual(0)
      const near = seg.slice(idx, idx + 260)
      expect(near.includes("reject(new ctx.CapError('fetch.unsupported'"), `★MP 的 ${field} 分支没有真正 reject（只写了文案）`).toBe(true)
    }
    expect(seg, '★MP 未把 timeout 传给 wx.request').toMatch(/timeout: config\.timeout/)
    expect(seg, '★MP 未区分超时与普通失败').toMatch(/fetch\.timeout/)
    expect(seg, '★MP 未映射 responseType').toMatch(/responseType: config\.responseType === 'arraybuffer'/)
  })

  it('★两端 leg 都从 bridges 里被真正调用（不是写了不接线）', () => {
    const s = read('packages/api/src/capability-bridges.ts')
    expect(s, '★webRequest 未被调用').toMatch(/request: \(config\) => webRequest\(/)
    expect(s, '★mpRequest 未被调用').toMatch(/request: \(config\) => mpRequest\(/)
  })
})

describe('★#1122 防止"门面再次收窄"', () => {
  it('★FetchConfig 必须包含五个 S3 字段（少一个就是门面又收窄了）', () => {
    const s = read('packages/api/src/capability-fetch-types.ts')
    for (const f of ['responseType', 'savePath', 'onChunk', 'upload?', 'signal?']) {
      expect(s.includes(f), `FetchConfig 缺 ${f}`).toBe(true)
    }
  })

  it('★useFetch 实现必须逐个透传（不能只声明类型而不传）', () => {
    const s = read('packages/api/src/capability-fetch.ts')
    for (const f of ['responseType: config?.responseType', 'savePath: config?.savePath',
      'onChunk: config?.onChunk', 'upload: config?.upload', 'signal: config?.signal']) {
      expect(s.includes(f), `runFetch 未透传 ${f}`).toBe(true)
    }
  })

  it('★App 腿 args 也必须带全（否则门面传下来在宿主桥前被丢）', () => {
    // ★#1122：实现在 `capability-app-request.ts`（从 capability-app.ts 抽出以过 size 棘轮）
    const s = read('packages/api/src/capability-app-request.ts')
    for (const f of ['responseType: config.responseType', 'savePath: config.savePath',
      'onChunk: config.onChunk', 'upload: config.upload', 'signal: config.signal']) {
      expect(s.includes(f), `App request 未透传 ${f}`).toBe(true)
    }
  })
})

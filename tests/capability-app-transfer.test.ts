// tests/capability-app-transfer.test.ts
// ★★★决策 #1095（2026-10-19）：App 端 `useUpload` / `useDownload` 桥的判据。
//
// 【为什么（能力总览矩阵：网络域 App 端 11 项里只 fetch 可用）】
//   上传/下载的 wx 形态是「临时文件 + 表单」，而 App 端**没有** uploadFile/downloadFile 原生 API。
//   但底子都在：`http.request` 字节腿已支持 arraybuffer ⇒ 缺的只有"字节↔文件"（宿主文件系统）。
//   ⇒ 补 `fs.writeBytes/readBytes/remove` 三个宿主方法，再用 http.request 拼出两条腿。
//
// 【判据】
//   ① 下载：`responseType:'path'`（缺省）落盘并回 path；`text/json` 原样回文本；进度只有 0/100；
//   ② 上传：手工组 multipart（边界/字段/文件段/结尾**逐段可验证**）；请求头带 boundary；
//   ③ 上传的诚实边界：App 无 Blob ⇒ `options.file` 如实 unsupported；
//   ④ 宿主 fs 调用的**路径与参数契约**：写盘带 `{path,bytes[]}`、读盘 `{path}`；
//   ⑤ 资源账本：上传/下载进行中登记，结束（成功或失败）都销账。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createAppDownload, createAppUpload, createAppTransfer, APP_TRANSFER_METHODS } from '../packages/api/src/capability-transfer'
import { createCapabilityResourceRegistry } from '../packages/api/src/capability-resources'
import { HOST_INVOKE_KEY, installHostResolveBridge, HOST_RESOLVE_KEY } from '../packages/api/src/capability-invoke'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

type Call = { method: string; args: Record<string, unknown> }

/**
 * 假宿主：同步方式实现 `http.request` 与 `fs.*`。
 * ★http.request 在真实宿主是**异步回推**（PNV/PRSP），但本判据只验桥的发包与解析逻辑，
 *   用同步返回即可（异步腿已有 `capability-app-fetch.test.ts` 覆盖）。
 */
function installFakeHost(handler: (method: string, args: Record<string, unknown>) => unknown) {
  const calls: Call[] = []
  ;(globalThis as Record<string, unknown>)[HOST_INVOKE_KEY] = (method: string, argsJson: string) => {
    const args = argsJson ? JSON.parse(argsJson) : {}
    calls.push({ method, args })
    const r = handler(method, args)
    if (r === undefined) return JSON.stringify({ ok: false, missing: true, reason: `未实现 ${method}` })
    return JSON.stringify({ ok: true, data: r })
  }
  return calls
}

function clearHost() {
  delete (globalThis as Record<string, unknown>)[HOST_INVOKE_KEY]
  delete (globalThis as Record<string, unknown>)[HOST_RESOLVE_KEY]
}

describe('★#1095 ① 下载：path 落盘 / text 原样 / 进度只有两端', () => {
  beforeEach(() => { clearHost() })
  afterEach(() => { clearHost() })

  it('★#1119 缺省（path）⇒ 走**宿主直写**（savePath meta，JS 不碰字节）', async () => {
    const calls = installFakeHost((m) => {
      // ★宿主直写路径下，http.request 回的是**摘要**（path/size），不再回字节
      if (m === 'http.request') return { status: 200, data: { path: 'download/host-wrote.bin', size: 3 }, headers: {} }
      return undefined
    })
    const dl = createAppDownload()
    const r = await dl('https://example.com/a.bin')
    expect(r.status).toBe(200)
    expect(r.path).toBe('download/host-wrote.bin')
    expect(r.progress).toBe(100)
    const http = calls.find((c) => c.method === 'http.request')!
    // ★关键：必须带 savePath（否则又退回"整包回推 JS → JS 写盘"，内存随文件增长）
    expect(http.args.savePath, '未声明 savePath ⇒ download 仍会整包进 JS 内存').toBeTruthy()
    expect(typeof http.args.savePath).toBe('string')
    // ★且不得再走 JS 侧写盘
    expect(calls.some((c) => c.method === APP_TRANSFER_METHODS.writeBytes), '仍在 JS 侧写盘').toBe(false)
    // ★不得再要求 arraybuffer（那意味着整包回推）
    expect(http.args.responseType).toBeUndefined()
  })

  it('★#1119 宿主回字符串化摘要也能解析（三端回执形态不同）', async () => {
    installFakeHost((m) => (m === 'http.request'
      ? { status: 200, data: '{"path":"download/from-string.bin","size":9}' }
      : undefined))
    const r = await createAppDownload()('https://example.com/b.bin')
    expect(r.path).toBe('download/from-string.bin')
  })

  it('responseType: text ⇒ 不落盘，data 是文本', async () => {
    const calls = installFakeHost((m) => (m === 'http.request' ? { status: 200, data: 'hello', headers: {} } : undefined))
    const dl = createAppDownload()
    const r = await dl('https://example.com/a.txt', { responseType: 'text' })
    expect(r.data).toBe('hello')
    expect(r.path).toBeUndefined()
    expect(calls.some((c) => c.method === APP_TRANSFER_METHODS.writeBytes)).toBe(false)
  })

  it('responseType: json ⇒ 解析成对象；非 JSON 原样回文本（不猜）', async () => {
    installFakeHost((m) => (m === 'http.request' ? { status: 200, data: '{"a":1}', headers: {} } : undefined))
    const dl = createAppDownload()
    expect((await dl('https://x/j', { responseType: 'json' })).data).toEqual({ a: 1 })
    installFakeHost((m) => (m === 'http.request' ? { status: 200, data: 'not json', headers: {} } : undefined))
    expect((await dl('https://x/j', { responseType: 'json' })).data).toBe('not json')
  })

  it('进度只有 0 与 100（不伪造中间值）', async () => {
    installFakeHost((m) => (m === 'http.request' ? { status: 200, data: 'x', headers: {} } : undefined))
    const seen: number[] = []
    await createAppDownload()('https://x/t', { responseType: 'text' }, (p) => seen.push(p))
    expect(seen).toEqual([0, 100])
  })
})

describe('★#1095 ② 上传：multipart 组包逐段可验证', () => {
  beforeEach(() => { clearHost() })
  afterEach(() => { clearHost() })

  it('请求头带 boundary；body 含字段段、文件段与结尾', async () => {
    const calls = installFakeHost((m) => {
      if (m === APP_TRANSFER_METHODS.readBytes) return { bytes: [65, 66], size: 2 } // "AB"
      if (m === 'http.request') return { status: 201, data: 'ok' }
      return undefined
    })
    const up = createAppUpload()
    const r = await up({ url: 'https://x/upload', filePath: 'tmp/a.txt', name: 'doc', formData: { k: 'v' } })
    expect(r.status).toBe(201)
    const http = calls.find((c) => c.method === 'http.request')!
    const headers = http.args.headers as Record<string, string>
    expect(headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/)
    const boundary = headers['Content-Type'].split('boundary=')[1]
    // ★args 经 JSON 序列化后 Uint8Array 变成 {"0":..} 形态 ⇒ 测试侧归一成字节数组
    const raw = http.args.data as unknown
    const bytes = raw instanceof Uint8Array ? Array.from(raw) : Object.values(raw as Record<string, number>)
    const text = Buffer.from(bytes).toString('utf8')
    expect(text).toContain(`--${boundary}`)
    expect(text).toContain('Content-Disposition: form-data; name="k"')
    expect(text).toContain('Content-Disposition: form-data; name="doc"; filename="a.txt"')
    expect(text).toContain('Content-Type: application/octet-stream')
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true)
    // ★文件字节逐字节在 body 里（在文件段的头之后）
    const idx = text.indexOf('Content-Type: application/octet-stream')
    const after = text.slice(idx)
    expect(after).toContain('AB')
  })

  it('App 无 Blob ⇒ options.file 如实 unsupported（不静默走别的路）', async () => {
    installFakeHost(() => ({}))
    await expect(createAppUpload()({ url: 'https://x', file: {} as never })).rejects.toMatchObject({
      code: 'upload.unsupported',
    })
  })

  it('缺 filePath ⇒ upload.failed（与 wx 同语义）', async () => {
    installFakeHost(() => ({}))
    await expect(createAppUpload()({ url: 'https://x' })).rejects.toMatchObject({ code: 'upload.failed' })
  })

  it('进度只有 0 与 100', async () => {
    installFakeHost((m) => {
      if (m === APP_TRANSFER_METHODS.readBytes) return { bytes: [1], size: 1 }
      if (m === 'http.request') return { status: 200, data: '' }
      return undefined
    })
    const seen: number[] = []
    await createAppUpload()({ url: 'https://x', filePath: 'a' }, (p) => seen.push(p))
    expect(seen).toEqual([0, 100])
  })
})

describe('★#1095 ②b App 引擎无 TextEncoder（真机抓出）', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'packages/api/src/capability-transfer.ts'), 'utf8')

  it('实现里不得引用 TextEncoder（App 三端引擎都没有它）', () => {
    // ★真机实测：QuickJS 里 `new TextEncoder()` 直接 ReferenceError ⇒ 上传整条失败。
    //   与本仓既有「App 无 TextDecoder」同族（#1071 曾为此手写 utf8Decode）。
    const code = SRC.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code.includes('TextEncoder'), '不得依赖 TextEncoder——须用内置 utf8Encode').toBe(false)
    expect(code.includes('function utf8Encode'), '缺内置 UTF-8 编码器').toBe(true)
  })

  it('utf8Encode 能编码中文与 emoji（行为级）', async () => {
    // 通过上传路径间接验证：字段值含中文/emoji 时 body 里应是合法 UTF-8
    const calls = installFakeHost((m) => {
      if (m === APP_TRANSFER_METHODS.readBytes) return { bytes: [1], size: 1 }
      if (m === 'http.request') return { status: 200, data: '' }
      return undefined
    })
    await createAppUpload()({ url: 'https://x', filePath: 'a', formData: { note: '中文🚀' } })
    const http = calls.find((c) => c.method === 'http.request')!
    const raw = http.args.data as unknown
    const bytes = raw instanceof Uint8Array ? Array.from(raw) : Object.values(raw as Record<string, number>)
    const text = Buffer.from(bytes).toString('utf8')
    expect(text).toContain('中文🚀')
  })
})

describe('★#1095 ③ 资源账本：进行中登记，结束销账（成功与失败都销）', () => {
  beforeEach(() => { clearHost() })
  afterEach(() => { clearHost() })

  it('下载成功后账本归零', async () => {
    installFakeHost((m) => {
      if (m === 'http.request') return { status: 200, data: 'x', headers: {} }
      return undefined
    })
    const reg = createCapabilityResourceRegistry()
    const t = createAppTransfer({ resources: reg, owner: 'page-1' })
    await t.download('https://x/t', { responseType: 'text' })
    expect(reg.size()).toBe(0)
  })

  it('下载失败后账本也归零（不留"飞行中"残留）', async () => {
    installFakeHost(() => undefined) // http.request 也 missing ⇒ 抛错
    const reg = createCapabilityResourceRegistry()
    const t = createAppTransfer({ resources: reg })
    await expect(t.download('https://x/t')).rejects.toBeTruthy()
    expect(reg.size()).toBe(0)
  })

  it('上传成功后账本归零', async () => {
    installFakeHost((m) => {
      if (m === APP_TRANSFER_METHODS.readBytes) return { bytes: [1], size: 1 }
      if (m === 'http.request') return { status: 200, data: '' }
      return undefined
    })
    const reg = createCapabilityResourceRegistry()
    const t = createAppTransfer({ resources: reg })
    await t.upload({ url: 'https://x', filePath: 'a' })
    expect(reg.size()).toBe(0)
  })

  it('不传 resources ⇒ 零回归（不登记也不报错）', async () => {
    installFakeHost((m) => (m === 'http.request' ? { status: 200, data: 'x', headers: {} } : undefined))
    const t = createAppTransfer()
    const r = await t.download('https://x/t', { responseType: 'text' })
    expect(r.status).toBe(200)
  })
})

// ★保留引用，避免未使用告警（异步腿接口本判据不直接用）
void installHostResolveBridge

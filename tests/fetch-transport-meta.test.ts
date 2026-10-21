// tests/fetch-transport-meta.test.ts
// ★★★决策 #1158：**传输层读数**（`FetchMeta.transport`）的判据。
//
// 【它守什么】把"网络慢"从**一个总数**拆成 DNS / 建连 / TLS / 首字节 —— 这是三端宿主
//   实测提供的（iOS `URLSessionTaskMetrics` · Android 状态行+TTFB · 鸿蒙 `Rcp_TimeInfo`）。
//
// 【★两类判据，缺一不可】
//   ① **解析**（纯函数 `parseTransportReadout`）：只保留能解析的项；NaN/负数/未知 reused 一律丢弃；
//      全丢 ⇒ `undefined`（整项不出现）。
//   ② **线格式**（`Transport=22`）：非空才写 tag；空对象/缺省 ⇒ **不写**；
//      且**缺的键不出现**（这是"不可得"的机器可读表达）。
//
// 【为什么"缺键"这条必须单独测】本仓反复踩"用缺省值冒充已知"：
//   若某端把 `dnsMs` 缺失写成 `dnsMs=0`，业务会读成"DNS 花了 0ms"——**假数据比缺数据更糟**。
//   本判据断言：partial 读数**不得**凭空多出键。
import { describe, it, expect } from 'vitest'
import { parseTransportReadout } from '../packages/api/src/capability-fetch-types'
import {
  MetaTagResolve,
  decodeResolveFrame,
  encodeResolveFrame,
  type ResolveFrame,
} from '../packages/api/src/invoke-wire'

describe('★★★#1158 传输读数：解析（parseTransportReadout）', () => {
  it('① iOS 全字段 → 全部解析（proto/reused/dnsMs/connectMs/tlsMs/ttfbMs）', () => {
    const m = parseTransportReadout({
      proto: 'h2',
      reused: '1',
      dnsMs: '3.2',
      connectMs: '12.5',
      tlsMs: '31.0',
      ttfbMs: '48.7',
    })
    expect(m).toEqual({ proto: 'h2', reused: true, dnsMs: 3.2, connectMs: 12.5, tlsMs: 31, ttfbMs: 48.7 })
  })

  it('② Android 的 partial（只有 proto + ttfbMs）⇒ **不得凭空出现**其它键', () => {
    const m = parseTransportReadout({ proto: 'http/1.1', ttfbMs: '21' })
    expect(m).toEqual({ proto: 'http/1.1', ttfbMs: 21 })
    // ★显式断言"缺键不出现"（不是 undefined 值，而是键不存在）
    expect(Object.keys(m ?? {})).toEqual(['proto', 'ttfbMs'])
  })

  it('③ 鸿蒙读数（无 proto/reused）⇒ 只有四个毫秒键', () => {
    const m = parseTransportReadout({ dnsMs: '1.0', connectMs: '2.0', tlsMs: '3.0', ttfbMs: '4.0' })
    expect(m).toEqual({ dnsMs: 1, connectMs: 2, tlsMs: 3, ttfbMs: 4 })
    expect(m && 'proto' in m).toBe(false)
    expect(m && 'reused' in m).toBe(false)
  })

  it('★★④ `reused` 只认 "1"/"0"（其它值不得被当成 true）', () => {
    expect(parseTransportReadout({ reused: '1' })?.reused).toBe(true)
    expect(parseTransportReadout({ reused: '0' })?.reused).toBe(false)
    // ★这是本仓"非空串就是 true"的经典坑：`'false'` 是非空串，但语义是假
    for (const bad of ['true', 'false', 'yes', '', '2']) {
      const m = parseTransportReadout({ reused: bad, ttfbMs: '5' })
      expect(m && 'reused' in m, `reused="${bad}" 不得被解析成任何布尔`).toBe(false)
    }
  })

  it('★★⑤ NaN / 负数 / 非数字毫秒 ⇒ 丢弃该键（不写 NaN，不把负时间交给业务）', () => {
    for (const bad of ['abc', '', 'NaN', '-3', 'Infinity', '-0.5']) {
      const m = parseTransportReadout({ dnsMs: bad, ttfbMs: '7' })
      expect(m && 'dnsMs' in m, `dnsMs="${bad}" 应被丢弃`).toBe(false)
      expect(m?.ttfbMs).toBe(7)
    }
  })

  it('⑥ 全项不可解析 / 空对象 / 缺省 ⇒ `undefined`（整项不出现，不是空对象）', () => {
    expect(parseTransportReadout(undefined)).toBeUndefined()
    expect(parseTransportReadout({})).toBeUndefined()
    expect(parseTransportReadout({ dnsMs: 'x' })).toBeUndefined()
    // ★空 proto 也不算有效读数
    expect(parseTransportReadout({ proto: '' })).toBeUndefined()
  })

  it('⑦ 未知键被忽略（不把宿主侧实现细节透给业务）', () => {
    const m = parseTransportReadout({ proto: 'h2', someInternalField: '9', ttfbMs: '1' })
    expect(m).toEqual({ proto: 'h2', ttfbMs: 1 })
  })
})

describe('★★★#1158 传输读数：线格式（Transport=22）', () => {
  const roundTrip = (f: ResolveFrame): ResolveFrame => decodeResolveFrame(encodeResolveFrame(f))

  it('⑧ tag 号是 22（与 TS 常量一致；跨端硬编码同一个数）', () => {
    expect(MetaTagResolve.Transport).toBe(22)
  })

  it('⑨ 往返保真：全字段 + 部分字段 + 键序', () => {
    const full = roundTrip({
      reqId: 'r1',
      ok: true,
      status: 200,
      transport: { proto: 'h2', reused: '1', dnsMs: '3.2', connectMs: '12.5', tlsMs: '31.0', ttfbMs: '48.7' },
    })
    expect(full.transport).toEqual({ proto: 'h2', reused: '1', dnsMs: '3.2', connectMs: '12.5', tlsMs: '31.0', ttfbMs: '48.7' })
    expect(Object.keys(full.transport ?? {})).toEqual(['proto', 'reused', 'dnsMs', 'connectMs', 'tlsMs', 'ttfbMs'])

    const part = roundTrip({ reqId: 'r2', ok: true, transport: { proto: 'http/1.1', ttfbMs: '21' } })
    // ★缺键不得被补上（这是"不可得"的线格式表达）
    expect(part.transport).toEqual({ proto: 'http/1.1', ttfbMs: '21' })
  })

  it('⑩ `transport` 缺省 / 空对象 ⇒ **都不写 tag 22**（往返后字段消失）', () => {
    expect(roundTrip({ reqId: 'r3', ok: true }).transport).toBeUndefined()
    expect(roundTrip({ reqId: 'r4', ok: true, transport: {} }).transport).toBeUndefined()
  })

  it('⑪ 未知键在线格式层被丢弃（不透传未承诺字段名）', () => {
    const f = roundTrip({ reqId: 'r5', ok: true, transport: { proto: 'h2', evil: '1' } as never })
    expect(f.transport).toEqual({ proto: 'h2' })
  })

  it('★⑫ `transport` 与 `headers` 互不污染（这是单开 tag 而没塞进 Headers 的理由）', () => {
    const f = roundTrip({
      reqId: 'r6',
      ok: true,
      status: 200,
      headers: { 'content-type': 'application/json', proto: 'server-said-this' },
      transport: { proto: 'h2', ttfbMs: '9' },
    })
    // ★服务端头的 `proto` 保持原值；宿主测的 `proto` 在 transport 里 —— 两者不互相覆盖
    expect(f.headers?.['proto']).toBe('server-said-this')
    expect(f.transport?.proto).toBe('h2')
  })
})

// tests/fetch-dns-source.test.ts
// ★★★#1183：**`FetchMeta.transport.dnsSource` 端到端契约**（HTTPDNS 的可观测面）。
//
// 【为什么必须有这一层（这是 #1182 的诚实边界⑤的收口）】
//   #1182 把 iOS 的 HTTPDNS 生产实现落地了，`http.dnsStats` 也能读——但那是**进程级**记账，
//   业务在一次请求里**看不到**"我这次到底走的是表还是系统 DNS"。
//   而 `httpDns` 的失败形态恰恰全是**静默**的：表没生效时请求照常成功（走系统 DNS），
//   业务以为防住了劫持，实际没有（#1171「假数据比缺数据更糟」同纪律）。
//   ⇒ 必须把"本次请求的解析来源"作为**每请求**字段暴露出来。
//
// 【本判据守的三层】
//   ① **解析层**（纯函数）：白名单只认四个值；错值/空值**丢弃**而不是透传；`dnsTableHit` 只认 1/0。
//   ② **线格式层**：`dnsSource`/`dnsTableHit` 在 `TRANSPORT_KEYS` 白名单内（否则 decode 时被丢弃）。
//   ③ **三端实现层**：宿主必须真的写这个键（Android / iOS / 鸿蒙 各有落点），
//      且**"没发生解析"时不写**（不能拿 `system` 冒充）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseTransportReadout } from '../packages/api/src/capability-fetch-types'
import { TRANSPORT_KEYS, encodeResolveFrame, decodeResolveFrame } from '../packages/api/src/invoke-wire'

const ROOT = path.resolve(__dirname, '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('★★★#1183 dnsSource：解析层（白名单 + 不伪造）', () => {
  it('四个已知值全部接受（table / system / literal / resolver）', () => {
    for (const v of ['table', 'system', 'literal', 'resolver'] as const) {
      const m = parseTransportReadout({ dnsSource: v })
      expect(m?.dnsSource, `★${v} 被错误丢弃`).toBe(v)
    }
  })

  it('★未知值被丢弃（不透传拼错的枚举——业务会以为有效）', () => {
    for (const bad of ['Tabel', 'TABLE', 'table ', 'dns', '']) {
      const m = parseTransportReadout({ dnsSource: bad })
      expect(m?.dnsSource, `★"${bad}" 被当成了有效来源`).toBeUndefined()
    }
  })

  it('★`dnsTableHit` 只认 "1"/"0"（其它值一律丢弃，不把非空串当 true）', () => {
    expect(parseTransportReadout({ dnsTableHit: '1' })?.dnsTableHit).toBe(true)
    expect(parseTransportReadout({ dnsTableHit: '0' })?.dnsTableHit).toBe(false)
    for (const bad of ['true', 'yes', '1 ', '']) {
      expect(parseTransportReadout({ dnsTableHit: bad })?.dnsTableHit, `★"${bad}" 被当成了布尔`).toBeUndefined()
    }
  })

  it('★只有 dnsSource ⇒ 整项仍返回（不因缺耗时字段而丢弃）', () => {
    const m = parseTransportReadout({ dnsSource: 'table', dnsTableHit: '1' })
    expect(m).toEqual({ dnsSource: 'table', dnsTableHit: true })
  })

  it('★空对象 ⇒ undefined（"没测到"整项不出现，与 #1158 同语义）', () => {
    expect(parseTransportReadout({})).toBeUndefined()
    expect(parseTransportReadout({ dnsSource: 'bogus' })).toBeUndefined()
  })
})

describe('★★★#1183 dnsSource：线格式层（在 Transport 白名单内）', () => {
  it('★两个键都在 `TRANSPORT_KEYS` 里（否则 decode 时会被静默丢弃）', () => {
    expect(TRANSPORT_KEYS, '★dnsSource 不在白名单 ⇒ decode 丢弃 ⇒ 业务永远看不到').toContain('dnsSource')
    expect(TRANSPORT_KEYS, '★dnsTableHit 不在白名单').toContain('dnsTableHit')
  })

  it('★往返：dnsSource/dnsTableHit 与既有传输读数共存，互不覆盖', () => {
    const bytes = encodeResolveFrame({
      reqId: 'r1',
      ok: true,
      status: 200,
      transport: { proto: 'h2', reused: '1', dnsSource: 'table', dnsTableHit: '1' },
    } as never)
    const f = decodeResolveFrame(bytes as Uint8Array)
    expect(f.transport).toEqual({ proto: 'h2', reused: '1', dnsSource: 'table', dnsTableHit: '1' })
  })

  it('★未承诺的键仍被丢弃（白名单语义不变）', () => {
    const bytes = encodeResolveFrame({
      reqId: 'r2',
      ok: true,
      transport: { dnsSource: 'table', srvIp: '1.2.3.4' },
    } as never)
    expect(decodeResolveFrame(bytes as Uint8Array).transport).toEqual({ dnsSource: 'table' })
  })
})

describe('★★★#1183 dnsSource：三端实现（宿主必须真的写、且不乱填）', () => {
  it('★Android：per-call 记账（不能用进程级 lastDnsSource —— 并发会被别的请求覆盖）', () => {
    const s = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpTransport.java')
    // 必须有 per-call 的来源槽（CallMetrics.dnsSource）与写入点
    expect(s, '★CallMetrics 缺 dnsSource（只能拿进程级读数 ⇒ 并发时是假读数）').toMatch(
      /volatile String dnsSource = null/,
    )
    expect(s, '★ForwardingDns 没有写 per-call 来源').toMatch(/noteCallDnsSource\("table"\)/)
    expect(s, '★未命中回落时没记来源（回落不可见）').toMatch(/noteCallDnsSource\("system"\)/)
    // readout 必须输出
    expect(s, '★readout 没输出 dnsSource').toMatch(/out\.put\("dnsSource"/)
    // 缺 = 不写（不能填 system 冒充）
    expect(s, '★缺来源时填了默认值（"没解析" ≠ "走了 system"）').toMatch(
      /if \(m\.dnsSource != null && !m\.dnsSource\.isEmpty\(\)\)/,
    )
  })

  it('★iOS：只用"本次新建连接"时的来源（复用时是上一次的值，不能冒充本次）', () => {
    const s = read('hosts/ios/ProteusHost/runtime/http-capability.swift')
    expect(s, '★iOS 没写 dnsSource').toMatch(/nv\.append\(\("dnsSource"/)
    expect(s, '★iOS 在连接复用时也写了来源（会把上一次的值冒充成本次）').toMatch(
      /if !tm\.isReusedConnection/,
    )
    // proxy 侧必须能按 host 查（而不是只给进程级最后一条）
    const proxy = read('hosts/ios/ProteusHost/runtime/HttpDnsProxy.swift')
    expect(proxy, '★iOS 代理只记了进程级 lastSource（请求之间会串味）').toMatch(/func source\(forHost host: String\)/)
  })

  it('★鸿蒙：per-request 来源 + RAII 清理（防跨请求串味）', () => {
    const s = read('hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h')
    expect(s, '★鸿蒙缺 per-request 来源槽').toMatch(/inline std::string& callDnsSource\(\)/)
    expect(s, '★鸿蒙缺 RAII 清理（来源会跨请求残留）').toMatch(/struct CallDnsSourceGuard/)
    expect(s, '★鸿蒙 transport 没输出 dnsSource').toMatch(/tp\.emplace_back\("dnsSource"/)
    // 命中与未命中都要记
    expect(s, '★鸿蒙命中时没记来源').toMatch(/callDnsSource\(\) = "table"/)
    expect(s, '★鸿蒙未命中时没记来源（回落不可见）').toMatch(/callDnsSource\(\) = "miss"/)
  })

  it('★三端都不允许把"缺省"写成 system（本仓"假数据比缺数据更糟"）', () => {
    const ios = read('hosts/ios/ProteusHost/runtime/http-capability.swift')
    const harmony = read('hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h')
    const android = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpTransport.java')
    // iOS / 鸿蒙：都必须是"有值才写"
    expect(ios, '★iOS 无条件写 dnsSource').toMatch(/let src = HttpDnsProxies\.source\(forHost:[\s\S]{0,120}?nv\.append/)
    expect(harmony, '★鸿蒙无条件写 dnsSource').toMatch(/if \(!callDnsSource\(\)\.empty\(\)\)/)
    // Android：dnsSource 缺省是 null，readout 里已在上面判过
    expect(android, '★Android readout 缺省填了值').not.toMatch(/out\.put\("dnsSource", "system"\)/)
  })
})

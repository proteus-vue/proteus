// tests/harmony-doh-landing.test.ts
// ★★★#1202：**鸿蒙 DoH 落点（`Rcp_DnsOverHttps`）真的生效**，且语义是**权威**而非"先试再回落"。
//
// 【这条判据回答什么（矩阵里最后一个"只做了头文件取证"的悬项）】
//   `rcp.h` 的注释写「If set, the address resolved by the DOH dns server is **preferred**」。
//   这句话本身有两种可能语义，头文件分辨不出来：
//     · 强语义（权威）：DoH 给了答案就用；无答案/连不上 ⇒ **失败**，不回落系统 DNS；
//     · 弱语义（先试）：DoH 不可用 ⇒ **静默回落**系统 DNS。
//   两者对业务后果完全不同（弱语义 = "配了 DoH 也可能悄悄没生效"，排障时读数会说谎）。
//
// 【★判据形状：六组对照，缺一组都有"同形解释"】
//   T0 无 DoH + `.invalid`（RFC 2606 保留 TLD，系统 DNS 必然解析不出）⇒ **失败**
//      —— 没有这一组，T1 的成功可能只是"系统 DNS 恰好能解"
//   T1 有 DoH + 同一 `.invalid` 域名，DoH 回 127.0.0.1 ⇒ **成功 200 + 目标服务端内容**
//      —— 证明 DoH 的答案**真的被采用**
//   T2a 无 DoH + `example.com` ⇒ **成功**（基线：网络/宿主本身没问题）
//   T2b 有 DoH + `example.com`，DoH 回 203.0.113.1（TEST-NET-3）⇒ **失败**
//      —— 证明 DoH **覆盖了系统 DNS**（否则系统 DNS 会给可用 IP ⇒ 成功）
//   T3 有 DoH 回 NXDOMAIN ⇒ **失败** —— 证明**无答案不静默回落**
//   T4 DoH 服务端不可达 ⇒ **失败** —— 证明**连不上也不回落**
//
// 【★第三方证据（不依赖设备自报）】本地 DoH 服务端 `/stats` 记录查询计数 + qname + qtype：
//   T1/T2b 必须计数上升且 qname 匹配；T4 必须**零上升**（设备确实没连上）。
//   ★只用探针自报的 `doh.installed` 是不够的——那只证明"配置被挂上"。
//
// 【★为什么 DoH 走探针通道而不是业务 API / 线格式 tag】
//   `useFetch({ httpDns })` 的业务语义是"域名 → IP 表"（同 Android `Dns` / iOS 本地代理），
//   而 DoH 是"给一个解析服务端 URL"——两者不是同一个能力（见 `02-ios-httpdns-industry-survey.md`
//   结论 5：不把 DoH 混进 `httpDns` 语义）。为取证往线格式加 tag 会触发五端同步义务，
//   而本单只回答"这条路通不通" ⇒ 用探针专用进程级状态，**线格式零改动、生产零影响**。
//
// 【诚实边界】
//   · 服务端用**自签证书** + `skipCertificatesValidation=true` ⇒ 只证明"配置路径接通"，
//     **不**证明真实 CA 校验下同样成立（那条在本机做不成可归因的对照）；
//   · 只证 `Rcp_DnsOverHttps` 一个字段的语义；RCP 的 DoH **缓存/TTL 策略未取证**；
//   · 不宣称"鸿蒙 DoH 已完成"——业务门面/多端点/失败策略都未做（本条只把"落点可用 + 语义"钉住）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')
const RES = 'hosts/harmony/results'
const SUMMARY = `${RES}/doh-probe-summary.json`

type Group = {
  ok?: boolean
  status?: number
  bodyBytes?: number
  reason?: string
  preview?: string
  doh?: { enabled?: boolean; installed?: boolean; url?: string; skipCert?: boolean }
  transport?: Record<string, string>
}
type Summary = { issue?: string; serverStats?: { queries?: number; qnames?: string[]; qtypes?: number[] }; groups?: Record<string, Group> }

function load(): Summary {
  expect(fs.existsSync(path.join(ROOT, SUMMARY)), `缺证据 ${SUMMARY}（跑 bash hosts/harmony/run-doh-probe.sh）`).toBe(true)
  return JSON.parse(read(SUMMARY)) as Summary
}

describe('★★★#1202 鸿蒙 DoH 落点（Rcp_DnsOverHttps）真机六组对照', () => {
  it('★★★证据齐：六组都在，且是同一轮（服务端读数一并入库）', () => {
    const s = load()
    const g = s.groups ?? {}
    for (const name of ['t0-no-doh-invalid', 't1-doh-resolves', 't2a-baseline',
                        't2b-doh-overrides', 't3-doh-nxdomain', 't4-doh-unreachable']) {
      expect(g[name], `缺组 ${name}（六组缺一不可——每组排除一种"同形解释"）`).toBeTruthy()
    }
    const st = s.serverStats ?? {}
    // ★第三方证据必须随证据一起入库：只有设备自报时，无法离线判断"DoH 到底被调用过没有"
    expect(Number(st.queries), '★服务端查询计数应入库且 > 0').toBeGreaterThan(0)
    expect(Array.isArray(st.qnames) && st.qnames.length > 0, '★服务端 qname 记录应入库').toBe(true)
  })

  it('★★★T1：配了 DoH ⇒ 系统 DNS 解析不出的 .invalid 域名也能成功（答案被采用）', () => {
    const d = load().groups?.['t1-doh-resolves'] ?? {}
    expect(d.doh?.enabled, '★该组应启用 DoH').toBe(true)
    expect(d.doh?.installed, '★DoH 应被挂到请求配置上').toBe(true)
    expect(d.ok, `★DoH 生效时请求应成功（实得 reason=${d.reason ?? ''}）`).toBe(true)
    expect(d.status, '★状态码应为 200').toBe(200)
    expect(String(d.preview ?? ''), '★响应体应来自本地目标服务端').toContain('PROTEUS_RPORT_OK')
  })

  it('★★★T0/T2b/T3/T4：四个反例都必须失败（否则"生效"与"回落"同形，判据不成立）', () => {
    const g = load().groups ?? {}
    // T0：无 DoH 时该域名必然解不出 ⇒ 证明 T1 的成功只能是 DoH 的功劳
    expect(g['t0-no-doh-invalid']?.ok, '★T0（无 DoH + .invalid）应失败').toBe(false)
    expect(g['t0-no-doh-invalid']?.doh?.enabled, '★T0 确未启用 DoH').toBe(false)
    // T2b：DoH 指向不可达 IP ⇒ 失败（证明 DoH 覆盖系统 DNS，而不是被系统 DNS 兜住）
    expect(g['t2b-doh-overrides']?.ok, '★T2b（DoH→不可达 IP）应失败').toBe(false)
    // T3：DoH 回 NXDOMAIN ⇒ 失败（证明"无答案不静默回落"——弱语义会成功）
    expect(g['t3-doh-nxdomain']?.ok, '★T3（DoH 回 NXDOMAIN）应失败').toBe(false)
    expect(String(g['t3-doh-nxdomain']?.reason ?? ''), '★T3 应为解析失败').toMatch(/无法解析|unreachable/)
    // T4：DoH 服务端不可达 ⇒ 失败（证明"连不上也不回落"——这是生产风险面）
    expect(g['t4-doh-unreachable']?.ok, '★T4（DoH 服务端不可达）应失败').toBe(false)
    expect(String(g['t4-doh-unreachable']?.reason ?? ''), '★T4 应为解析失败').toMatch(/无法解析|unreachable/)
  })

  it('★★★T2a 基线成立：无 DoH 时 example.com 成功（否则上面的"失败"不能归因给 DoH）', () => {
    const d = load().groups?.['t2a-baseline'] ?? {}
    expect(d.ok, '★T2a 基线应成功').toBe(true)
    expect(d.status, '★T2a 状态码应为 200').toBe(200)
    expect(Number(d.bodyBytes), '★T2a 应有响应体').toBeGreaterThan(0)
    // 未装 DNS 表 ⇒ dnsSource 不应出现（"没发生解析" ≠ "走了系统 DNS"）
    expect(Object.keys(d.transport ?? {}), '★未装表时不应报 dnsSource').not.toContain('dnsSource')
  })

  it('★★★矩阵与任务板不再把 DoH 记成「未实测」', () => {
    const md = read('docs/proteus-network-plan/00-capability-matrix.md')
    // ★口径：只认"在 DoH 上下文中写成未实测"的句子；#1166 的历史叙述里可以出现"未实测"（那时确实没测）。
    //   这里断言的是矩阵**当前结论行**已更新为实测通过。
    expect(md, '★矩阵应记 DoH 已真机实测（#1202）').toContain('#1202')
    const lines = md.split('\n').filter((l) => l.includes('DoH') || l.includes('doh'))
    const stale = lines.filter((l) => l.includes('未实测') && !l.includes('#1202') && !l.includes('#1166'))
    expect(stale, `★仍有 DoH "未实测" 的过时结论：${stale.join(' | ').slice(0, 300)}`).toHaveLength(0)
  })
})

// tests/harmony-dns-inject.test.ts
// ★★★#1167：**鸿蒙的自定义 DNS 注入点真的能工作**——HTTPDNS 的鸿蒙落点已实证。
//
// 【这条判据回答什么（矩阵里最后一项真缺口的前置）】
//   矩阵写「HTTPDNS 业务化：Android `Dns` seam 已落 #1160 / 鸿蒙有现成落点 #1166 / iOS 待定」。
//   #1166 只做到**头文件取证**（`Rcp_DnsConfiguration` 有四条路：DoH / DnsServers / Static / Dynamic）。
//   本轮把 `RCP_DNS_RULE_DYNAMIC` 真接到宿主探针上并**真机双向对照**，证明它真的生效：
//     · **注入**：假解析器把 `www.cloudflare.com` 强制解析到 `203.0.113.1`（TEST-NET-3，不可达）
//       ⇒ 回调被调用 **1 次**（host/port 都对）· 请求**失败**（RCP 超时）
//     · **基线**：不注入 ⇒ `calls=0` · 请求**成功**（200，且仍是 h2）
//   ⇒ 因果闭环：**不是"请求碰巧失败"，是"我们给的解析结果真的被采用了"**。
//
// 【★为什么这个形状很重要（决定了 HTTPDNS 的线格式可以两端同一套）】
//   `Rcp_DynamicDnsRuleFunction` 的签名是 `Rcp_IpAddress* (*)(const char* host, uint16_t port)`
//   —— 与 Android `okhttp3.Dns.lookup(hostname) → List<InetAddress>` **语义同构**：
//   都是"框架调我们给的函数要 IP"。⇒ 业务 API 可以只表达"给定域名返回 IP 列表"，
//   两端各自翻译成自己的注入形态，不必为鸿蒙单独设计一套解析器抽象。
//
// 【诚实边界】
//   · 本判据证明的是**注入点可用**，不是"HTTPDNS 已实现"——业务 API + 线格式 + 缓存/降级策略仍未做；
//   · 只验了 `RCP_DNS_RULE_DYNAMIC`；DoH（`Rcp_DnsOverHttps`）与 Static 规则未实测；
//   · 注入路径是**探针专用**（`DnsProbe.installed`），生产默认走系统 DNS（`calls=0` 即证）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')
const INJECT = 'hosts/harmony/results/http-probe-dns-inject.json'
const BASELINE = 'hosts/harmony/results/http-probe-dns-baseline.json'

type Probe = {
  ok?: boolean
  status?: number
  reason?: string
  preview?: string
  dns?: { installed?: boolean; calls?: number; host?: string; port?: number; forcedIp?: string }
}

describe('★★★#1167 鸿蒙自定义 DNS 注入点（HTTPDNS 的鸿蒙落点）', () => {
  it('★★★注入侧：假解析器被调用 1 次（host/port 正确），且请求因不可达 IP 失败', () => {
    expect(fs.existsSync(path.join(ROOT, INJECT)), `缺证据 ${INJECT}（跑 run-http-probe.sh --dns-ip 203.0.113.1）`).toBe(true)
    const d = JSON.parse(read(INJECT)) as Probe
    const dns = d.dns ?? {}
    expect(dns.installed, '★注入标记应为 true').toBe(true)
    // ★核心：回调真的被 RCP 调用了（0 ⇒ 这条路没接通）
    expect(Number(dns.calls), '★假解析器未被调用 ⇒ RCP_DNS_RULE_DYNAMIC 没接通').toBeGreaterThan(0)
    expect(dns.host, '★解析的 host 应是目标域名').toBe('www.cloudflare.com')
    expect(Number(dns.port), '★解析的 port 应是 443').toBe(443)
    expect(dns.forcedIp, '★强制 IP 应原样回传给 RCP').toBe('203.0.113.1')
    // ★因果：解析到不可达 IP ⇒ 请求必须失败（若仍成功，说明我们的解析结果没被采用）
    expect(d.ok, '★注入不可达 IP 后请求**不应**成功（成功=解析结果没被采用）').toBe(false)
    expect(String(d.reason ?? ''), '★失败原因应是网络层（超时/不可达），不是业务错').toMatch(/timeout|unreachable|network/i)
  })

  it('★★★基线侧：不注入 ⇒ 解析器未被调用，请求成功（证明生产默认走系统 DNS）', () => {
    expect(fs.existsSync(path.join(ROOT, BASELINE)), `缺证据 ${BASELINE}`).toBe(true)
    const d = JSON.parse(read(BASELINE)) as Probe
    const dns = d.dns ?? {}
    expect(dns.installed, '★基线不该安装假解析器').toBe(false)
    expect(Number(dns.calls), '★基线不该有回调调用').toBe(0)
    expect(d.ok, '★基线请求应成功（系统 DNS 正常）').toBe(true)
    expect(Number(d.status), '★状态码 200').toBe(200)
  })

  it('★★★宿主源码：DNS 注入收在探针开关后（生产零影响）', () => {
    const s = read('hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h')
    // 必须是"仅 installed 时才接 dnsRules"
    expect(s, '★DNS 规则未收在 dnsProbe().installed 之后 ⇒ 生产路径被改变').toMatch(
      /if\s*\(\s*dnsProbe\(\)\.installed\s*\)\s*\{[\s\S]{0,200}RCP_DNS_RULE_DYNAMIC/,
    )
    // 必须用 DYNAMIC 规则（与 Android Dns.lookup 同构），不是 Static
    expect(s, '★未使用 RCP_DNS_RULE_DYNAMIC（与 Android Dns 同构的那条路）').toMatch(/RCP_DNS_RULE_DYNAMIC/)
    expect(s, '★回调形状应为 (host, port) → Rcp_IpAddress*').toMatch(
      /probeDnsLookup\(const char\* host,\s*uint16_t port\)/,
    )
  })
})

// tests/httpdns-wire.test.ts
// ★★★#1169：**HTTPDNS 端到端契约**（线格式 + 四层字段链 + 宿主可用性 + 真机证据）。
//
// 【这条能力为什么需要单独的判据组】
//   HTTPDNS 是 useFetch 最后一项真缺口，而它的失败形态**全部是静默的**：
//     · 线格式没写 tag 14 ⇒ 宿主收不到表 ⇒ 请求照常成功（**假绿**）；
//     · 字段链漏一层 ⇒ 同上（#1134 的 `redirectManual` 就是这样漏的）；
//     · 宿主忽略表 ⇒ 同上；
//     · iOS 静默忽略 ⇒ 业务以为走了 HTTPDNS、实际走系统 DNS（**假数据比缺数据更糟**）。
//   ⇒ 四组判据各守一层，缺任一层都会让"看起来能用、其实没生效"溜过去。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('★★★#1169 HTTPDNS · 线格式（tag 14）', () => {
  it('★★★TS SSOT 定义 HttpDns=14，且是 name-values（零新增编码形态）', () => {
    const s = read('packages/api/src/invoke-wire.ts')
    expect(s, '★缺 HttpDns tag').toMatch(/HttpDns:\s*14,/)
    // 必须是 name-values 原语（不是新造结构体）
    expect(s, '★编码未用 writeNameValues（自造了编码形态）').toMatch(
      /MetaTagInvoke\.HttpDns,\s*\(\)\s*=>\s*writeNameValues/,
    )
    expect(s, '★解码未用 readNameValues').toMatch(/case MetaTagInvoke\.HttpDns:\s*[\s\S]{0,80}readNameValues/)
  })

  it('★★★空表**不写** tag（与"不写"语义相同 ⇒ 不产生两种等价线格式形态）', () => {
    const s = read('packages/api/src/invoke-wire.ts')
    expect(s, '★空表也写 tag ⇒ parity 会出现一对多期望值').toMatch(
      /Object\.keys\(dns\)\.length\s*>\s*0[\s\S]{0,120}MetaTagInvoke\.HttpDns/,
    )
  })

  it('★★五端编解码都有 tag 14（漏一端 ⇒ 该端收到帧后丢失整张表）', () => {
    const ends = [
      ['Java（Android）', 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/InvokeWire.java', /TAG_HTTP_DNS\s*=\s*14/],
      ['Swift（iOS）', 'hosts/ios/ProteusHost/runtime/InvokeWire.swift', /TAG_HTTP_DNS:\s*UInt8\s*=\s*14/],
      ['ArkTS（鸿蒙）', 'hosts/harmony/host-app/entry/src/main/ets/runtime/InvokeWire.ts', /TAG_HTTP_DNS:\s*number\s*=\s*14/],
      ['C++（鸿蒙）', 'hosts/harmony/host-app/proteus_render/src/main/cpp/invoke_wire.h', /TAG_HTTP_DNS\s*=\s*14/],
    ] as const
    for (const [name, file, re] of ends) {
      expect(read(file), `★${name} 缺 tag 14`).toMatch(re)
    }
  })
})

describe('★★★#1169 HTTPDNS · 宿主可用性（三端如实分档）', () => {
  it('★★★Android：OkHttp Dns 三级回落（表 → resolver → 系统）', () => {
    const s = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpTransport.java')
    // 表命中
    expect(s, '★Android 未按表解析').toMatch(/table\.get\(|CALL_DNS\.get\(/)
    expect(s, '★Android 未统计表命中（判据无法证明生效）').toMatch(/dnsTableHits\+\+/)
    // ★系统回落：表里没有该域名 ⇒ 系统 DNS（不改变无关请求行为）
    expect(s, '★表未命中时未回落系统 DNS（会破坏无关域名）').toMatch(/Dns\.SYSTEM\.lookup/)
    // ★"表里有但 IP 全非法" ⇒ 显式失败（不静默回退）
    expect(s, '★表内 IP 全非法时静默回退系统 DNS（会掩盖业务给的错 IP）').toMatch(
      /UnknownHostException\(\s*"httpDns 表内无可用 IP/,
    )
  })

  it('★★★Android：per-call 表用 ThreadLocal（不按表分 client ⇒ 不碎连接池）', () => {
    const s = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/HttpTransport.java')
    expect(s, '★未用 ThreadLocal 传表').toMatch(/ThreadLocal<Map<String,\s*String>>\s+CALL_DNS/)
    // ★前提取证：同步 execute 在调用线程做 DNS（若改 enqueue，本机制失效）
    expect(s, '★未记录"同步 execute ⇒ 同线程"这个前提').toMatch(/caller-thread|lookup-thread|同步.*同.*线程/)
    // client 缓存键**不得**含 **per-call 表内容**（含了就会每表一个池）
    //   ★注意：键里**可以有**"是否装了进程级 resolver"（那是进程级、不随请求变）；
    //     但绝不能拼进 `cfg.httpDns` 的内容——否则 HTTPDNS 的 IP 轮换会让池无限分裂。
    const key = s.slice(s.indexOf('private static String clientKey('), s.indexOf('private static OkHttpClient clientFor('))
    expect(key, '★clientKey 用了 cfg.httpDns（表内容进键 ⇒ 每个不同表一个新连接池）').not.toMatch(/cfg\.httpDns/)
  })

  it('★★★鸿蒙：按表解析走 RCP_DNS_RULE_DYNAMIC（已真机证实的那条路）', () => {
    const s = read('hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h')
    expect(s, '★鸿蒙未实现按表解析').toMatch(/tableDnsLookup/)
    expect(s, '★未用 RCP_DNS_RULE_DYNAMIC（#1169 已真机证实该路生效）').toMatch(/RCP_DNS_RULE_DYNAMIC/)
    // 表未命中 ⇒ 返回 nullptr（回落系统 DNS）
    expect(s, '★表未命中未回落（会破坏无关域名）').toMatch(/lastSource = "miss";\s*return nullptr/)
    // ★生命周期守卫（表指针必须在任何出口清空，防悬垂）
    expect(s, '★缺 HttpDnsTableGuard（表指针可能悬垂）').toMatch(/struct HttpDnsTableGuard/)
  })

  it('★★★iOS：明确 `fetch.unsupported`（不静默忽略——假数据比缺数据更糟）', () => {
    const s = read('hosts/ios/ProteusHost/runtime/http-capability.swift')
    expect(s, '★iOS 未对 httpDns 明确报错（业务会以为生效了）').toMatch(
      /httpDns[\s\S]{0,200}fetch\.unsupported/,
    )
    expect(s, '★缺少"为什么不能实现"的说明（URLSession 无 DNS 钩子）').toMatch(/URLSession.*没有.*DNS|自定义 DNS 钩子/)
  })
})

describe('★★★#1169 HTTPDNS · 真机证据（Android）', () => {
  it('★★★注入不可达 IP ⇒ 请求失败；基线 ⇒ 成功；宿主记账 tableHits>0', () => {
    const p = 'hosts/android/results/httpdns-probe.json'
    if (!fs.existsSync(path.join(ROOT, p))) {
      expect(true, `⚠ 缺真机证据 ${p}（跑 bash hosts/android/run-httpdns-probe.sh）`).toBe(true)
      return
    }
    const r = JSON.parse(read(p)) as {
      probe?: {
        baseline_ok?: boolean; baseline_status?: number
        inject_ok?: boolean; inject_code?: string
        host_dns_stats?: { lookups?: number; tableHits?: number }
        ok?: boolean
      }
    }
    const d = r.probe ?? {}
    expect(d.ok, '★探针整体未通过').toBe(true)
    // ① 基线成功 ⇒ 域名本身可达（否则无法把"注入失败"归因到表）
    expect(d.baseline_ok, '★基线应成功').toBe(true)
    expect(Number(d.baseline_status), '★基线状态 200').toBe(200)
    // ② 注入不可达 IP ⇒ 必须失败
    expect(d.inject_ok, '★注入不可达 IP 后仍成功 ⇒ 表没生效').toBe(false)
    expect(String(d.inject_code), '★失败应是网络层，不是 unsupported').not.toBe('fetch.unsupported')
    // ③ ★★★**直接证据**：宿主记账显示表真的被命中
    //   ★这条是 #1169 首跑教训的产物：只有"注入后失败"时，仍可能是"网络本来就不通"；
    //     `tableHits > 0` 才把"表被采用"变成直接证据。
    expect(Number(d.host_dns_stats?.tableHits), '★★宿主记账 tableHits 应 >0（表真的被采用）').toBeGreaterThan(0)
    expect(Number(d.host_dns_stats?.lookups), '★DNS 回调应被调用（两次请求各一次）').toBeGreaterThanOrEqual(2)
  })

  it('★★★鸿蒙：表注入 ⇒ tableHits>0 且 lastSource=table（真机）', () => {
    const p = 'hosts/harmony/results/http-probe-dns-table.json'
    if (!fs.existsSync(path.join(ROOT, p))) {
      expect(true, `⚠ 缺真机证据 ${p}（跑 run-http-probe.sh --dns-host … --dns-ip …）`).toBe(true)
      return
    }
    const d = JSON.parse(read(p)) as {
      ok?: boolean
      reason?: string
      dns?: { installed?: boolean; calls?: number; tableRules?: number; tableHits?: number; lastSource?: string; host?: string }
    }
    const dns = d.dns ?? {}
    // ★核心：表被装上（tableRules>0）+ 真被命中（tableHits>0）+ 来源是表
    expect(Number(dns.tableRules), '★表规则未装上').toBeGreaterThan(0)
    expect(Number(dns.tableHits), '★鸿蒙表未被命中（表没生效）').toBeGreaterThan(0)
    expect(dns.lastSource, '★解析来源应是 table（不是 probe/system）').toBe('table')
    expect(dns.host, '★解析的域名应是注入的那个').toBe('example.com')
    // ★注入不可达 IP ⇒ 请求必须失败（与 Android 同一判据口径）
    expect(d.ok, '★注入不可达 IP 后仍成功 ⇒ 表没生效').toBe(false)
    // ★假解析器**不该**被装（两者互斥，见 http_probe.h 注释）
    expect(dns.installed, '★表注入时不该同时装假解析器（会互相覆盖）').toBe(false)
  })
})

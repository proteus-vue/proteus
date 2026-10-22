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

  it('★★★#1180 iOS **已支持** httpDns（B 路线落地）：不得再返回 fetch.unsupported', () => {
    const s = read('hosts/ios/ProteusHost/runtime/http-capability.swift')
    // ★#1169/#1176 时这里断言的是"**必须**明确 fetch.unsupported"——#1180 把 B 路线
    //   （进程内本地 CONNECT 代理）落地后，iOS **真的支持**了 ⇒ 判据方向翻转：
    //   再出现"因为不支持所以报错"就是功能回退（而且这种回退很隐蔽：请求照常成功，只是走了系统 DNS）。
    //   ★唯一还允许的 `fetch.unsupported` 是"表数量超上限"（那是资源约束，不是能力缺失），
    //   所以断言必须点名"不支持 DNS"这个语义已经消失，而不是简单 not.toMatch('fetch.unsupported')。
    expect(s, '★iOS 又回到了"不支持自定义 DNS"的报错（B 路线被回退）').not.toMatch(
      /不支持自定义 DNS|httpDns 仅在 Android\/鸿蒙 生效/,
    )
    // 必须真的按表选 session（而不是把表丢掉）
    expect(s, '★iOS 没有按表选 session（httpDns 会被静默忽略）').toMatch(/session\(for:\s*f\.httpDns\)/)
    // 超上限时的报错必须存在（资源约束要如实说，不能悄悄回落）
    expect(s, '★表超上限时静默回落到默认 session（会变成走系统 DNS 的假数据）').toMatch(
      /httpDns 表数量超过上限/,
    )
  })

  it('★★★#1180 iOS 代理实现的关键约束（一表一 session / 回落可见 / 候选顺序）', () => {
    const proxy = read('hosts/ios/ProteusHost/runtime/HttpDnsProxy.swift')
    // ① 表未命中必须回落系统解析，且**记账可见**（不得静默）
    expect(proxy, '★表未命中未回落系统解析（会把无关域名一起弄坏）').toMatch(/resolveSystem\(/)
    expect(proxy, '★回落不可见（lastSource 没有 system 分支）').toMatch(/source = \.system/)
    // ② 多 IP 按顺序试（表给多个 IP 时第一个连不上要试下一个）
    expect(proxy, '★多 IP 未按顺序尝试').toMatch(/for ip in candidates/)
    // ③ 只监听 loopback（不能把代理暴露到局域网）
    expect(proxy, '★代理监听的地址不是 loopback（会对外暴露）').toMatch(/inet_addr\("127\.0\.0\.1"\)/)
    // ④ 线格式是 name-values（值 = 逗号分隔 IP）⇒ 必须有归一化
    expect(proxy, '★缺 name-values 归一化（线格式与内部结构不匹配）').toMatch(
      /static func normalize\(_ nv: InvokeWire\.NameValues\?\)/,
    )
  })

  it('★★★#1180 iOS 生产面**真机**证据入库（注入失败 / 基线成功 / tableHits>0 / 回落可见）', () => {
    const p = 'hosts/ios/results/httpdns-prod-device.json'
    expect(fs.existsSync(path.join(ROOT, p)), `★缺生产面真机证据 ${p}（跑 bash hosts/ios/run-httpdns-prod-probe.sh）`).toBe(true)
    const r = JSON.parse(read(p))
    expect(r.verdict, '★生产面结论不是 HTTPDNS_PROD_DEVICE_OK').toBe('HTTPDNS_PROD_DEVICE_OK')
    // ★双向对照：这两条合起来才排除"碰巧失败"
    expect(r.inject?.ok, '★注入不可达 IP 却没失败 ⇒ 表没生效（系统 DNS 解析成功）').toBe(false)
    expect(r.baseline?.ok, '★基线失败 ⇒ 测试环境本身不通，判据不成立').toBe(true)
    expect(Number(r.dnsStats?.tableHits ?? 0), '★tableHits=0 ⇒ 表没被采用').toBeGreaterThan(0)
    expect(Number(r.dnsStats?.misses ?? 0), '★misses=0 ⇒ 没有验证"表未命中回落"这条路径').toBeGreaterThan(0)
  })

  it('★★★#1176 iOS：不得把实现限制说成「平台不支持」（#1180 已实现，形式随之调整）', () => {
    // ★#1176 的教训仍在（把实现限制说成平台限制 = 与 #1165 同族的"夸大"），
    //   但 #1180 落地 B 路线后，原来"必须留下 SNI/SecPolicyCreateSSL 指路"的那条断言
    //   失去了对象（那是"还没实现时的出口说明"，现在实现在 `HttpDnsProxy.swift` 里）。
    //   ⇒ 保留**语义判据**：全仓不得再出现"iOS 平台不支持 HTTPDNS"这类表述。
    const files = [
      'hosts/ios/ProteusHost/runtime/http-capability.swift',
      'hosts/ios/ProteusHost/runtime/HttpDnsProxy.swift',
      'docs/proteus-network-plan/00-capability-matrix.md',
    ]
    for (const f of files) {
      const s = read(f)
      expect(s, `★${f} 仍把限制说成平台级（iOS 平台不支持 / 平台边界）`).not.toMatch(
        /iOS\s*(平台)?\s*不支持\s*HTTPDNS|平台边界/,
      )
    }
    // 路线评估文档必须仍被引用（换人接手时能找到"为什么选 B"）
    expect(read('hosts/ios/ProteusHost/runtime/HttpDnsProxy.swift'), '★HttpDnsProxy 未指向路线评估文档').toMatch(
      /02-ios-httpdns-industry-survey\.md/,
    )
  })

  it('★★★#1176 业内调研文档：四条路线 + 微信走的是自建栈', () => {
    const p = 'docs/proteus-network-plan/02-ios-httpdns-industry-survey.md'
    expect(fs.existsSync(path.join(ROOT, p)), `★缺业内路线评估 ${p}`).toBe(true)
    const s = read(p)
    for (const route of ['**A. IP 直连', '**B. 本地 CONNECT 代理', '**C. 自建网络栈', '**D. 系统 DNS Proxy']) {
      expect(s, `★02 篇缺路线 ${route}`).toContain(route)
    }
    // 微信的结论必须写明"自建栈(C)"，不能含糊说"B"
    expect(s, '★02 篇未明确微信小程序走的是 C（自建栈）').toMatch(
      /微信小程序走的是\W{0,2}C（容器自建网络栈）/,
    )
    // 能力形状差异（微信=服务商ID；我们=自定义表）是"不能照抄 API"的依据
    expect(s, '★未写明微信只开放服务商 ID、不支持自定义 IP 表').toMatch(/httpDNSServiceId/)
  })

  it('★★★#1178 B 路线：探针证据入库且结论为「可行」（SNI 是原域名、h2 保住）', () => {
    const p = 'hosts/ios/results/httpdns-route-b.json'
    expect(fs.existsSync(path.join(ROOT, p)), `★缺 B 路线证据 ${p}（跑 bash hosts/ios/run-httpdns-route-b-probe.sh）`).toBe(true)
    const r = JSON.parse(read(p))
    expect(r.verdict, '★B 路线结论不是 ROUTE_B_FEASIBLE（探针红过会留下这个字段）').toBe('ROUTE_B_FEASIBLE')
    // ★SNI 必须是原域名——若退化成 IP，整条 B 路线的价值（保 SNI）就没了
    expect(Array.isArray(r.sniValues) && r.sniValues.length > 0, '★没有 SNI 读数（空数组时 every() 恒真，必须显式要求非空）').toBe(true)
    expect(r.sniValues.every((v: string) => v === 'sni-probe.local'), `★SNI 退化了（实得 ${JSON.stringify(r.sniValues)}）`).toBe(true)
    // ★h2 必须保住（否则 B 相对 A 的核心优势没了）
    expect(r.publicTrace?.http, '★经代理后 h2 丢了（B 的核心优势是做得到 http/2）').toBe('http/2')
    expect(r.publicTrace?.visit_scheme, '★端到端不再是 https').toBe('https')
    // 隧道复用：3 次请求 1 个 CONNECT（探针默认 repeats=3）
    expect(r.connectCount, '★代理一个 CONNECT 都没收到（配置没生效）').toBeGreaterThan(0)
  })

  it('★★★#1178 B 路线：探针脚本本身有端口预检（防「旧进程冒充就绪」）', () => {
    const s = read('hosts/ios/run-httpdns-route-b-probe.sh')
    // 剥掉注释再判——否则注释里提到 `wait_for --port` 会让 not.toMatch 假红
    const code = s
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n')
    // ★装置坑教训：端口被残留进程占着时，新进程 bind 失败被静默吞掉，
    //   而 `wait_for --port` 因旧进程在监听照样通过 ⇒ 判据读别人的记账。
    expect(code, '★缺端口占用预检（会被残留进程冒充）').toMatch(/lsof -nP -iTCP:"\$p" -sTCP:LISTEN/)
    expect(code, '★就绪判据不应依赖 --port（会被别人的监听冒充）').not.toMatch(/--port "127\.0\.0\.1/)
    expect(code, '★就绪判据应用文件（= 自己的进程真的 listen 过）').toMatch(/--file "\$OUT_DIR\/httpdns-route-b-proxy\.json"/)
  })

  it('★★★#1179 B 路线：**真机**证据入库（模拟器绿不算数——真机才是落地前提）', () => {
    const p = 'hosts/ios/results/httpdns-b-device.json'
    expect(fs.existsSync(path.join(ROOT, p)), `★缺 B 路线真机证据 ${p}（跑 bash hosts/ios/run-httpdns-b-device-probe.sh）`).toBe(true)
    const r = JSON.parse(read(p))
    expect(r.verdict, '★真机 B 路线结论不是 ROUTE_B_DEVICE_OK').toBe('ROUTE_B_DEVICE_OK')
    // ★SNI 由真机侧服务端 SNICallback 读——"隧道里发的仍是原域名"的直接证据
    expect(Array.isArray(r.sniValues) && r.sniValues.length > 0, '★真机没读到 SNI').toBe(true)
    expect(r.sniValues.every((v: string) => v === 'sni-probe.local'), `★真机 SNI 退化（实得 ${JSON.stringify(r.sniValues)}）`).toBe(true)
    // ★复用必须用**公网那组**判（自签证书让假域名每次失败重连 = 装置变量，不是路线缺陷）
    expect(r.fakeConnects, '★真机代理没收到假域名的 CONNECT').toBeGreaterThan(0)
    expect(r.connectCount, '★真机代理一个 CONNECT 都没收到').toBeGreaterThan(0)
    expect(r.probe?.public_ok, `★公网经代理不通（生产形态不成立；实得 ${JSON.stringify(r.probe?.public_statuses)}）`).toBe(true)
    expect(r.proxyEnv, '★代理环境变量没转发进 App（参数丢失会伪装成功能失败）').toBeTruthy()
  })

  it('★★★#1179 探针登记第三处：参数分派（superapp-scene.swift）必须被覆盖', () => {
    // ★漏洞现场：只加 ProbeConfig 不加 case ⇒ 走 default ⇒ 额外参数静默丢弃
    //   ⇒ 现象是"公网经代理全失败"，真因只是参数没传进去。
    const reg = read('tests/host-probe-registry.test.ts')
    expect(reg, '★host-probe-registry 未覆盖 Swift 参数分派（第三处）').toMatch(/superapp-scene\.swift/)
    expect(reg, '★host-probe-registry 未校验 switch 分派').toMatch(/-probe\)="/)
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

// tests/harmony-unsupported-features.test.ts
// ★★★#1203：鸿蒙宿主的**「本端不支持的能力」必须如实拒绝，不许静默放行**。
//
// 【这条判据守什么（一个安全面的静默失效）】
//   `invoke_wire.h` 早就解析了 `tlsPins` / `tlsPinOnly`（#1153 五端线格式），
//   但鸿蒙宿主**从来没消费过它们** ⇒ 业务配了 pin、以为多了防 MITM 一道防线，
//   而请求**不带任何指纹校验照常发出**。这比"没有这个能力"危险得多：
//   **安全策略假成立**。同族形态还有 `redirectManual`（硬编码 `autoRedirect=true`，
//   `useFetch({redirect:'manual'})` 在鸿蒙上会照常跟随）与 `upload`（帧里有、宿主只发空 body）。
//
// 【★为什么这条判据要"逐字段"而不是"整体 grep"】
//   本仓记过的假绿形态：「源码里出现某字符串」≠「执行路径上真的有」。
//   所以这里做两件事：
//     ① 静态：`proteus_http_guard.h` 的 `unsupportedFeatureReason` 必须真的读这些字段；
//     ② 证据：真机回执必须证明"请求被拒且未发出流量"（`dns/limit` 读数 + `ok=false`）。
//   ★更关键的一条（本单发现）：**字段解析点与消费点之间要建立可检查的联系**——
//     `invoke_wire.h` 里 `TAG_PINS` 解析存在、而消费点缺失，任何"看字段名"的判据都会漏。
//     故这里逐个字段断言消费点存在，并留一条"消费点清点"用例，新增字段漏接时能被发现。
//
// 【诚实边界】本文件是静态 + 已入库证据判据；**"真机上确实没发出流量"靠的是
//   `gateInstalled:false`（逐块回调都没装上 ⇒ 请求没开始收数据）+ `ok:false`**，
//   严格说它不是抓包证明（抓包需另一套装置）。要更强的证据需在服务端侧记账（DoH 那套手法）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')
const GUARD = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http_guard.h'
const HTTP = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_http.h'
const WIRE = 'hosts/harmony/host-app/proteus_render/src/main/cpp/invoke_wire.h'
const EVIDENCE = 'hosts/harmony/results/http-probe-tls-pins-reject.json'

describe('★★★#1203 鸿蒙不支持的能力必须如实拒绝（不许静默放行）', () => {
  it('★tlsPins / tlsPinOnly 有消费点（帧里解析了却不用 = 安全策略假成立）', () => {
    const g = read(GUARD)
    // ★字段必须被真的读（不是只在注释里出现）
    expect(g, '★guard 没读 tlsPins（配了 pin 会被静默忽略）').toMatch(/f\.tlsPins\.has/)
    expect(g, '★guard 没读 tlsPinOnly').toMatch(/f\.tlsPinOnly\.has/)
    // ★拒绝码必须是 fetch.unsupported（tlsError 会让业务误判成"证书/pin 配错"）
    expect(g, '★pin 拒绝码应为 fetch.unsupported').toMatch(/fetch\.unsupported[\s\S]{0,200}pinning/)
    /**
     * ★"不写成 tlsError" 必须**只在代码行里**判——本仓记过的假红形态就是正则命中注释
     *   （本文件第一版正是踩到：说明性注释里提到 `fetch.tlsError` 就判红）。
     *   口径：去掉行注释与块注释后再匹配。
     */
    const codeOnly = g
      .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
      .replace(/^\s*\/\/.*$/gm, '')       // 整行行注释
    expect(codeOnly, '★不应把 pin 拒绝写成 tlsError（业务会去查证书，方向就错了）').not.toMatch(/fetch\.tlsError/)
  })

  it('★upload 有消费点且如实拒绝（静默发空请求会让服务端写入空记录）', () => {
    const g = read(GUARD)
    expect(g, '★guard 没读 upload（会静默发出不带文件的请求）').toMatch(/f\.upload\.has/)
    const up = g.slice(g.indexOf('f.upload.has'))
    expect(up, '★upload 拒绝码应为 fetch.unsupported').toMatch(/fetch\.unsupported/)
  })

  it('★redirectManual 必须真的生效（不能硬编码 true）', () => {
    const s = read(HTTP)
    // ★核心：autoRedirect 必须由帧决定，而不是常量
    expect(s, '★autoRedirect 仍被硬编码 ⇒ manual 在鸿蒙上无效').not.toMatch(/autoRedirect\s*=\s*true\s*;/)
    expect(s, '★autoRedirect 应读取 f.redirectManual').toMatch(/autoRedirect\s*=\s*!\(f\.redirectManual/)
  })

  it('★guard 在**发请求之前**被调用（pin 必须拒绝在流量发出前）', () => {
    const s = read(HTTP)
    const atGuard = s.indexOf('unsupportedFeatureReason(f)')
    expect(atGuard, '★handle() 里没有调用 unsupportedFeatureReason').toBeGreaterThan(0)
    // 请求真正发出的位置：取数调用点（★#1204 起是 `api.fetchAsync`，原为 `pFetchAsync`）
    const atFetch = s.indexOf('api.fetchAsync')
    expect(atFetch, '★找不到取数调用点').toBeGreaterThan(0)
    // ★前者必须在后者之前（否则 pin 拒绝发生在已发出流量之后 = 白拒）
    expect(atGuard, '★guard 必须在取数调用之前（否则流量已发出）').toBeLessThan(atFetch)
  })

  it('★★★真机证据：配了 tlsPins ⇒ ok=false + fetch.unsupported + 未发出流量', () => {
    expect(fs.existsSync(path.join(ROOT, EVIDENCE)),
      `缺证据 ${EVIDENCE}（跑 bash hosts/harmony/run-http-probe.sh --tls-pins=…）`).toBe(true)
    const d = JSON.parse(read(EVIDENCE)) as {
      ok?: boolean; reason?: string; status?: number
      limit?: { gateInstalled?: boolean; seen?: number }
    }
    expect(d.ok, '★配了 pin 请求却成功 ⇒ pin 被静默忽略（安全策略假成立）').toBe(false)
    const r = String(d.reason ?? '')
    expect(r, '★拒绝码应为 fetch.unsupported').toContain('fetch.unsupported')
    expect(r, '★应点明是 pinning').toContain('pinning')
    expect(r, '★应说清未发出流量').toContain('未发出任何流量')
    // ★"没发出流量"的可核对痕迹：逐块闸从未装上、一个字节都没收到
    expect(d.limit?.gateInstalled, '★逐块闸被装上 ⇒ 请求可能已经开始').toBe(false)
    expect(Number(d.limit?.seen ?? 0), '★收到了响应字节 ⇒ 请求真的发出去了').toBe(0)
  })

  it('★★消费点清点：InvokeFrame 的每个"能力意图"字段都要么被消费、要么在 guard 里被拒', () => {
    // ★这条守的是本单的**根因**：字段在 wire 里有解析、宿主不用 ⇒ 静默失效。
    //   新加能力字段时若忘了消费，这里会报出来（比"线上发现配了没用"便宜得多）。
    const wire = read(WIRE)
    const frame = wire.slice(wire.indexOf('struct InvokeFrame'), wire.indexOf('};', wire.indexOf('struct InvokeFrame')))
    // 只清点"业务会给的能力开关"（传输机制字段如 method/reqId/url 不在此列）
    const CAPABILITY_FIELDS = ['stream', 'savePath', 'upload', 'redirectManual', 'tlsPins', 'tlsPinOnly', 'httpDns']
    const host = read(HTTP)
    const guard = read(GUARD)
    const unconsumed = CAPABILITY_FIELDS.filter((f) => {
      const decl = new RegExp(`\\b${f}\\b`)
      if (!decl.test(frame)) return false          // 帧里没这个字段 ⇒ 不适用
      // 消费点 = 宿主实现（含 savePath 的 SaveSession）或 guard 的拒绝分支
      return !(new RegExp(`f\\.${f}\\b`).test(host) || new RegExp(`f\\.${f}\\b`).test(guard))
    })
    expect(unconsumed, `★这些字段在帧里有解析但宿主不消费（静默失效）：${unconsumed.join(', ')}`).toEqual([])
  })
})

// tests/android-okhttp-transport.test.ts
// ★★★决策 #1160：**Android 传输栈 = OkHttp** 的静态判据（HTTP/2 + 全字段读数 + HTTPDNS 接入点）。
//
// 【为什么需要这组判据（它守的是什么）】
//   换栈买到的三样收益，每一样都有**静默失败**的形态——功能全绿、没有任何报错：
//     ① HTTP/2：`protocols()` 忘了列 `HTTP_2`，或某个路径绕过 `HttpTransport` 自建 client ⇒ 回到 h1；
//     ② 连接复用：每请求 `new OkHttpClient()` ⇒ **每个 client 一个池** ⇒ 复用归零
//        （#1155 的真回归：pinning 每请求新建 SSLContext ⇒ 池按 factory 分桶 ⇒ 3/3，零日志）；
//     ③ 传输读数：EventListener 没挂、或读数没写回帧 ⇒ `meta.transport` 变空，而请求完全正常。
//   ⇒ 真机判据（`run-transport-probe.sh` 的 `http2_ok` / `conn_reused_ok`）只能证"当下这一次"；
//     本组判据守**结构性形态**，让"改坏了"在 2 毫秒内红，而不是等真机跑完才发现。
//
// 【★为什么锁"性质"而不是具体 API】（本仓已因"锁 API 名"改过 5 轮判据）
//   `HttpURLConnection` → OkHttp 换的是**实现**；「预判闸 / 定长流式 / 真中止」这些**性质**不变。
//   ⇒ 换栈时只该改"性质没有被破坏"的表达方式，不该把性质判据一起删掉。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const RT = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime'
const TRANSPORT = `${RT}/HttpTransport.java`
const CAPABILITY = `${RT}/HttpCapability.java`
const TLS = `${RT}/TlsPinning.java`
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * 去注释（**行注释 + 块注释**，保留换行以便行号仍对得上）。
 *
 * ★本仓第 N 次教训：「断言命中**注释里**的字符串 ⇒ 断言等于没有」。
 * 本轮实测再复现一次：`openConnection()` 只出现在文件头的 `/** … *​/` 块注释里
 * （"不要在任何路径里再写 new URL(...).openConnection()"），只去 `//` 的版本会让这条判据**永远红**。
 */
function stripLineComments(s: string): string {
  // 先块注释（跨行），再行注释；两者都用等量换行占位，保持行结构
  const noBlock = s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
  return noBlock
    .split('\n')
    .map((l) => {
      const i = l.indexOf('//')
      return i >= 0 ? l.slice(0, i) : l
    })
    .join('\n')
}

describe('★★#1160 Android 传输栈：唯一入口 + 连接复用不退化', () => {
  const transport = src(TRANSPORT)
  const transportCode = stripLineComments(transport)
  const capabilityCode = stripLineComments(src(CAPABILITY))

  it('★★★`OkHttpClient` 构造只有**一处**且按配置缓存（每请求 new = 连接池归零）', () => {
    // 构造点唯一：`new OkHttpClient.Builder()` 只允许出现在 buildClient 里
    const builds = transportCode.match(/new OkHttpClient\.Builder\(\)/g) ?? []
    expect(builds.length, `★发现 ${builds.length} 处 new OkHttpClient.Builder()（应只有 1 处：buildClient）`).toBe(1)
    // ★缓存必须"先查再建、命中即返回"（查了却继续往下走等于没缓存）
    // ★★★必须用**去注释**文本：独立验证实测——拿原文断言时，把 `clientFor` 改成直接
    //   `buildClient(cfg)`（每请求新建、连接池归零）只要注释里还有这串字就仍全绿。
    expect(transportCode, '★clientFor 里没有缓存查询（CLIENTS.get）⇒ 每请求新建 client ⇒ 连接池归零').toMatch(
      /CLIENTS\.get\(/,
    )
    expect(transportCode, '★查了缓存但没有提前返回（命中后仍会新建）').toMatch(
      /if\s*\(cached\s*!=\s*null\)\s*return\s+cached/,
    )
    expect(transportCode, '★clientFor 里没有缓存写入（CLIENTS.putIfAbsent）').toMatch(/CLIENTS\.putIfAbsent\(/)
    expect(transportCode, '★CLIENTS 不是 ConcurrentHashMap（多线程请求会竞争）').toMatch(/ConcurrentHashMap/)
    // ★★★缓存必须**真的被调用**：`newCall` 必须走 `clientFor(cfg)`，
    //   而不是直接 `buildClient(cfg)`（独立验证的变异 G：改成直建后原判据全绿）
    const newCallBody = (() => {
      const s = transportCode.indexOf('public static Call newCall(')
      expect(s, '找不到 newCall').toBeGreaterThan(0)
      return transportCode.slice(s, s + 900)
    })()
    expect(newCallBody, '★newCall 未走 clientFor（直接 buildClient ⇒ 每请求新建 ⇒ 池归零）').toMatch(
      /OkHttpClient client = clientFor\(cfg\)/,
    )
    expect(newCallBody, '★newCall 里出现了 buildClient（绕过缓存）').not.toMatch(/buildClient\(/)
  })

  it('★★★缓存键必须含**影响连接身份的全部配置**（pin 串 + pinOnly + 是否注入 DNS）', () => {
    // ★理由（独立验证点名的安全面）：若键漏了 pinOnly，「替代系统信任」与「叠加」两档会共用
    //   同一个 client ⇒ **信任语义串档**（一个请求放宽了信任锚，另一个也跟着放宽）。
    //   若漏了 hasDns，切换 HTTPDNS 后旧 client 仍用系统 DNS（新配置静默无效）。
    const s = transportCode.indexOf('private static String clientKey(')
    expect(s, '找不到 clientKey').toBeGreaterThan(0)
    const body = transportCode.slice(s, s + 600)
    expect(body, '★clientKey 未含 pin 串').toMatch(/pins/)
    expect(body, '★clientKey 未含 pinOnly ⇒ 两档信任语义共用一个 client（安全面）').toMatch(/tlsPinOnly/)
    expect(body, '★clientKey 未含 DNS 开关 ⇒ 切 HTTPDNS 后旧 client 仍用系统 DNS').toMatch(/hasDns/)
  })

  it('★★★per-call 配置走 `newBuilder()`（共享连接池），不是新建 client', () => {
    // ★newBuilder() 实测共享同一 ConnectionPool + Dispatcher（见 plan §3 的验证记录）
    // ★★★必须去注释断言：独立验证实测——把 `callClient = client.newBuilder()...build()` 改成
    //   `callClient = client`（注释保留）时，原文断言仍绿，而 `redirectManual` 会**静默失效**
    //   （#1134 要防的 open-redirect 凭据泄露防线）。
    expect(transportCode, '★per-call 配置未走 newBuilder()（若在此 new client ⇒ 池归零）').toMatch(
      /client\.newBuilder\(\)/,
    )
    // ★newCall 里不得出现任何 client 构造（构造只允许在 buildClient 内）
    const s = transportCode.indexOf('public static Call newCall(')
    const body = transportCode.slice(s, s + 900)
    expect(body, '★newCall 里 new 了 client（应只经 newBuilder 派生）').not.toMatch(/new OkHttpClient/)
    // ★★★派生出来的 client 必须**真的被用来发请求**：独立验证的变异 G 把 `callClient = client`
    //   后又留一个 `client.newBuilder()` 空调用 ⇒ 旧判据全绿，而 `followRedirects/timeout`
    //   全部**没生效**（#1134 的 open-redirect 防线静默失效）。
    //   ⇒ 断言 `return callClient.newCall(req)`（发请求用的是派生 client，不是原 client）。
    expect(body, '★newCall 用的是原 client（派生配置未生效 ⇒ redirectManual/timeout 静默失效）').toMatch(
      /return callClient\.newCall\(req\)/,
    )
    expect(body, '★callClient 未从 newBuilder 派生').toMatch(/OkHttpClient callClient = client\.newBuilder\(\)/)
  })

  it('★★HTTP/2 必须**显式**列在最前（删掉即回归到 h1，且无任何报错）', () => {
    // ★★★必须去注释：第二轮独立验证的 M8（把真实 protocols 只留 h1、原串留在注释里）旧判据全绿。
    expect(transportCode, '★protocols 未显式列 HTTP_2 ⇒ 回到 h1（#1155 的端差异原状）').toMatch(
      /protocols\(\s*java\.util\.Arrays\.asList\(\s*Protocol\.HTTP_2\s*,\s*Protocol\.HTTP_1_1\s*\)\s*\)/,
    )
  })

  it('★★四条请求路径全部经 `HttpTransport.newCall`（不得有第二条建连路径）', () => {
    // 四条路径各有一处 HttpTransport.newCall
    const calls = capabilityCode.match(/HttpTransport\.newCall\(/g) ?? []
    expect(calls.length, `★只有 ${calls.length} 条路径用了 HttpTransport.newCall（应有 4 条：整包/落盘/流式/上传）`).toBe(4)
    // ★仓内不得再出现任何直接建连（换栈后这些形态都是"绕过唯一入口"）
    //   ★必须用**去注释**文本：`openConnection` 在文件头注释里也出现（"不要在任何路径里再写…"），
    //     拿原文断言会命中注释 ⇒ 这条判据会永远红（本仓"断言命中注释"已踩 N 次）
    expect(capabilityCode, '★仍存在 `openConnection()`（绕过唯一入口 ⇒ 该路径无 h2/无读数）').not.toMatch(/openConnection\(/)
    expect(capabilityCode, '★仍 import HttpURLConnection（传输本体应已全部换栈）').not.toMatch(
      /import\s+java\.net\.HttpURLConnection/,
    )
    // ★仓内不得有第二处 OkHttpClient 构造（本条与上面「唯一构造」互为纵深）
    expect(capabilityCode, '★HttpCapability 里自己 new 了 OkHttpClient（应只经 HttpTransport）').not.toMatch(
      /new\s+OkHttpClient/,
    )
  })

  it('★★响应必须关闭，且**每条路径**都在读完体之后才关（OkHttp 要关响应体才还池）', () => {
    const closes = capabilityCode.match(/closeResp\(resp\)/g) ?? []
    expect(closes.length, `★只有 ${closes.length} 条路径关闭了响应（应有 4 条）`).toBe(4)
    expect(capabilityCode, '★closeResp 未真正调用 Response.close()（连接不会还池 ⇒ 下次不复用）').toMatch(
      /resp\.close\(\)/,
    )
    // ★★★第二轮独立验证的 M5c：把**落盘路径**的关闭移到读体之前、总数仍是 4 ⇒ 旧判据（只比全局
    //   第一个 bodyStream 与第一个 closeResp）全绿，而那条路径每请求必坏。
    //   ⇒ 必须**逐路径**检查：以每个 `perform*` 函数体为单位，bodyStream 必须在 closeResp 之前。
    const fns = [
      'private static InvokeWire.ResolveFrame perform(',
      'private static InvokeWire.ResolveFrame performStreamUpload(',
      'private static InvokeWire.ResolveFrame performSaveToFile(',
      'private static void performStreaming(',
    ]
    for (const sig of fns) {
      const start = capabilityCode.indexOf(sig)
      expect(start, `找不到 ${sig}`).toBeGreaterThan(0)
      const seg = capabilityCode.slice(start, start + 7000)
      const readBody = seg.indexOf('HttpTransport.bodyStream(resp)')
      const close = seg.indexOf('closeResp(resp)')
      expect(readBody, `${sig} 里没有 bodyStream`).toBeGreaterThan(0)
      expect(close, `${sig} 里没有 closeResp`).toBeGreaterThan(0)
      expect(readBody, `★${sig} 里 closeResp 早于 bodyStream（读的是已关闭的响应 ⇒ 该路径每请求必坏）`).toBeLessThan(close)
    }
  })

  it('★★★请求体必须在**唯一映射**里装配，且空体必须转成 null（GET 挂空体会被 OkHttp 拒）', () => {
    // 【缺陷形态（独立验证抓出）】换栈第一版让落盘/流式各自 `cfg.body = …`，整包路径漏了
    //   ⇒ 所有带 data 的 POST/PUT 发空体。⇒ 正解是收进 buildCallConfig，四条路径不再各自搬。
    const s = capabilityCode.indexOf('static HttpTransport.CallConfig buildCallConfig(')
    expect(s, '找不到 buildCallConfig').toBeGreaterThan(0)
    const end = capabilityCode.indexOf('static String protoOf(')
    const body = capabilityCode.slice(s, end)
    expect(body, '★buildCallConfig 未装配 body ⇒ 整包路径会发空体（POST/PUT 静默坏）').toMatch(
      /cfg\.body\s*=\s*f\.body/,
    )
    // ★★★空体守卫（第二轮独立验证的变异 M6：去掉长度判断时 25 条判据全绿，而所有 GET 会抛
    //   `method GET must not have a request body`）。`InvokeFrame.body` 恒非 null（默认 EMPTY）
    //   ⇒ 必须 `length > 0` 才挂体。
    expect(body, '★缺空体守卫（`f.body.length > 0`）⇒ GET 会被挂上空体数组 ⇒ OkHttp 直接抛异常').toMatch(
      /cfg\.body\s*=\s*f\.body\s*!=\s*null\s*&&\s*f\.body\.length\s*>\s*0\s*\?\s*f\.body\s*:\s*null/,
    )
    // ★各路径不得再各自搬 body（否则"新增一条路径又漏"的病根没除）
    const assignments = capabilityCode.match(/\bcfg\.body\s*=/g) ?? []
    expect(
      assignments.length,
      `★cfg.body 被赋值 ${assignments.length} 处（应只有 2 处：buildCallConfig 装配 + 上传清空）`,
    ).toBe(2)
    // ★上传路径的体必须来自 bodyWriter（而不是"恰好 cfg.body=null 这个写法"）。
    const upStart = capabilityCode.indexOf('private static InvokeWire.ResolveFrame performStreamUpload')
    const upEnd = capabilityCode.indexOf('static final class UploadStats')
    const up = capabilityCode.slice(upStart, upEnd)
    // ★★#1336 修正（**既存断言漂移**）：实现已改成经 `UploadBackpressure.streamBody(...)` 构造
    //   （#1160 之后加了背压/慢写记账），而断言写死旧形态 `new HttpTransport.BodyWriter`
    //   ⇒ 判据比实现旧、反而报红。**关心的是"上传路径挂了 bodyWriter"**，不是具体构造形式。
    expect(up, '★上传路径未挂 bodyWriter（体应由回调产生）').toMatch(/cfg\.bodyWriter\s*=\s*[\w.]+\.streamBody\(/)
    expect(up, '★上传路径未清掉整包 body（否则走 byte[] 路径，文件不会被发送）').toMatch(/cfg\.body\s*=\s*null/)
  })

  it('★★★Content-Type 必须由**调用方头优先**决定（否则 encodeBody 的推导值会静默覆盖业务头）', () => {
    // 【缺陷形态（第二轮独立验证抓出）】OkHttp 实测 MediaType 优先于同名头；而 `encodeBody`
    //   会为字符串 data 自动填 `contentType='text/plain'`、对象填 `application/json`
    //   ⇒ 若只把 `f.contentType` 喂给 MediaType，调用方显式设的 `application/x-www-form-urlencoded` /
    //     `text/csv` / 带 charset 的类型会被**静默覆盖**（旧 HttpURLConnection 实现是调用方头优先）。
    const s = capabilityCode.indexOf('static HttpTransport.CallConfig buildCallConfig(')
    const end = capabilityCode.indexOf('static String protoOf(')
    const body = capabilityCode.slice(s, end)
    expect(body, '★未从调用方头取 Content-Type ⇒ 业务显式类型会被推导值覆盖').toMatch(
      /headerValueIgnoreCase\(\s*f\.headers,\s*"content-type"\s*\)/,
    )
    expect(body, '★cfg.contentType 未按「调用方头优先，否则 f.contentType」决定').toMatch(
      /cfg\.contentType\s*=\s*callerCt\s*!=\s*null[\s\S]{0,80}callerCt\s*:\s*f\.contentType/,
    )
    expect(body, '★头里仍留着 content-type（与 cfg.contentType 两处并存会漂移）').toMatch(
      /equalsIgnoreCase\("content-type"\)\s*\)\s*continue/,
    )
    // ★★★第三轮独立验证的 X3：保留正确的首处赋值、再在后面加一行 `cfg.contentType = f.contentType;`
    //   （= 完整复现阻断 B）时，只匹配"首次赋值"的正则仍命中 ⇒ 全绿。
    //   ⇒ 断言 `cfg.contentType =` 在 buildCallConfig 里**恰好 1 处**。
    const assigns = body.match(/cfg\.contentType\s*=/g) ?? []
    expect(assigns.length, `★buildCallConfig 里 cfg.contentType 被赋值 ${assigns.length} 处（应恰好 1 处，多出的是静默覆盖）`).toBe(1)
  })

  it('★★★无体请求的调用方 Content-Type 必须**留在 headers**（第三轮抓出的 P2 回归）', () => {
    // 【缺陷形态】把调用方 CT 一律从 headers 搬到 `cfg.contentType` ⇒ 无体时没有 RequestBody
    //   ⇒ 该头**整条消失**（GET/DELETE/空体 POST 实测变 null），与旧 HttpURLConnection 实现
    //   及 iOS/鸿蒙（先写头、仅缺失时补）都不一致。
    const s = capabilityCode.indexOf('static HttpTransport.CallConfig buildCallConfig(')
    const end = capabilityCode.indexOf('static String protoOf(')
    const body = capabilityCode.slice(s, end)
    // 只在有体时收口 CT（无体时保留头）
    expect(body, '★未按「有体」条件决定是否收口 CT ⇒ 无体请求的显式 CT 会丢').toMatch(
      /boolean\s+hasBodyForCt\s*=\s*cfg\.body\s*!=\s*null/,
    )
    expect(body, '★剔除 content-type 头时未加「有体」条件 ⇒ 无体请求的 CT 被删掉').toMatch(
      /hasBodyForCt\s*&&\s*e\.getKey\(\)\.equalsIgnoreCase\("content-type"\)/,
    )
  })

  it('★★★四条路径都必须把读数写回帧，且取的是**本次请求**的 metrics', () => {
    // 文件头明写要守"`meta.transport` 变空"这种形态，但旧判据零覆盖（只靠真机间接兜）。
    const writes = capabilityCode.match(/\.transport\s*=\s*HttpTransport\.readout\(/g) ?? []
    expect(writes.length, `★只有 ${writes.length} 条路径把读数写回帧（应有 4 条）`).toBe(4)
    // ★★★第三轮独立验证的 X2：四处全改成 `readout(null, protoOf(resp))` ⇒ 次数仍 4 ⇒ 全绿，
    //   而 `transport` 只剩 `proto`（`reused/dnsMs/connectMs/tlsMs/ttfbMs` 全丢 = 换栈的核心收益归零）。
    //   ⇒ 必须断言第一实参是 `takeMetrics(f.reqId)`。
    const withMetrics = capabilityCode.match(
      /\.transport\s*=\s*HttpTransport\.readout\(\s*HttpTransport\.takeMetrics\(f\.reqId\)/g,
    ) ?? []
    expect(
      withMetrics.length,
      `★只有 ${withMetrics.length} 条路径的读数真的取了 metrics（其余传了 null ⇒ 只剩 proto）`,
    ).toBe(4)
    // ★★★第三轮独立验证的 X1：把读数写到**未被返回的局部帧**（`unusedRf.transport = …`）时次数仍 4。
    //   ⇒ 断言赋值目标就是即将 return/push 的那个变量：出现 `rf.transport` 与 `fin.transport`，
    //     且不得出现"其它变量名 + .transport ="。
    const targets = [...capabilityCode.matchAll(/(\w+)\.transport\s*=\s*HttpTransport\.readout\(/g)].map((m) => m[1])
    expect(targets.sort(), '★读数被写到了非返回帧的变量上（业务拿不到）').toEqual(['fin', 'rf', 'rf', 'rf'])
  })
})

describe('★★#1160 传输读数：EventListener 采集 + 缺键不填 0', () => {
  const transport = src(TRANSPORT)
  const transportCode = stripLineComments(transport)

  it('★★★EventListener 覆盖五段计时，且**成对写入对应字段**', () => {
    // ★★★独立验证的变异 I：把 `dnsEnd` 改成 `m.dnsEnd = -1`（DNS 读数永久缺失）时，
    //   "只查方法名存在"的旧判据仍全绿 ⇒ 必须断言**每个事件写到自己的字段**。
    //   ★这是本仓反复踩的"断言名字存在等于没断言"（#1156 原文）。
    for (const [ev, field, why] of [
      ['dnsStart', 'dnsStart', 'DNS 开始'],
      ['dnsEnd', 'dnsEnd', 'DNS 结束'],
      ['connectStart', 'connectStart', '建连开始'],
      ['connectEnd', 'connectEnd', '建连结束'],
      ['secureConnectStart', 'secureStart', 'TLS 开始'],
      ['secureConnectEnd', 'secureEnd', 'TLS 结束'],
      ['requestHeadersEnd', 'reqHeadersEnd', '请求头写完（TTFB 起点）'],
      ['responseHeadersStart', 'respHeadersStart', '响应头到达（TTFB 终点）'],
    ] as const) {
      // 找到该事件的回调体（到下一个 @Override 或方法结束）
      const idx = transportCode.indexOf(`void ${ev}(`)
      expect(idx, `★未挂 ${ev}（${why}）⇒ 该段读数永远缺失`).toBeGreaterThan(0)
      const seg = transportCode.slice(idx, idx + 400)
      expect(seg, `★${ev} 没有写入 \`m.${field}\`（方法存在但读数不落地 ⇒ 假绿）`).toMatch(
        new RegExp(`m\\.${field}\\s*=`),
      )
      // ★★★必须写**真实时间戳**，不能写常量：独立验证的变异 I 把 `dnsEnd` 改成 `= -1`，
      //   仅断言"写了字段"仍全绿（-1 也是写）⇒ 必须要求右值是 `now()` / 真实计时结果。
      expect(seg, `★${ev} 写入的不是真实时间戳（写成 -1/0 会让该段读数永久缺失，却仍"写了字段"）`).toMatch(
        new RegExp(`m\\.${field}\\s*=\\s*(now\\(\\)|System\\.nanoTime)`),
      )
    }
  })

  it('★★★`reused` 只写 "1"/"0"，且由"本次是否发生过 connectStart"判定', () => {
    // ★必须去注释：三目表达式本身很短，拿原文断言时注释里写一遍就够满足
    expect(transportCode, '★reused 未按 connectStart 判定（connected 标志）').toMatch(
      /m\.connected\s*\?\s*"0"\s*:\s*"1"/,
    )
    // connectStart 必须真的置位（否则 reused 恒为 "1" = 假数据）
    expect(transportCode, '★connectStart 未置 connected 标志 ⇒ reused 恒为 "1"（假数据）').toMatch(
      /void connectStart\([\s\S]{0,200}m\.connected\s*=\s*true/,
    )
  })

  it('★★★缺键 = 不可得（测不到就不写，绝不填 0/false）', () => {
    // putMs 必须是"任一端缺失即 return"（不写键）
    const start = transport.indexOf('private static void putMs(')
    expect(start, '找不到 putMs').toBeGreaterThan(0)
    const seg = transport.slice(start, start + 400)
    expect(seg, '★putMs 在计时缺失时仍写入（会造出"花了 0ms"的假数据）').toMatch(/if\s*\(start\s*<=\s*0\s*\|\|\s*end\s*<=\s*0/)
    expect(seg, '★putMs 未提前 return').toMatch(/return;/)
  })

  it('★读数在请求完成后**取走即删**（防无界增长）', () => {
    expect(transport, '★METRICS 未在取用时移除（长跑会无限增长）').toMatch(
      /METRICS\.remove\(/,
    )
  })

  it('★★★失败/取消路径也必须清读数（独立验证抓出的无界泄漏）', () => {
    // 【缺陷形态】`takeMetrics()` 只在**成功 return 前**调用，而读数在 `TransportListener`
    //   构造时就写进 METRICS ⇒ DNS 失败 / 超时 / 用户取消 / 体积超限等异常出口都不 remove
    //   ⇒ 长跑应用里 key（reqId 递增）**无界增长**，与类注释"取走即删"直接矛盾。
    const dropCalls = stripLineComments(src(CAPABILITY)).match(/HttpTransport\.dropMetrics\(/g) ?? []
    expect(
      dropCalls.length,
      `★只有 ${dropCalls.length} 处 dropMetrics（四条路径的 finally 都应有：整包/上传/落盘/流式）`,
    ).toBe(4)
    // 每处必须与 unregisterRequest 成对（同一个 finally 里）
    const capCode = stripLineComments(src(CAPABILITY))
    const unregs = capCode.match(/unregisterRequest\(f\.reqId\);[\s\S]{0,120}?HttpTransport\.dropMetrics\(/g) ?? []
    expect(unregs.length, '★dropMetrics 未与 unregisterRequest 配对（漏配的路径仍会泄漏）').toBe(4)
    // ★★★第二轮独立验证的 M10：把 `dropMetrics` 函数体改成空操作、签名与调用全保留 ⇒ 旧判据全绿。
    //   ⇒ 必须断言函数体真的 remove（不能只数调用点）。
    const ds = transportCode.indexOf('static void dropMetrics(')
    expect(ds, '找不到 dropMetrics 定义').toBeGreaterThan(0)
    const fnBody = transportCode.slice(ds, ds + 400)
    expect(fnBody, '★dropMetrics 函数体未真正 METRICS.remove（空实现也能骗过调用点断言）').toMatch(
      /METRICS\.remove\(/,
    )
  })
})

describe('★★#1160 HTTPDNS 接入点（`HttpURLConnection` 根本给不了的能力）', () => {
  const transport = src(TRANSPORT)
  const transportCode = stripLineComments(transport)

  it('★★★`Dns` seam 真的接到 client（不是只声明一个接口）', () => {
    // ★断言**调用点**：Dns 实现必须在 buildClient 里真被挂到 builder 上。
    // ★★#1336 修正（**既存断言漂移**）：实现后来升级为**总是**装 `ForwardingDns`
    //   （表 → seam → 系统 三级回落，见 #1169 注释），而本断言原先写死旧形态 `b.dns(dns)`
    //   ⇒ 代码做了更严的实现、判据反而报红（"判据比实现旧"）。
    //   ⇒ 改为断言「builder 上挂了 Dns」+ 两条真正关心的事：
    //     ① `ForwardingDns` 存在；② 它内部真的落到 `httpDns` seam（否则注入的解析器是死的）。
    expect(
      transportCode,
      '★声明了 Dns seam 但没接到 client（b.dns(...) 未调用）⇒ 注入的解析器永不生效',
    ).toMatch(/b\.dns\(\s*new ForwardingDns\(\)\s*\)/)
    expect(transportCode, '★缺少转发式 Dns 实现（表/seam/系统三级回落）').toMatch(/class ForwardingDns implements Dns/)
    expect(transportCode, '★ForwardingDns 里没有用 httpDns seam（注入的解析器不会被调用）').toMatch(
      /final HttpDns impl = httpDns[\s\S]{0,400}impl\.lookup\(/,
    )
    // ★★#1336 修正：`httpDnsSeam()` 这个包装方法已被重构掉（现在 seam 直接存字段
    //   `httpDns` 并由 `installDns(...)` 注入，见上方 154 行）。判据关心的是
    //   「seam 有注入入口」，不是某个方法名 ⇒ 改成断言注入点存在。
    expect(transportCode, '★缺少 Dns seam 注入入口（httpDns 字段无人赋值）').toMatch(
      /httpDns\s*=\s*dns|static\s+void\s+installDns\(/,
    )
  })

  it('★注入的解析器返回空 ⇒ 必须当解析失败（不能静默用系统 DNS）', () => {
    expect(transportCode, '★空结果未抛 UnknownHostException（会静默退化，业务以为 DNS 走了注入实现）').toMatch(
      /UnknownHostException\(\s*"HTTPDNS 无结果/,
    )
  })

  it('★改 DNS 必须清 client 缓存（OkHttp client 是不可变的，否则新解析器永不生效）', () => {
    const start = transport.indexOf('public static void setHttpDns(')
    expect(start, '找不到 setHttpDns').toBeGreaterThan(0)
    const seg = transport.slice(start, start + 420)
    expect(seg, '★setHttpDns 未清 client 缓存 ⇒ 已缓存的 client 仍用旧 DNS（新配置静默无效）').toMatch(/CLIENTS\.clear\(\)/)
  })
})

describe('★★#1160 pinning 与 OkHttp 的配对约束', () => {
  const tls = src(TLS)
  const tlsCode = stripLineComments(tls)

  it('★★★`sslMaterial` 必须成对给出 factory + trustManager（JDK 9+ 单参重载直接抛）', () => {
    // ★本机实测：`OkHttpClient.Builder.sslSocketFactory(SSLSocketFactory)` 在 JDK 9+ 抛
    //   UnsupportedOperationException（需要 TrustManager 建证书链清理器）
    expect(tlsCode, '★缺 SslMaterial（OkHttp 需要成对的 factory + trustManager）').toMatch(/class SslMaterial/)
    expect(tlsCode, '★SslMaterial 未同时持有 socketFactory 与 trustManager').toMatch(
      /SSLSocketFactory socketFactory[\s\S]{0,120}X509TrustManager trustManager/,
    )
    // ★构造必须"同一次产出两者"：不得各自去取（那会两套信任语义并存）
    const start = tls.indexOf('private static SslMaterial buildMaterial(')
    expect(start, '找不到 buildMaterial').toBeGreaterThan(0)
    const seg = tls.slice(start, start + 900)
    expect(seg, '★buildMaterial 未用同一个 pinningTm 同时造 factory 与返回（信任语义会分叉）').toMatch(
      /pinningTrustManager\(pins,\s*system\)[\s\S]{0,400}new SslMaterial\(ctx\.getSocketFactory\(\),\s*pinningTm\)/,
    )
  })

  it('★★`sslMaterial` 也必须走缓存（否则每请求新建 SSLContext ⇒ 复用归零，同 #1155）', () => {
    const start = tls.indexOf('public static SslMaterial sslMaterial(')
    expect(start, '找不到 sslMaterial').toBeGreaterThan(0)
    const end = tls.indexOf('private static SslMaterial buildMaterial(')
    const body = tls.slice(start, end)
    expect(body, '★sslMaterial 未先查缓存（MATERIAL_CACHE.get）').toMatch(/MATERIAL_CACHE\.get\(/)
    expect(body, '★命中未提前返回（查了还继续造）').toMatch(/if\s*\(cached\s*!=\s*null\)\s*return\s+cached/)
    expect(body, '★缓存键未含 pinOnly（叠加/替代两档会共用同一材料，信任语义错乱）').toMatch(/cacheKey\s*=\s*pinsRaw[^;]*pinOnly/)
  })

  it('★TrustManager 构造只有一处（防止两套 pin 判定并存）', () => {
    const defs = tlsCode.match(/private static X509TrustManager pinningTrustManager\(/g) ?? []
    expect(defs.length, `★pinningTrustManager 定义 ${defs.length} 处（应只有 1 处）`).toBe(1)
    // 唯一构造点必须被 buildMaterial 使用（#1160 换栈后只剩这一条构造路径；
    // 旧的 HttpURLConnection 版 buildSocketFactory 已删，见 TlsPinning 的说明块）
    const uses = tlsCode.match(/pinningTrustManager\(pins,\s*system\)/g) ?? []
    expect(uses.length, `★pinningTrustManager 被调用 ${uses.length} 处（应恰好 1 处：buildMaterial）`).toBe(1)
    expect(tlsCode, '★buildMaterial 未用 pinningTrustManager（另建了 TrustManager ⇒ 两套 pin 判定并存）').toMatch(
      /buildMaterial[\s\S]{0,600}pinningTrustManager\(pins,\s*system\)/,
    )
  })
})

describe('★★#1160 重定向语义（#1134 的 open-redirect 防线不能因换栈失效）', () => {
  const transportCode = stripLineComments(src(TRANSPORT))

  it('★★★`redirectManual` 必须真的接到 `followRedirects(false)`', () => {
    // ★漏了它的后果：JS 以为自己在逐跳处理，而宿主已经跟完了 ⇒ #1134 要防的跨域凭据泄露复现
    // ★★★必须去注释：第二轮独立验证的 M7（改成 `followRedirects(true)`、原串留在注释里）旧判据全绿。
    expect(transportCode, '★redirectManual 未接到 followRedirects（重定向拦截静默失效）').toMatch(
      /followRedirects\(\s*!\s*cfg\.redirectManual\s*\)/,
    )
  })
})

describe('★★#1160 上传路径的 Content-Type 搬运（真机抓到的回归）', () => {
  const capability = src(CAPABILITY)

  it('★★★上传路径必须保留调用方的 multipart Content-Type（含 boundary），没给才兜底', () => {
    // 【真机回归（本单第一版）】只在"调用方没设头"时才写 contentType，随后无条件 `headers.remove` ⇒
    //   JS 侧 upload 会带 `Content-Type: multipart/form-data; boundary=…`，于是：
    //     · contentType 为空（因为"调用方设了头"这个分支没进）
    //     · header 又被删掉
    //   ⇒ 服务端收到 `missing boundary`。功能静默坏掉，只有真机上传探针能抓到。
    //   ★第二轮收口：Content-Type 的"调用方优先"逻辑已上移到 `buildCallConfig`（四条路径共用），
    //     上传路径只需**兜底**补 boundary。⇒ 断言落在"兜底 + 清 body"两件事上。
    const start = capability.indexOf('private static InvokeWire.ResolveFrame performStreamUpload')
    expect(start, '找不到 performStreamUpload').toBeGreaterThan(0)
    const end = capability.indexOf('static final class UploadStats')
    const seg = capability.slice(start, end)
    // 兜底必须带 **up.boundary**（★同源：multipart 体是用 up.boundary 拼的，头里写别的必然 missing boundary）
    expect(seg, '★兜底 contentType 未带 boundary').toMatch(/multipart\/form-data; boundary=" \+ up\.boundary/);
    // ★★★第三轮独立验证指出：只断言"有 boundary 串"不够——变异 `boundary=" + up.fieldName`
    //   也满足 ⇒ 必须断言用的是 **up.boundary**（与 `fileFieldHead` 同源）。
    const boundaryUses = seg.match(/boundary=" \+ up\.boundary/g) ?? []
    expect(boundaryUses.length, '★上传路径的 boundary 未统一取自 up.boundary（两处不同源 ⇒ 服务端 missing boundary）').toBeGreaterThan(0);
    expect(seg, '★上传兜底用了非 up.boundary 的字段（如 up.fieldName）').not.toMatch(/boundary=" \+ up\.(?!boundary)\w+/);
    // 只在空时兜底（不得覆盖调用方已经给好的类型）
    expect(seg, '★无条件覆盖 contentType（会抹掉调用方的 multipart 类型）').toMatch(
      /if\s*\(\s*cfg\.contentType\s*==\s*null\s*\|\|\s*cfg\.contentType\.isEmpty\(\)\s*\)/,
    );
    expect(seg, '★兜底未优先用调用方的 Content-Type（应 cfg.callerContentType 优先）').toMatch(
      /cfg\.callerContentType\s*!=\s*null/,
    );
  })
})

describe('★★#1160 第三方依赖入库与构建接线', () => {
  it('★★★vendor 目录有 OkHttp 3.x（纯 Java 线，非 4.x/Kotlin）', () => {
    const tp = path.join(ROOT, 'hosts/android/thirdparty')
    const jars = fs.readdirSync(tp).filter((f) => f.endsWith('.jar')).sort()
    expect(jars, `★thirdparty 缺 OkHttp/Okio jar（现有：${jars.join(', ')}）`).toContain('okhttp-3.14.9.jar')
    expect(jars, `★thirdparty 缺 Okio jar（现有：${jars.join(', ')}）`).toContain('okio-1.17.2.jar')
    // ★不得混入 4.x（它的 dex 体积 +929 KB 且需 kotlin-stdlib —— 选型依据见 README）
    expect(jars.filter((f) => /^okhttp-4\./.test(f)), '★混入了 OkHttp 4.x（体积 +929 KB，需重新评估）').toEqual([])
    // 依赖口径要写死（升级时强制重读）
    const readme = src('hosts/android/thirdparty/README.md')
    expect(readme, '★README 未记录 sha256（升级无法核对来源）').toMatch(/sha256/i)
    expect(readme, '★README 未记录 3.x/4.x 的体积差（升级决策依据）').toMatch(/929\s*KB|930|951,024/)
  })

  it('★★★三处构建路径都带上第三方 jar（漏一处 = 编译不过或真机 NoClassDefFoundError）', () => {
    for (const [f, why] of [
      ['hosts/android/check-host-compile.sh', '零设备编译判据'],
      ['hosts/android/build-and-run.sh', '真机构建（javac + d8）'],
      ['hosts/android/build-runtime-aar.sh', 'AAR 打包（CLI 消费）'],
    ] as const) {
      const s = src(f)
      expect(s, `★${f}（${why}）未引用 thirdparty jar`).toMatch(/thirdparty/)
      expect(s, `★${f}（${why}）未把 jar 加进 classpath/d8 输入`).toMatch(/THIRDPARTY_(CP|JARS)/)
    }
    // ★真机构建：d8 也必须拿到 jar（只给 javac = 编译过、真机 NoClassDefFoundError）
    const build = src('hosts/android/build-and-run.sh')
    expect(build, '★d8 命令行未出现 THIRDPARTY 变量（只会把 jar 给 javac ⇒ 真机 NoClassDefFoundError）').toMatch(
      /d8[\s\S]{0,220}THIRDPARTY_JARS/,
    )
  })

  it('★★AAR 断言必须验证第三方类真的进包（防"源改了 AAR 没重建"）', () => {
    const s = src('hosts/android/build-runtime-aar.sh')
    expect(s, '★AAR 未断言 okhttp3 类进包（消费方会编译不过/运行时崩）').toMatch(/okhttp3\/OkHttpClient\.class/)
  })

  it('★★AAR 新鲜度指纹必须含第三方 jar（换了 jar 也要判陈旧）', () => {
    const s = src('scripts/check-android-runtime-aar-fresh.mjs')
    expect(s, '★指纹只哈希 runtime/*.java ⇒ 换了第三方 jar 不判陈旧').toMatch(/thirdparty/)
    expect(s, '★指纹未把 jar 内容喂进哈希').toMatch(/\.jar[\s\S]{0,200}h\.update/)
    // ★★★两处算法必须一致：构建脚本写指纹、门禁脚本重算——各写一份就是"改一处忘另一处"
    //   （本轮实测踩到：只改门禁 ⇒ 门禁永久红）。
    const build = src('hosts/android/build-runtime-aar.sh')
    expect(build, '★构建脚本写指纹时未含第三方 jar（与门禁算法分叉 ⇒ 门禁永久红）').toMatch(
      /thirdparty/,
    )
  })

  it('★★★必须有"整包路径 + 请求体"的真机探针（本单 P0 的覆盖洞）', () => {
    // 【为什么这条判据本身很重要】换栈第一版漏了整包路径的 body，而当时四条真机探针
    //   全是 GET/上传 ⇒ **9 组回归全绿、功能已坏**。⇒ 覆盖洞必须被判据守着，不能靠"下次记得"。
    const probe = src('hosts/shared/bridge/entry-superapp-probes-body.ts')
    expect(probe, '★缺 POST 带体探针').toMatch(/export function appBodyProbe/)
    expect(probe, '★探针未断言"服务端收到的长度 = 期望长度"（只断言 >0 会把半截也判绿）').toMatch(
      /post_len_ok/,
    )
    expect(probe, '★探针未比较期望长度').toMatch(/post_len_expected/)
    // 服务端端点
    expect(src('hosts/android/tools/transfer-echo-server.mjs'), '★服务端缺 /body-echo 端点').toMatch(
      /url\.pathname === '\/body-echo'/,
    )
    // hook 注册
    expect(src('hosts/shared/bridge/entry-superapp.ts'), '★探针未挂到 globalThis（宿主调不到）').toMatch(
      /__proteusHostAppBodyProbe/,
    )
    // 真机 runner
    const runner = src('hosts/android/run-body-probe.sh')
    expect(runner, '★缺真机 runner').toMatch(/body-probe\.json/)
    // 宿主探针入口 + MainActivity 分发（漏一处 = 探针永不执行）
    expect(src('hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/BodyProbe.java'), '★缺 BodyProbe').toMatch(
      /public static String run\(/,
    )
    expect(src('hosts/android/app/src/main/java/dev/proteus/layoutcore/dev/MainActivity.java'), '★MainActivity 未分发 body-probe').toMatch(
      /"body-probe"\.equals\(testPath\)/,
    )
  })
})

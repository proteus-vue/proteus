// tests/websocket-security-chain.test.ts
// ★★★#1344 P4：**WebSocket 必须走与 HTTP 同一套安全链**（痛点 #15）。
//
// 【这条痛点是什么】主流请求库/框架把加固都做在 HTTP 那一层（域名白名单、TLS pin、
//   凭据脱敏、审计），而 WebSocket 是**另一条通道**：业务换一个 API 就绕过了全部限制。
//   本仓旧状态正是这个形态 —— HTTP 可以配 `TenantPolicy.allowedDomains`，
//   而 `createAppWebSocket()` **完全不看域名**；Android 的 `wss://` 甚至没有主机名校验
//   （`createSocket()` 无参 + `connect()` ⇒ `setEndpointIdentificationAlgorithm` 为 null，
//     任何持有任意域名合法证书的人都能冒充 `wss://api.bank.com`）。
//
// 【为什么 WS 比 HTTP 更危险（不是"同类问题"）】HTTP 是一问一答、有响应体大小上限、
//   有 deadline；WS 是**常驻双向通道**：连上之后可以无限期收发，最适合把数据悄悄外传。
//   而且它出网时在审计里"只是条连接"，看起来比一堆 POST 干净。
//
// 【本判据锁住什么】
//   ① 域名白名单真的拦（不是"代码里有那个函数"）；
//   ② 白名单拒的连接**不占并发额度**（否则等于用一个洞换另一个洞）；
//   ③ 不配白名单 ⇒ 不限制（白名单是可选增强，与 HTTP 同口径）；
//   ④ `*.example.com` 只匹配**一级**子域（`a.b.example.com` 不匹配 —— 与 HTTP 同一份规则）；
//   ⑤ 拒绝码是 `websocket.forbidden`（不是 `unsupported`：传错域 ≠ 本端没这个能力）；
//   ⑥ 被拒时**宿主一次都没被调用**（"先连上再拒"= 泄漏已经发生）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createAppWebSocket, installWsChannel, resetWsConnections, wsStatsSnapshot, __resetWsStats,
  wsConnectionCount,
} from '../packages/api/src/capability-websocket'
import { HOST_INVOKE_KEY } from '../packages/api/src/capability-invoke'
import { isHostAllowed, hostOf } from '../packages/api/src/request/tenant'

type Call = { method: string; args: unknown }

/** 装一个假宿主：记录调用序列，`ws.open` 回一个递增 id。 */
function installFakeHost(): { calls: Call[] } {
  const calls: Call[] = []
  let nextId = 1
  ;(globalThis as Record<string, unknown>)[HOST_INVOKE_KEY] = (method: string, argsJson: string) => {
    const args = argsJson ? JSON.parse(argsJson) : {}
    calls.push({ method, args })
    if (method === 'ws.open') return JSON.stringify({ ok: true, data: { id: nextId++, protocol: null } })
    return JSON.stringify({ ok: true, data: {} })
  }
  return { calls }
}

beforeEach(() => {
  resetWsConnections()
  __resetWsStats()
  installWsChannel()
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[HOST_INVOKE_KEY]
})

describe('★★★#1344 P4 WebSocket 域名白名单（痛点 #15：WS 不得绕过 HTTP 加固）', () => {
  it('★白名单命中 ⇒ 放行，且宿主真的被调用', async () => {
    const { calls } = installFakeHost()
    const open = createAppWebSocket({ allowedDomains: ['api.example.com'] })
    await open('wss://api.example.com/socket')
    expect(calls.filter((c) => c.method === 'ws.open')).toHaveLength(1)
    // ★连接句柄对外只暴露 send/close/on（不暴露 id）⇒ 用连接计数判定"真的建起来了"
    expect(wsConnectionCount()).toBe(1)
  })

  it('★★白名单未命中 ⇒ websocket.forbidden，且**宿主一次都没被调用**', async () => {
    const { calls } = installFakeHost()
    const open = createAppWebSocket({ allowedDomains: ['api.example.com'] })
    await expect(open('wss://evil.example.net/socket')).rejects.toMatchObject({
      code: 'websocket.forbidden',
    })
    // ★核心：不是在连上之后才断开 —— 那样 socket 已经建立、数据可能已经出去
    expect(calls, '★被白名单拒时不应有任何宿主调用（否则连接已经发起了）').toHaveLength(0)
    expect(wsStatsSnapshot().rejectedByAllowlist, '★拒绝次数必须记账（判据的唯一直接证据）').toBe(1)
  })

  it('★不配白名单 ⇒ 不限制（白名单是可选增强，与 HTTP 同口径）', async () => {
    const { calls } = installFakeHost()
    const open = createAppWebSocket()
    await open('wss://anywhere.example.org/x')
    expect(calls.filter((c) => c.method === 'ws.open')).toHaveLength(1)
    expect(wsStatsSnapshot().rejectedByAllowlist).toBe(0)
  })

  it('★`*.example.com` 只匹配一级子域（与 HTTP 同一份规则）', () => {
    expect(isHostAllowed('wss://a.example.com/x', ['*.example.com'])).toBe(true)
    // ★两级子域**不**匹配：白名单一旦能表达"任意深度"，就容易被写成"看起来受限、实际全通"
    expect(isHostAllowed('wss://a.b.example.com/x', ['*.example.com'])).toBe(false)
    // ★后缀伪装必须被看穿：`evilexample.com` 不是 `.example.com` 的子域
    expect(isHostAllowed('wss://evilexample.com/x', ['*.example.com'])).toBe(false)
  })

  it('★`ws://` 与 `wss://` 都被同一份规则判定（scheme 不参与白名单匹配）', () => {
    expect(hostOf('ws://api.example.com:8080/x')).toBe('api.example.com')
    expect(hostOf('wss://api.example.com/x')).toBe('api.example.com')
    expect(isHostAllowed('ws://api.example.com/x', ['api.example.com'])).toBe(true)
    expect(isHostAllowed('ws://other.com/x', ['api.example.com'])).toBe(false)
  })

  /**
   * ★★检查顺序：**白名单必须排在并发额度之前**。
   *
   * 【为什么顺序本身是判据（这是我在实现里真的写反过的）】
   *   第一版把额度检查放在前面 ⇒ 恶意域名可以**刷满 64 个额度**，把合法业务全挤掉。
   *   那等于"用一个洞换另一个洞"：白名单挡住了连接，但挡不住 DoS。
   *
   * 【怎么验顺序（不能只看"连接数没涨"）】
   *   首版断言用 `wsStatsSnapshot().connections` —— 而它是 `conns.size`（Map 实际条目数），
   *   被拒的连接本就没进 Map ⇒ 无论顺序如何都恒等于 1 ⇒ **假绿**（破坏性验证抓出：
   *   把 `wsStats.connections++` 塞进拒绝分支，判据照样全绿）。
   *   ⇒ 改成**观察错误码**：把额度打满后，请一个不在白名单的域 —
   *     若顺序对 ⇒ `websocket.forbidden`（先撞白名单）；若顺序错 ⇒ `websocket.tooManyConnections`。
   *     两种错误码**互斥**，这个判据无法被掩盖。
   */
  it('★★白名单必须排在并发额度之前（否则恶意域名能刷满额度挤掉合法业务）', async () => {
    const { calls } = installFakeHost()
    const open = createAppWebSocket({ allowedDomains: ['api.example.com'] })
    // 打满额度：全部用合法域建（同一 fake host 会持续发新 id）
    const held = []
    for (let i = 0; i < 64; i++) held.push(await open(`wss://api.example.com/s${i}`))
    expect(wsConnectionCount()).toBe(64)
    // ★关键：额度已满 + 域不在白名单 ⇒ 报的必须是 forbidden（白名单先判），不是 tooMany
    await expect(open('wss://evil.example.net/x')).rejects.toMatchObject({
      code: 'websocket.forbidden',
    })
    // ★反向确认额度真的满了：合法域此时应当撞 tooMany（证明额度检查仍生效、没被我删）
    await expect(open('wss://api.example.com/extra')).rejects.toMatchObject({
      code: 'websocket.tooManyConnections',
    })
    // 被拒的两次都不该触发宿主调用之外的副作用：ws.open 只被调用 64 次（没有多出来的）
    expect(calls.filter((c) => c.method === 'ws.open')).toHaveLength(64)
  })

  it('★用户信息（userinfo）不能用来伪装 host', async () => {
    installFakeHost()
    const open = createAppWebSocket({ allowedDomains: ['api.example.com'] })
    // `wss://api.example.com@evil.net/x` 的真实 host 是 evil.net
    await expect(open('wss://api.example.com@evil.net/x')).rejects.toMatchObject({
      code: 'websocket.forbidden',
    })
  })
})

describe('★★★#1344 P4 装配层接线：白名单从 createCapabilityHooks 一处下传', () => {
  it('★经 makeCapabilityRuntime 传 allowedDomains ⇒ WS 真的被拦（不是只在单测里能拦）', async () => {
    installFakeHost()
    const { makeCapabilityRuntime } = await import('../packages/api/src/capability-runtime')
    const rt = makeCapabilityRuntime({ allowedDomains: ['api.example.com'], owner: 'test' })
    // ① 命中白名单 ⇒ 建连成功
    await rt.appWs('wss://api.example.com/socket')
    expect(wsConnectionCount()).toBe(1)
    // ② 未命中 ⇒ 被拒（同一个 appWs 实例，证明配置真的传到了内层）
    await expect(rt.appWs('wss://evil.example.net/x')).rejects.toMatchObject({
      code: 'websocket.forbidden',
    })
    expect(wsStatsSnapshot().rejectedByAllowlist).toBe(1)
  })

  it('★经 makeCapabilityRuntime 不传 allowedDomains ⇒ 不限制（零回归）', async () => {
    installFakeHost()
    const { makeCapabilityRuntime } = await import('../packages/api/src/capability-runtime')
    const rt = makeCapabilityRuntime({ owner: 'test' })
    await rt.appWs('wss://anywhere.example.org/x')
    expect(wsConnectionCount()).toBe(1)
  })
})

describe('★★★#1344 P4 各端 TLS 安全链取证（源码级，防"将来被顺手改松"）', () => {
  /**
   * 【为什么这条判据存在】WS 安全链有两个独立的失效点：
   *   ① JS 层白名单（上面已覆盖）；② **传输层的主机名校验**。
   *   ② 一旦失守，"白名单放行了一个域名"会变成"白名单放行了**任何人**冒充那个域名"。
   *   三端形态不同，各自的坑也不同 —— 必须分别锚定。
   */
  async function readHostFile(rel) {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const here = path.dirname(fileURLToPath(import.meta.url))
    return fs.readFileSync(path.resolve(here, '..', rel), 'utf8')
  }

  it('★★Android：wss 必须设 endpointIdentificationAlgorithm 且显式 startHandshake', async () => {
    const s = await readHostFile('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/WebSocketCapability.java')
    /**
     * 【这条抓的是什么真缺陷（我本轮修的就是它）】
     *   旧代码：SSLSocketFactory.getDefault().createSocket()（**无参**）+ connect()。
     *   这条路径只校验**证书链**，setEndpointIdentificationAlgorithm 保持默认 null
     *   ⇒ **不做主机名比对** ⇒ 任何持有任意域名合法证书的人都能冒充 wss://api.bank.com。
     *   ★这是 Android 的经典坑：createSocket(host, port) 重载会自动带 peerHost，
     *     而 createSocket() + connect() 不会。
     */
    expect(s, '★Android wss 必须显式设 HTTPS 端点识别（否则主机名校验缺失 = MITM）')
      .toContain('setEndpointIdentificationAlgorithm(\"HTTPS\")')
    expect(s, '★必须显式 startHandshake（否则 TLS 错误会伪装成"握手失败：HTTP xxx"，归因方向全错）')
      .toContain('startHandshake()')
    // ★反例守卫：无参 createSocket() 之后必须紧跟 setSSLParameters
    const noArg = s.indexOf('SSLSocketFactory.getDefault().createSocket()')
    expect(noArg, '★找不到无参 createSocket（实现变了？本判据需重评）').toBeGreaterThan(0)
    // ★窗口要够大：无参 createSocket 与 setSSLParameters 之间有一段长注释（决定安全的那几句话）
    const afterNoArg = s.slice(noArg, noArg + 1600)
    expect(afterNoArg, '★无参 createSocket 之后必须紧跟 setSSLParameters（否则主机名校验缺失）')
      .toContain('setSSLParameters')
  })

  it('★★iOS：URLSession 不得传自定义 delegate（系统默认校验才含主机名）', async () => {
    const s = await readHostFile('hosts/ios/ProteusHost/runtime/websocket-capability.swift')
    /**
     * 【为什么 delegate: nil 是安全前提】
     *   一旦传入自定义 URLSessionDelegate，系统**不再**自动做
     *   URLAuthenticationMethodServerTrust 的默认处理 —— 而默认处理里包含
     *   **主机名比对**（SecTrustEvaluateWithError 会核对 SSLPolicy 的 hostname）。
     *   自定义 delegate 若只做 serverTrust 的"接受"就等于关掉了整条校验链。
     *   ★这不是"将来可能有问题"：本仓 #1257 就有人为了 pinning 想加 delegate。
     */
    const sessionLines = s.split('\n').filter((l) => l.includes('URLSession(configuration:'))
    expect(sessionLines.length, '★找不到 URLSession 构造（实现变了？）').toBeGreaterThan(0)
    for (const l of sessionLines) {
      expect(l, '★URLSession 不得传自定义 delegate（会关掉系统默认的主机名校验）')
        .toMatch(/delegate:\s*nil/)
    }
  })
})

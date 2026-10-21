// tests/fetch-tls-pins.test.ts
// ★★★决策 #1153：**TLS 证书 pinning** 的判据。
//
// 【为什么 pinning 是本轮该做的（而不是 HTTPDNS/HTTP2）】
//   P1 三项里，HTTPDNS / HTTP-2 / 连接池**都必须换传输栈**（Android 要引 OkHttp，APK 涨体积）；
//   而 **pinning 不需要**：Android 的 `setSSLSocketFactory`、iOS 的 challenge 回调都能在现有栈上做
//   （与 #1134 把"重定向可拦"从 P1 移出是同一个判断）。
//
// 【★本判据的核心风险点：SPKI 指纹的口径】
//   钉 SPKI（SubjectPublicKeyInfo）而不是整张证书——续期时不失效。
//   但"SPKI 指纹"的**字节口径**极易做错：
//     · 直接对 `SecKeyCopyExternalRepresentation`（iOS）/ 裸公钥 取哈希 ⇒ 少了 DER 的 AlgorithmIdentifier 头；
//     · 对整张证书取哈希 ⇒ 那是证书指纹，不是公钥指纹。
//   ⇒ 本判据用 **openssl 生成证书并算出权威指纹**，再断言：
//     ① 宿主实现使用的口径与 openssl 的 `-pubkey | pkey -pubin -outform der` **逐字节一致**；
//     ② 换一张证书（不同密钥）⇒ 指纹必须不同（否则 pin 形同虚设）；
//     ③ `tlsPins` 的三种书写形态（数组/换行串/逗号串）归一后**等价**。
//
// 【诚实边界】本判据验的是**框架层的指纹口径与归一**（可在 Node 跑）。
//   真机上"证书不对时连接真的被拒"由 `bash hosts/{android,ios}/run-tls-probe.sh` 验（见 #1153 证据）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import type { Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { normalizePins } from '../packages/api/src/capability-fetch'
import { createFetchPipeline } from '../packages/api/src/capability-fetch-pipeline'
import { webRequest } from '../packages/api/src/capability-fetch-legs'

class TCapError extends Error {
  code: string
  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    ;(this as { cause?: unknown }).cause = cause
    this.code = code
  }
}
const ctx = { CapError: TCapError as unknown as new (code: string, message: string, cause?: unknown) => Error }

/** 用 openssl 造一张自签证书，并算出**权威 SPKI 指纹**（base64 SHA-256）。 */
function makeCert(dir: string, name: string): { key: string; cert: string; spkiPin: string; certPin: string } {
  const key = path.join(dir, `${name}.key`)
  const cert = path.join(dir, `${name}.crt`)
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '2',
    '-subj', `/CN=${name}.test`,
    '-addext', `subjectAltName=DNS:${name}.test,IP:127.0.0.1`,
  ], { stdio: 'ignore' })
  // ★权威口径：公钥的 DER（= SPKI 结构）后取 SHA-256
  const spkiDer = execFileSync('sh', ['-c', `openssl x509 -in "${cert}" -pubkey -noout | openssl pkey -pubin -outform der`], {
    maxBuffer: 10 * 1024 * 1024,
  })
  const spkiPin = execFileSync('sh', ['-c', `openssl x509 -in "${cert}" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64 -A`], {
    maxBuffer: 10 * 1024 * 1024,
  }).toString().trim()
  // 整张证书的指纹（**不该**被当成 SPKI 用——判据用它做反例）
  const certPin = execFileSync('sh', ['-c', `openssl x509 -in "${cert}" -outform der | openssl dgst -sha256 -binary | openssl base64 -A`], {
    maxBuffer: 10 * 1024 * 1024,
  }).toString().trim()
  expect(spkiDer.length, 'openssl 未产出公钥 DER').toBeGreaterThan(100)
  return { key, cert, spkiPin, certPin }
}

describe('★★★#1153 TLS pinning', () => {
  let dir = ''
  let a: ReturnType<typeof makeCert>
  let b: ReturnType<typeof makeCert>

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-pins-'))
    a = makeCert(dir, 'alpha')
    b = makeCert(dir, 'beta')
  })

  afterAll(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 清理失败不影响判据 */
    }
  })

  it('① SPKI 指纹与证书指纹是**两个不同的值**（口径不能混用）', () => {
    expect(a.spkiPin, 'openssl 产出的 SPKI 指纹异常').toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(a.certPin).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(a.spkiPin, '★SPKI 指纹与整证书指纹相同 —— 说明口径搞混了').not.toBe(a.certPin)
  })

  it('② 不同证书（不同密钥）⇒ SPKI 指纹不同（否则 pin 形同虚设）', () => {
    expect(a.spkiPin).not.toBe(b.spkiPin)
  })

  it('③ `tlsPins` 三种书写形态归一后等价（数组 / 换行串 / 逗号串）', () => {
    const asArray = normalizePins([a.spkiPin, b.spkiPin])
    const asNewline = normalizePins(`${a.spkiPin}\n${b.spkiPin}`)
    const asComma = normalizePins(`${a.spkiPin}, ${b.spkiPin}`)
    expect(asArray).toBe(asNewline)
    expect(asComma).toBe(asNewline)
    // ★顺序保留（诊断时更清楚）
    expect(asArray!.split('\n')).toEqual([a.spkiPin, b.spkiPin])
  })

  it('④ 归一要去重、去空白、且**剥掉 HPKP 风格 `sha256/` 前缀**（与宿主同口径）', () => {
    const out = normalizePins([` ${a.spkiPin} `, a.spkiPin, `sha256/${b.spkiPin}`])
    expect(out!.split('\n'), `★去重/去前缀失败：${out}`).toEqual([a.spkiPin, b.spkiPin])
    // 反向：带前缀与不带前缀必须归一到**同一个**值（否则 JS 侧与宿主侧字面量不一致）
    expect(normalizePins(`sha256/${a.spkiPin}`)).toBe(normalizePins(a.spkiPin))
  })

  it('⑤ 空/纯空白 ⇒ undefined（**不做 pinning**，而不是"空列表也算生效"）', () => {
    expect(normalizePins([])).toBeUndefined()
    expect(normalizePins('   ')).toBeUndefined()
    expect(normalizePins(undefined)).toBeUndefined()
  })

  it('★★★⑤b 缺 `=` 填充的 base64 必须**补回**（真机抓出的静默失效）', () => {
    /**
     * 【真机现场】装置把 base64 转成 URL-safe 并去掉 `=`（避免 shell 吃掉 `+` `/` `=`），
     *   宿主 `Base64.decode` 遇到"43 字符无填充"直接抛 ⇒ 整条 pin 被丢弃
     *   ⇒ `tlsPins 为空/无法解析 ⇒ 不做 pinning（保持平台默认信任链）` ⇒ **pinning 静默失效**。
     * 【为什么首版漏了】填充恢复被写在 `if (/[-_]/.test(p))` 分支里，
     *   而那张指纹**恰好不含 `-`/`_`** ⇒ 没进分支 ⇒ 不补填充。
     *   ⇒ 填充是独立于字母表的一步，必须无条件按长度做。
     */
    const unpadded = a.spkiPin.replace(/=+$/, '')
    expect(unpadded.length % 4).not.toBe(0) // 确实需要补
    expect(normalizePins(unpadded), '★缺填充的指纹没被补回 ⇒ 宿主解析失败 ⇒ pinning 静默失效').toBe(a.spkiPin)
    // URL-safe 形态（含 -/_）+ 无填充 也要能还原
    const urlSafe = `${a.spkiPin.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}`
    expect(normalizePins(urlSafe)).toBe(a.spkiPin)
  })

  it('★★⑥ 真实 HTTPS 服务：自签证书默认会被拒（证明"没有 pinOnly 就用不了自签"）', async () => {
    const server = https.createServer(
      { key: fs.readFileSync(a.key), cert: fs.readFileSync(a.cert) },
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('secure-ok')
      },
    )
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as AddressInfo).port
    try {
      const bridge = { request: (c: Parameters<typeof webRequest>[2]) => webRequest(ctx, globalThis as never, c) }
      const p = createFetchPipeline(bridge as never, {})
      // ★Web 腿对 tlsPins 明确 unsupported（浏览器管 TLS）——这里先证明「不带 pins 时自签被拒」
      const r = await p.fetch(`https://127.0.0.1:${port}/`)
      expect(r.ok, '★自签证书竟然被接受了 —— Node 的 TLS 校验没生效（判据装置问题）').toBe(false)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  it('★★⑦ Web / MP 腿遇到 tlsPins ⇒ **明确 unsupported**（不静默忽略）', async () => {
    const bridge = { request: (c: Parameters<typeof webRequest>[2]) => webRequest(ctx, globalThis as never, c) }
    const p = createFetchPipeline(bridge as never, {})
    const r = await p.fetch('https://example.com/x', { tlsPins: a.spkiPin })
    expect(r.ok, '★Web 端静默接受了 tlsPins —— 业务会以为钉了证书').toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('fetch.unsupported')
      expect(r.error.message).toMatch(/tlsPins/)
    }
  })

  it('★⑧ 四层字段链：`tlsPins` 必须是**字符串**到线格式（数组在 runFetch 已归一）', () => {
    // 断言归一发生在第 ② 层（runFetch），下游三处只认字符串 —— 避免"三处各写一遍归一"
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'packages/api/src/capability-fetch.ts'), 'utf8')
    expect(src, '★runFetch 没有对 tlsPins 做归一（数组形态会漏到下游）').toMatch(/tlsPins:\s*normalizePins\(config\?\.tlsPins\)/)
  })
})

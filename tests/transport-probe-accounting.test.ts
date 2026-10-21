// tests/transport-probe-accounting.test.ts
// ★★★决策 #1155：**传输层探针的计量口径**判据。
//
// 【为什么这条测试必须有（本轮两次假判都不是被测对象的问题，而是计量本身）】
//   ① **控制端点被算进样本** ⇒ 判据自己的 `curl /__pin`（Node 走 h2）与 `useFetch /__stats`
//      被计入 `protocols` ⇒ Android 明明全 `http/1.1`，却因那条 `h2:1` 被判成"已协商 h2"（**假绿**）。
//   ② **连接身份用了 `req.socket`** ⇒ Node 的 h2 兼容层**每个流一个 socket 包装** ⇒
//      同一条 TCP 连接上 3 个流被数成 3 条连接（iOS 实测 `perConnection` 出现 c2/c3/c4 各 1 次，
//      而 `connections` 只计到 2 ⇒ "3 > 2" 判成复用 = **巧合**，换一轮就翻）。
//   ③ 全局 `connection` / `secureConnection` 计数会被**就绪探测**抬高
//      （明文 3 请求实际只用了 1 条连接，全局却计成 3 ⇒ **假红**，害我白查一轮）。
//
// ⇒ 现口径：**按通道分账**（`channels.tls` / `channels.plain`）+ 连接身份 = **对端 socket**
//   （`remoteAddress:remotePort`）+ 只有 `/__whoami` 是受试样本，且 `reused` 由**服务端**算。
//   本测试起真服务端，用**同一会话**与**每次新会话**两种客户端形态对拍——
//   若哪天有人把计量改回"按 socket 对象"或"全局计数"，这里会立刻红。
//
// 【诚实边界】本测试验的是**计量**，不是设备的 h2/复用能力（那是真机探针的事，
//   证据在 `hosts/{android,ios}/results/transport-probe.json`，门禁 `check:cache-evidence`）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http2 from 'node:http2'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = path.join(ROOT, 'hosts/android/tools/h2-echo-server.mjs')

/** 拿一个空闲端口（绑 0 后立刻释放；本测试串行，不会与探针争用） */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port
      s.close(() => resolve(p))
    })
  })
}

/** 等端口就绪：**有界轮询 + 事件驱动**（禁止固定 sleep；本仓红线） */
function waitReady(port: number, deadlineMs = 15000): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const req = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false })
      req.on('error', () => {
        req.close()
        if (Date.now() - started > deadlineMs) reject(new Error(`服务端 ${deadlineMs}ms 内未就绪`))
        else setTimeout(attempt, 100)
      })
      const stream = req.request({ ':path': '/__pin' })
      stream.on('data', () => {})
      stream.on('end', () => {
        req.close()
        resolve()
      })
      stream.on('error', () => {
        req.close()
      })
      stream.end()
    }
    attempt()
  })
}

/** 在指定会话上发一个请求，返回 JSON 体 */
function get(session: http2.ClientHttp2Session, pathname: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = session.request({ ':path': pathname })
    let buf = ''
    req.setEncoding('utf8')
    req.on('data', (d: string) => {
      buf += d
    })
    req.on('end', () => resolve(buf))
    req.on('error', reject)
  })
}

type Channel = { requests: number; protocols: Record<string, number>; conns: Record<string, number>; connections: number; reused: boolean }
type Stats = { channels: Record<string, Channel>; globalConnections: number }

describe('★★★#1155 传输层探针计量口径（h2-echo-server）', () => {
  let child: ChildProcess | undefined
  let port = 0
  let genDir = ''

  beforeAll(async () => {
    port = await freePort()
    genDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-h2-accounting-'))
    child = spawn(process.execPath, [SERVER, String(port), `--gen-dir=${genDir}`], {
      stdio: 'ignore',
      // 自签证书由服务端用 openssl 现生成（与真机探针同一装置）
      env: process.env,
    })
    await waitReady(port)
  }, 60000)

  afterAll(() => {
    child?.kill()
    try {
      fs.rmSync(genDir, { recursive: true, force: true })
    } catch {
      /* 临时目录清理失败不影响判据 */
    }
  })

  it('① 同一会话多次请求 ⇒ 服务端判 reused=true（连接身份按**对端 socket**聚合）', async () => {
    const session = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false })
    try {
      await get(session, '/__whoami?i=1')
      await get(session, '/__whoami?i=2')
      await get(session, '/__whoami?i=3')
      const stats = JSON.parse(await get(session, '/__stats')) as Stats
      const tls = stats.channels.tls
      expect(tls.requests).toBe(3)
      // ★这是本测试的核心断言：3 个 h2 流必须算 **1** 条连接
      //   （旧口径按 `req.socket` 对象计 ⇒ 会得到 3，进而 reused=false）
      expect(tls.connections).toBe(1)
      expect(Object.keys(tls.conns)).toHaveLength(1)
      expect(tls.reused).toBe(true)
      expect(tls.protocols).toEqual({ h2: 3 })
    } finally {
      session.close()
    }
  }, 30000)

  it('② 每次新会话 ⇒ 服务端判 reused=false（不能因为"请求数多"就判复用）', async () => {
    const resetSession = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false })
    await get(resetSession, '/__reset')
    resetSession.close()

    for (let i = 0; i < 3; i++) {
      const s = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false })
      await get(s, `/__whoami?i=${i}`)
      s.close()
    }
    const s2 = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false })
    const stats = JSON.parse(await get(s2, '/__stats')) as Stats
    s2.close()
    const tls = stats.channels.tls
    expect(tls.requests).toBe(3)
    expect(tls.connections).toBe(3)
    expect(tls.reused).toBe(false)
  }, 30000)

  it('③ 控制端点（/__pin、/__stats、/__reset）**不计入受试样本**', async () => {
    const s = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false })
    try {
      await get(s, '/__reset')
      // 只打控制端点，一个 /__whoami 都不发
      await get(s, '/__pin')
      const stats = JSON.parse(await get(s, '/__stats')) as Stats
      // ★旧口径会把 /__pin 与 /__stats（都走 Node h2）算进 protocols ⇒ 假绿"已协商 h2"
      const totalRequests = Object.values(stats.channels).reduce((n, c) => n + c.requests, 0)
      expect(totalRequests).toBe(0)
      expect(stats.channels.tls).toBeUndefined()
    } finally {
      s.close()
    }
  }, 30000)

  it('④ 明文章道与 TLS 通道**分开记账**（跨通道混算会得出错误的复用结论）', async () => {
    const http = await import('node:http')
    const plainPort = await freePort()
    const tlsPort = await freePort()
    const extra = spawn(
      process.execPath,
      [SERVER, String(tlsPort), `--gen-dir=${genDir}`, `--plain-port=${plainPort}`],
      { stdio: 'ignore', env: process.env },
    )
    const getPlain = (p: string): Promise<string> =>
      new Promise((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port: plainPort, path: p }, (res) => {
            let b = ''
            res.setEncoding('utf8')
            res.on('data', (d: string) => {
              b += d
            })
            res.on('end', () => resolve(b))
          })
          .on('error', reject)
      })
    /** 明文端口就绪（有界，最多 15s） */
    const ready = async (): Promise<void> => {
      const started = Date.now()
      for (;;) {
        try {
          await getPlain('/__pin')
          return
        } catch (e) {
          if (Date.now() - started > 15000) throw e
          await new Promise((r) => setTimeout(r, 100))
        }
      }
    }
    try {
      await ready()
      // agent 保持 keep-alive ⇒ 3 个请求复用 1 条连接
      const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
      await new Promise<void>((resolve, reject) => {
        let done = 0
        for (let i = 0; i < 3; i++) {
          http
            .get({ host: '127.0.0.1', port: plainPort, path: `/__whoami?p=${i}`, agent }, (res) => {
              res.resume()
              res.on('end', () => {
                if (++done === 3) resolve()
              })
            })
            .on('error', reject)
        }
      })
      const stats = JSON.parse(await getPlain('/__stats')) as Stats
      const plain = stats.channels.plain
      expect(plain.requests).toBe(3)
      expect(plain.connections).toBe(1)
      expect(plain.reused).toBe(true)
      // ★TLS 通道在本实例上没有任何样本 ⇒ 不能出现"把明文算进 tls"的混账
      expect(stats.channels.tls).toBeUndefined()
      agent.destroy()
    } finally {
      extra.kill()
    }
  }, 60000)
})

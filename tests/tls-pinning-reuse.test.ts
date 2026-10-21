// tests/tls-pinning-reuse.test.ts
// ★★★决策 #1155：**pinning 不得破坏连接复用**——静态判据（防回归）。
//
// 【它守的是一个真机实测抓出的**性能回归**（#1154 引入）】
//   `HttpsURLConnection` 的连接池**按 `SSLSocketFactory` 实例分桶**。
//   #1154 首版每次请求都 `SSLContext.getInstance()` 新建 ⇒ **每次请求都是新 TCP 连接**，
//   连接池与 TLS 会话复用**完全失效**。
//
//   ★真机对照读数（`hosts/android/run-transport-probe.sh` 的明文基线）：
//     · 明文（无 pinning）：5 次请求 / **3** 条连接（`plain:c2` 复用 **4** 次）
//     · TLS + pinning（首版）：4 次请求 / **4** 条连接（每条只用 1 次，**零复用**）
//     · TLS + pinning（缓存后）：4 次请求 / **1** 条连接（`tls:c3` 复用 **4** 次）
//   ⇒ 基线能复用、带 pin 不能 ⇒ 责任在 pinning 实现，**不在平台**。
//
// 【为什么用静态判据】Java 侧的"是否新建了 SSLContext"无法在 Node 里运行验证；
//   而真机判据需要设备（CI 跑不了）。⇒ 这里守**结构性形态**：
//   ① `socketFactory` 必须**先查缓存**、命中即返回；
//   ② 真正构造必须收在独立方法里（`buildSocketFactory`）——保证"缓存入口唯一"；
//   ③ 缓存键必须含 `pinOnly`（否则叠加/替代两档会共用同一 factory，语义错乱）。
//   ★真机判据（`conn_reused_ok`）在 `hosts/android/results/transport-probe.json` 里，
//     由 `check:cache-evidence` 的 transport 段断言——两者一个管结构、一个管行为。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const TLS_JAVA = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/TlsPinning.java'
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('★★#1155 pinning 不得破坏连接复用（真机抓出的性能回归）', () => {
  const java = src(TLS_JAVA)

  it('★★★`socketFactory` 必须**先查缓存**再构造（否则每次请求新建 SSLContext ⇒ 零复用）', () => {
    // 找到 socketFactory 的方法体（从签名到下一个 "private static SSLSocketFactory buildSocketFactory"）
    const start = java.indexOf('public static SSLSocketFactory socketFactory(')
    expect(start, `没找到 socketFactory（${TLS_JAVA} 形态变了？）`).toBeGreaterThan(0)
    const end = java.indexOf('private static SSLSocketFactory buildSocketFactory')
    expect(end, '没找到 buildSocketFactory（构造未收口到独立方法？）').toBeGreaterThan(start)
    const body = java.slice(start, end)
    expect(body, '★socketFactory 里没有缓存查询（FACTORY_CACHE.get）⇒ 每次请求新建 SSLContext ⇒ 连接池失效').toMatch(
      /FACTORY_CACHE\.get\(/,
    )
    expect(body, '★socketFactory 里没有缓存写入（FACTORY_CACHE.put）').toMatch(/FACTORY_CACHE\.put\(/)
    // ★必须"命中即返回"（不能查了却继续往下走）
    expect(body, '★查了缓存但没有提前返回（命中后仍会新建）').toMatch(/if\s*\(cached\s*!=\s*null\)\s*return\s+cached/)
  })

  it('★★缓存键必须含 `pinOnly`（否则叠加/替代两档共用同一 factory，信任语义错乱）', () => {
    const start = java.indexOf('public static SSLSocketFactory socketFactory(')
    const end = java.indexOf('private static SSLSocketFactory buildSocketFactory')
    const body = java.slice(start, end)
    expect(body, '★缓存键不含 pinOnly —— 不同信任语义会命中同一个 factory').toMatch(/cacheKey\s*=\s*[^;]*pinOnly/)
  })

  it('★缓存必须是**进程级**（static）且线程安全（ConcurrentHashMap）', () => {
    expect(java, '★FACTORY_CACHE 不是 static（实例级缓存等于没有缓存）').toMatch(
      /static\s+final\s+java\.util\.Map<\s*String\s*,\s*SSLSocketFactory\s*>\s*FACTORY_CACHE/,
    )
    expect(java, '★FACTORY_CACHE 不是 ConcurrentHashMap（多线程请求会竞争）').toMatch(/ConcurrentHashMap/)
  })

  it('★构造逻辑只有一处（`buildSocketFactory`），`socketFactory` 不自己 new', () => {
    const start = java.indexOf('public static SSLSocketFactory socketFactory(')
    const end = java.indexOf('private static SSLSocketFactory buildSocketFactory')
    const body = java.slice(start, end)
    expect(body, '★socketFactory 里自己调了 SSLContext.getInstance（应只经 buildSocketFactory）').not.toMatch(
      /SSLContext\.getInstance/,
    )
  })
})

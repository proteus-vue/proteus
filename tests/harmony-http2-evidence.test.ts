// tests/harmony-http2-evidence.test.ts
// ★★★#1166：**鸿蒙 HTTP/2 已具备**的真机证据判据（推翻了「需先接 CA/pinning」这个前提）。
//
// 【这条判据守的是什么（一个被误记了两轮的"缺口"）】
//   矩阵与决策 #1163/#1165 一路记着「鸿蒙 RCP 需先接自定义 CA/pinning 才可能协商 h2」。
//   实测推翻，两层误判：
//     ① 把"探针连不上**自签**服务端"当成了"平台不支持 h2"——`run-transport-probe.sh` 用自签证书
//        （为了核对 SPKI pin），而鸿蒙未接自定义 CA ⇒ 连不上 ⇒ `http2_ok=null`（**装置限制**）；
//     ② 没验证 RCP 的底层——实测 `librcp_c.so` 是 **libcurl**（响应头 `uag=libcurl-agent/1.0`），
//        libcurl 原生 ALPN + h2，而**公网证书是系统信任的**，不需要任何自定义 CA。
//
// 【判据口径】
//   · 读已入库的真机证据 `hosts/harmony/results/http-probe-h2.json`（公网 https 请求的响应体回显）；
//   · 断言 `http=http/2`（服务端视角的协议版本）+ TLS 1.3 + 请求成功；
//   · 同时断言**矩阵不再写"需先接 CA/pinning"**（防文档回退到旧结论）。
//
// 【★为什么不能用 transport-probe 的证据】那份探针连的是**自签** h2 服务端，
//   鸿蒙未接自定义 CA ⇒ 永远 `null`（未测）。用它会得出"鸿蒙没 h2"的错误结论——
//   这正是本轮之前的坑。⇒ 鸿蒙 h2 的判据**必须**走公网端点（本文件）。
//
// 【诚实边界】公网端点只证明"对那个服务端协商到了 h2"，不证明"任意服务端都能 h2"
//   （取决于对端是否支持 h2）。这对三端是**同一口径**：iOS/Android 的判据也只证明对被测服务端成立。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')
const EV = 'hosts/harmony/results/http-probe-h2.json'

describe('★★★#1166 鸿蒙 HTTP/2 已具备（真机证据）', () => {
  it('★★★真机证据存在且为 h2：http=http/2 + TLS 1.3', () => {
    expect(fs.existsSync(path.join(ROOT, EV)), `缺真机证据 ${EV}（跑 bash hosts/harmony/run-http-probe.sh --url https://www.cloudflare.com/cdn-cgi/trace）`).toBe(true)
    const d = JSON.parse(read(EV)) as { ok?: boolean; status?: number; bodyBytes?: number; preview?: string }
    expect(d.ok, '★请求应成功').toBe(true)
    expect(d.status, '★状态码应为 200').toBe(200)
    expect(Number(d.bodyBytes), '★应有响应体（协议回显来自真实响应）').toBeGreaterThan(50)
    const p = String(d.preview ?? '')
    // ★核心断言：服务端回显的协议版本是 http/2
    expect(p, '★鸿蒙应在用 HTTP/2（预期响应体含 http=http/2）').toContain('http=http/2')
    // ★附带证据：TLS 1.3 + 系统信任的公网证书（不需要自定义 CA，这正是原前提错的地方）
    expect(p, '★应为 TLS 1.3').toContain('tls=TLSv1.3')
    expect(p, '★底层是 libcurl（这是"RCP 支持 h2"的机制解释）').toContain('uag=libcurl-agent')
  })

  it('★★矩阵不得再写「鸿蒙 h2 需先接自定义 CA/pinning」这个错误前提', () => {
    const md = read('docs/proteus-network-plan/00-capability-matrix.md')
    // ★口径（#1166 实测收紧）：**逐行**判断，只认同**同一行内**的否定标记。
    //   ★为什么不看"后 2 行"：那样只要附近某处写了"是错的"，任何新增的旧结论行都会蒙混过关
    //     （破坏性验证实测：注入"需先接 CA/pinning（待办）"仍全绿）。
    for (const line of md.split('\n')) {
      if (!/需先接自定义 CA\/pinning 才可能协商/.test(line)) continue
      const negated = /是错的|已被|推翻|原写|误判|~~.*~~/.test(line)
      expect(negated, `★该行把"需先接 CA/pinning"当现行要求（#1166 已推翻）：${line.slice(0, 100)}`).toBe(true)
    }
    // 必须有"已取证具备"的正面记录
    expect(md, '★矩阵缺"鸿蒙 h2 已具备"的取证记录').toMatch(/#1166 已取证：本来就具备|已在用 HTTP\/2/)
  })

  it('★★RCP 头文件无 HTTP 版本选项（协议版本由 libcurl ALPN 决定，我们无需也无法指定）', () => {
    // ★这条解释"为什么 h2 不需要我们做配置"——如果有人以为要加协议开关，会在这里看到答案。
    const md = read('docs/proteus-network-plan/00-capability-matrix.md')
    expect(md, '★缺"RCP 无 HTTP 版本选项"的取证说明').toMatch(/没有 HTTP 版本选项|无需也无法.*显式指定/)
  })
})

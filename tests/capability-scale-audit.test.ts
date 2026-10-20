// tests/capability-scale-audit.test.ts
// ★★★决策 #1113：能力端「规模承载」体检——用户 2026-10-20 明令的**端落地硬指标**。
//
// 【用户原话】「每一个能力的端落地都要能承载大厂超级应用规模才行，不能是只有基本能力，
//   这个是端落地的硬指标。」⇒ 端上有方法 ≠ 落地；一上量就 OOM/卡死/静默丢数据 ⇒ 按未落地计。
//
// 【本测试守什么（重点在"判据本身不能被假证据骗"）】
//   本轮判据连续三次被**看起来像证据的文本**骗过，每次都会造成假绿：
//     ① 关键词太宽：`stream|chunk|offset` ⇒ 连局部变量 `offset` 都算"流式"；
//     ② 读了注释：`transfer` 注释写「**分块协议属后续批次**」（明说没有）却被判成有；
//     ③ 读了字符串字面量：错误消息 `"…分块读取属后续批次"` 同样被当成"有流式"。
//   ⇒ 三条都必须锁住：**只看代码标识符，不看注释、不看文案**。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')
const AUDIT = 'scripts/capability-scale-audit.mjs'

function runAudit(args: string[] = []): { code: number; out: string; json?: unknown } {
  try {
    const out = execFileSync('node', [path.join(ROOT, AUDIT), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    let json: unknown
    if (args.includes('--json')) { try { json = JSON.parse(out) } catch { /* ignore */ } }
    return { code: 0, out, json }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

describe('★#1113 规模承载体检 · 判据不能被骗', () => {
  it('★必须剥离注释（`transfer` 注释写着"分块协议属后续批次"——不得当成有流式）', () => {
    const s = read(AUDIT)
    expect(s).toMatch(/function stripComments/)
    // ★#1113 修正：光有 `stripComments` 这个词不算——必须**在读取路径上真的被调用**。
    //   实测第一版只查函数定义 ⇒ 把调用点移除（回到读注释的旧行为）测试仍然绿（假绿）。
    expect(
      s,
      'stripComments 未在读取路径上被调用 ⇒ 判据会重新读注释（假绿）',
    ).toMatch(/text \+= [^\n]*stripComments\(fs\.readFileSync/)
  })

  it('★流式判据不得用裸关键词（`stream|chunk|offset` 会命中局部变量）', () => {
    const s = read(AUDIT)
    // ★不用正则抠数组（内部含大量括号），直接看"流式判据所在区块"——从 streaming: 到下一个顶层键
    const start = s.indexOf('streaming: [')
    expect(start, '找不到 streaming 判据').toBeGreaterThan(0)
    const end = s.indexOf('resourceLedger:', start)
    expect(end, '找不到 streaming 区块结束').toBeGreaterThan(start)
    const body = s.slice(start, end)
    expect(body, '流式判据必须是标识符级形态').toMatch(/chunkSize|CHUNK_SIZE|readChunk|writeChunk/)
    expect(body, '不得出现裸 offset 判据（会被局部变量骗）').not.toMatch(/\boffset\b/)
  })

  it('★字符串字面量不得作为证据（错误文案里说"分块"不代表有分块实现）', () => {
    // 直接验证行为：upload 的注释与错误消息都提到"分块"，但实现没有 ⇒ 判据必须给 ❌
    const { json } = runAudit(['--json', '--cap=upload'])
    const rows = json as Array<{ cap: string; streaming: boolean; tier: string }>
    expect(rows[0].cap).toBe('upload')
    expect(
      rows[0].streaming,
      'upload 被判为"有流式"——但源码里分块只出现在注释与错误消息中（实现是整块进内存）',
    ).toBe(false)
  })

  it('★fetch 现已达标 S2：上限 ✅ + 显式错误码 ✅（#1115 修复后；本测试同时守"不得回退到整包无界"）', () => {
    // 【#1114 的取证】修复前：两端**整包响应进内存且无总上限**——
    //   · Android `readAll` 用 `ByteArrayOutputStream` 一路 write（`READ_CHUNK=16KB` 只是单次缓冲量）
    //   · iOS `session.dataTask(with:)` 整个 body 一次进内存
    //   · 唯一的 `MAX` 是 `PENDING_HOST_CALLS_MAX = 1024`（**挂起调用条数**，属并发维度）
    //   ⇒ 当时 `upperBound` 被判 true 是**假绿**（把并发计数当尺寸上限）。
    //
    // 【#1115 修复】两端都加：① `MAX_BODY_BYTES = 32 MiB`（同值）
    //   ② 累计超限 ⇒ 中止 + 显式 `fetch.tooLarge`
    //   （Android：Content-Length 预判 + 读取累计；iOS：delegate 逐块 + `cancel()` 真中止）
    //   ⇒ 现在 `upperBound` 与 `explicitError` 都应为 true。
    //
    // ★本测试的反向保护：若有人把上限删了/把它改回"只看 PENDING_*MAX"，上面两条会重新变 false ⇒ 红。
    const { json } = runAudit(['--json', '--cap=fetch'])
    const r = (json as Array<{ cap: string; upperBound: boolean; explicitError: boolean; tableBound: boolean; tier: string }>)[0]
    expect(r.cap).toBe('fetch')
    expect(
      r.upperBound,
      'fetch 又没有尺寸上限了 —— 两端必须都有 MAX_BODY_BYTES（且不得把 PENDING_*MAX 当成尺寸上限）',
    ).toBe(true)
    expect(r.explicitError, '超限必须给显式错误码（fetch.tooLarge），不能静默截断').toBe(true)
    // 并发维度仍应被识别（PENDING_HOST_CALLS_MAX 确实存在）
    expect(r.tableBound, 'fetch 的并发上界应被识别（PENDING_HOST_CALLS_MAX）').toBe(true)
    // S2 达成（S3 仍需流式/背压/回收）
    expect(r.tier).toBe('S2')
  })

  it('★"上限"常量必须按尺寸语义识别（`PENDING_*`/`COUNT` 类名字归并发，不算尺寸）', () => {
    const s = read(AUDIT)
    expect(s, '缺 SIZE_WORD / COUNT_WORD 的区分').toMatch(/SIZE_WORD/)
    expect(s).toMatch(/COUNT_WORD/)
    // 挂起调用条数必须归到 tableBound，而不是 upperBound
    const tb = s.slice(s.indexOf('tableBound:'), s.indexOf('tableBound:') + 300)
    expect(tb, 'tableBound 未收录 PENDING_*MAX（并发维度）').toMatch(/PENDING_\[A-Z_\]\*MAX/)
  })

  it('★upload/download 的档位必须是 S2 且**未达 S3**（有 64MiB 上限但无背压/并发上界）', () => {
    const { json } = runAudit(['--json', '--cap=upload,download'])
    const rows = json as Array<{ cap: string; tier: string }>
    for (const r of rows) {
      expect(r.tier, `${r.cap} 档位变了（若真做了流式/背压，请同步更新本测试与 §1.0 的反例表）`).toBe('S2')
    }
  })
})

describe('★#1113 规模承载体检 · 工具契约', () => {
  it('工具存在、可运行、且**不判红**（规模档是排期输入，不是 CI 红绿）', () => {
    expect(fs.existsSync(path.join(ROOT, AUDIT))).toBe(true)
    const { code, out } = runAudit()
    expect(code, '体检工具不应因为存在缺口而 exit 1').toBe(0)
    expect(out).toMatch(/不判红/)
  })

  it('★能力边界写明：静态体检 ≠ 规模合格证（真机压测才作数）', () => {
    const s = read(AUDIT)
    expect(s).toMatch(/静态体检/)
    expect(s).toMatch(/不能证明真实规模|不能证明/)
    expect(s).toMatch(/压测/)
  })

  it('★规模档定义与规范同源（四档 S0-S3 + 四项必答）', () => {
    const plan = read('docs/Proteus_原生能力接入方案.md')
    for (const k of ['S0', 'S1', 'S2', 'S3']) expect(plan, `规范缺 ${k} 档`).toContain(`**${k}**`)
    for (const k of ['上限', '背压', '回收', '并发/淘汰']) expect(plan, `规范缺"${k}"维度`).toContain(k)
    // 用户原话要留在规范里（这是这条硬指标的出处，不是二手转述）
    expect(plan).toContain('承载大厂超级应用规模')
  })
})

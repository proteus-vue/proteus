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
    // ★★#1248 口径更新（原断言已过时，必须改而不是让它红着）：
    //   · 本测试写于 #1113：当时 upload 是**整块进内存**，分块只出现在注释与错误消息里。
    //   · #1120 之后 upload **真的流式了**（宿主 `FileInputStream` 边读边发 +
    //     `setFixedLengthStreamingMode`；真机 `peak_chunk_bytes=8192`，与文件大小无关）。
    //   ⇒ 再断言"upload 无流式"就是拿旧结论压新实现（假红）。
    //   ⇒ 改为守**产生这次误判的那个性质**：判据读的是代码标识符，注释与字符串不算证据。
    //     用一段构造文本直接验：只有注释说"分块"、代码里没有 ⇒ 不得判有流式。
    const s = read(AUDIT)
    expect(s, 'streaming 判据必须基于标识符（CHUNK_SIZE/readChunk/…），不能是裸词').toMatch(
      /chunkSize|CHUNK_SIZE|readChunk|writeChunk/,
    )
    // ★并保留一条"当前事实"的断言：upload 现在**确实**是流式（#1120），
    //   若哪天它退化回整包，这条会红——这才是此刻有意义的方向。
    const { json } = runAudit(['--json', '--cap=upload'])
    const rows = json as Array<{ cap: string; streaming: boolean }>
    expect(rows[0].streaming, 'upload 已流式（#1120 宿主边读边发）；若回退到整包，请同步 §1.0').toBe(true)
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
    // ★★#1243：fetch 现已到 **S3**（补上最后一个缺口"回收"：在飞请求登记账本，
    //   页面 dispose ⇒ 真取消）。此前这里断言 S2 是因为"回收"维度没有落地。
    expect(r.tier).toBe('S3')
  })

  it('★"上限"常量必须按尺寸语义识别（`PENDING_*`/`COUNT` 类名字归并发，不算尺寸）', () => {
    const s = read(AUDIT)
    expect(s, '缺 SIZE_WORD / COUNT_WORD 的区分').toMatch(/SIZE_WORD/)
    expect(s).toMatch(/COUNT_WORD/)
    // 挂起调用条数必须归到 tableBound，而不是 upperBound
    const tb = s.slice(s.indexOf('tableBound:'), s.indexOf('tableBound:') + 300)
    expect(tb, 'tableBound 未收录 PENDING_*MAX（并发维度）').toMatch(/PENDING_\[A-Z_\]\*MAX/)
  })

  it('★upload/download 现为 S3（#1120 流式上传 + #1123 流式下载，双真机验过）', () => {
    // ★★#1248 口径更新：原断言是「S2 且未达 S3」，那是 #1113 时的状态。
    //   #1120 做了**流式上传**（宿主自读文件自拼 multipart）、#1123 做了**流式下载**
    //   （宿主边收边写盘），两者都有真机读数（`peak_chunk_bytes` 与文件大小无关）。
    //   ★此前审计一直判它们 S2，根因是**源文件登记错了**（只读 FileTransferCapability，
    //     而流式主体在 HttpCapability）——这是 #1242 修的第三处"读错文件"。
    const { json } = runAudit(['--json', '--cap=upload,download'])
    const rows = json as Array<{ cap: string; tier: string; streaming: boolean }>
    for (const r of rows) {
      expect(r.streaming, `${r.cap} 应被判为有流式（#1120/#1123）`).toBe(true)
      expect(r.tier, `${r.cap} 现为 S3；若掉档请对照 §1.0 的四项必答找缺口`).toBe('S3')
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

describe('★★★#1236 判据修正后不得再犯了（两处结构性缺陷的回归锁）', () => {
  it('★上限：带前缀的常量名必须被识别（`LOG_MAX_*` / `FS_MAX_*`——旧正则 \bMAX_ 漏判）', () => {
    const { json } = runAudit(['--json', '--cap=log'])
    const r = (json as Array<{ cap: string; upperBound: boolean }>)[0]
    expect(r.upperBound, '★LOG_MAX_MESSAGE_BYTES 未被认成上限 ⇒ 前缀盲区又回来了').toBe(true)
  })

  it('★上限修正必须是**超集**：fetch/storage/file-system 的上限仍被识别', () => {
    const { json } = runAudit(['--json', '--cap=fetch,storage,file-system'])
    for (const r of json as Array<{ cap: string; upperBound: boolean }>) {
      expect(r.upperBound, `${r.cap} 的上限丢了 ⇒ 修正不是超集（换了个漏法）`).toBe(true)
    }
  })

  it('★背压判据必须是"成对"（有界 + 计数）——单一关键词会被无关文本骗', () => {
    const s = read(AUDIT)
    const fn = /function hasBackpressure\(text\) \{([\s\S]{0,300}?)\n\}/.exec(s)
    expect(fn, 'hasBackpressure 必须存在（背压不能用单条正则）').toBeTruthy()
    const body = fn![1] as string
    expect(body, '缺"有界"一侧').toMatch(/BP_BOUND\.test\(text\)/)
    expect(body, '缺"计数"一侧').toMatch(/BP_COUNTER\.test\(text\)/)
    expect(body, '必须是**与**（成对）').toMatch(/&&/)
    // ★这一条是 #1236 的真实假绿：iOS 的 `dropFirst(docs.count` 曾把 fetch 的背压判成成立。
    //   ★断言**代码结构**而不是文本——注释里记录了这个 bug 的说明，文本匹配会命中注释，
    //     那正是本仓反复踩的"判据读错文本层"（不能在新判据里再犯一次）。
    //   · SIGNALS.backpressure 必须已停用（置 null），否则旧的单关键词路径还在
    expect(s, 'SIGNALS.backpressure 必须已停用（改走成对判定）').toMatch(/backpressure:\s*null/)
    //   · 背压必须是"有界 + 计数"**两个证据都存在**——#1249 后落在 audit() 的 bpBound/bpCounter
    //     ★不放钉具体调用形态（那只是实现的写法，会随重构失效而误红）
    expect(s, 'audit() 里背压必须同时要求"有界"与"计数"两个证据').toMatch(
      /backpressure:\s*Boolean\(\s*bpBound\s*&&\s*bpCounter\s*\)/,
    )
  })

  it('★★★三项（log/storage/file-system）按 §1.0 到 S3（高频族要求 S3）', () => {
    const { json } = runAudit(['--json', '--cap=log,storage,file-system'])
    const rows = json as Array<{ cap: string; tier: string; needsS3: boolean }>
    for (const r of rows) {
      expect(r.needsS3, `${r.cap} 应归入高频族（要求 S3）`).toBe(true)
      expect(r.tier, `${r.cap} 的规模档回落了 —— 四项必答有缺口（见 docs/Proteus_原生能力接入方案.md §1.0）`).toBe('S3')
    }
  })
})

describe('★★★#1248 判据必须"被实现撑住"，不是"被词表撑住"（反向验证固化）', () => {
  // 【这条测试的由来】改完判据后我做了一次反向验证：把能力源码里的上限常量**拆掉**，
  //   重跑体检看档位是否掉。第一版 7 个里只有 1 个掉 —— 那说明当时的 ✅ **是被词表撑住的**。
  //   根因：判据是**文件级 any()**（文件里出现任一上限 ⇒ 五项全 ✅），
  //   而能力文件里通常还有别的上限 ⇒ 删掉某一个仍判"有上限"。
  //   ⇒ 已升级为「**上限常量必须真的被用于一个比较判断**」（usedBounds）。
  //   本测试锁住这个性质：拆掉全部上限 ⇒ 档位必须掉。
  it('★拆掉 log 的全部上限 ⇒ 档位必须从 S3 掉下来（证 ✅ 是实现撑住的）', () => {
    const p = path.join(ROOT, 'packages/api/src/capability-app-log.ts')
    const src = fs.readFileSync(p, 'utf8')
    const before = runAudit(['--json', '--cap=log'])
    const tierBefore = (before.json as Array<{ tier: string }>)[0].tier
    expect(tierBefore).toBe('S3')
    try {
      // 把所有 `MAX_* = <数字>` 改成无界大值（保留名字与用法 ⇒ 等价于"闸被拆了"）
      const neutered = src.replace(
        /((?:[A-Z][A-Z0-9_]*_)?MAX_[A-Z0-9_]+)(\s*=\s*)([\d_]+(?:\s*\*\s*[\d_]+\s*)*)/g,
        (_m, name, eq) => `${name}${eq}Number.MAX_SAFE_INTEGER`,
      )
      expect(neutered, '确实改到了文件').not.toBe(src)
      fs.writeFileSync(p, neutered)
      const after = runAudit(['--json', '--cap=log'])
      const r = (after.json as Array<{ tier: string; upperBound: boolean }>)[0]
      expect(r.upperBound, '★拆掉上限后不该还判"有上限"').toBe(false)
      expect(r.tier, '★档位必须掉（否则 S3 是词表撑的）').not.toBe('S3')
    } finally {
      fs.writeFileSync(p, src)   // ★必须还原（这条测试会临时改生产源码）
    }
    // 还原后必须回到 S3（确认 finally 真的生效、且判据可重复）
    const restored = runAudit(['--json', '--cap=log'])
    expect((restored.json as Array<{ tier: string }>)[0].tier).toBe('S3')
  })

  it('★上限判据要求"被用于判断"：只有定义、从不比较的常量不算上限', () => {
    const s = read(AUDIT)
    expect(s, '必须有 usedBounds（逐常量 + 要求被用于判断）').toMatch(/function usedBounds/)
    expect(s, 'audit() 必须调用 usedBounds').toMatch(/usedBounds\(docs\)/)
    // 反向：不得退回"文件里出现即算"的形态
    expect(s, '不得退回 SIGNALS.upperBound 的文件级 any()').not.toMatch(/upperBound:\s*has\(SIGNALS\.upperBound\)/)
  })
})

describe('★★★#1249 五维判据都必须"被实现撑住"（每个维度都能被删红）', () => {
  // 【由来】#1248 发现 upperBound 是文件级 any()；#1249 把同一测试套到其余四维：
  //   6 个里 4 个仍不翻转 ⇒ 同样的结构性假绿。本轮把五维全部改成"证据必须被使用"，
  //   并**给每个维度输出证据（文件:行 + 片段）**——光有布尔值看不出来源，假绿永远藏得住。
  // 【本测试守什么】对每个维度，找到该能力**真正依赖的那处实现**，全部拆掉 ⇒ 该维度必须翻转。
  //   ★注意"全部"：能力通常有**冗余闸**（ws 有 5 处背压计数、log 有 3 处上限比较），
  //     只拆一处不该掉——那是设计的冗余，不是判据失效（v1/v2/v3 三次写错期望都是这个原因）。

  const withMutation = (file: string, res: RegExp[], check: () => void): void => {
    const p = path.join(ROOT, file)
    const backup = fs.readFileSync(p, 'utf8')
    try {
      for (const re of res) {
        const next = fs.readFileSync(p, 'utf8').replace(re, 'false')
        fs.writeFileSync(p, next)
      }
      check()
    } finally {
      fs.writeFileSync(p, backup)   // ★必须还原（这条测试会临时改生产源码）
    }
  }

  const auditOf = (cap: string): { tier: string; [k: string]: unknown } => {
    const { json } = runAudit(['--json', `--cap=${cap}`])
    return (json as Array<{ tier: string; [k: string]: unknown }>)[0]!
  }

  it('① upperBound：拆掉 log 的全部上限比较 ⇒ 维度翻转', () => {
    expect(auditOf('log').upperBound).toBe(true)
    withMutation(
      'packages/api/src/capability-app-log.ts',
      [
        /msgBytes > LOG_MAX_MESSAGE_BYTES/g,
        /dataBytes > LOG_MAX_DATA_BYTES/g,
        /sent \+ failed\.length < LOG_MAX_BATCH/g,
        /pending\.length >= LOG_MAX_QUEUE/g,
      ],
      () => {
        expect(auditOf('log').upperBound, '★拆掉全部上限比较后不该还判有上限').toBe(false)
        expect(auditOf('log').tier, '★档位必须掉').not.toBe('S3')
      },
    )
    expect(auditOf('log').upperBound, '还原后回到 true').toBe(true)
  })

  it('② backpressure：拆掉 ws 的全部 5 处背压计数 ⇒ 维度翻转', () => {
    expect(auditOf('websocket').backpressure).toBe(true)
    withMutation(
      'packages/api/src/capability-websocket.ts',
      [
        /wsStats\.slowDispatches\+\+/g,
        /wsStats\.messagesDropped\+\+/g,
        /wsStats\.dispatchTruncated\+\+/g,
        /wsStats\.rejectedConnections\+\+/g,
        /wsStats\.rejectedHandlers\+\+/g,
      ],
      () => {
        expect(auditOf('websocket').backpressure, '★计数全拆后不该还判有背压').toBe(false)
      },
    )
  })

  it('③ tableBound：拆掉 ws 的全部表项上界比较 ⇒ 维度翻转', () => {
    expect(auditOf('websocket').tableBound).toBe(true)
    withMutation(
      'packages/api/src/capability-websocket.ts',
      [/conns\.size >= WS_MAX_CONNECTIONS/g, /set\.size >= WS_MAX_HANDLERS_PER_EVENT/g],
      () => {
        expect(auditOf('websocket').tableBound, '★拆掉上界比较后不该还判有并发上界').toBe(false)
      },
    )
  })

  it('④ resourceLedger：拆掉 register+release 钩子 ⇒ 维度翻转', () => {
    expect(auditOf('log').resourceLedger).toBe(true)
    withMutation(
      'packages/api/src/capability-app-log.ts',
      [/opts\.resources\.register\(\{[\s\S]{0,500}?release: \(\) => \{ pending\.length = 0 \},\n    \}\)/],
      () => {
        expect(auditOf('log').resourceLedger, '★拆掉账本登记后不该还判有账本').toBe(false)
      },
    )
  })

  it('⑤ 五个维度都必须给出**可核对的证据**（文件:行 + 片段），不是只有布尔值', () => {
    // ★这是本轮的另一个关键改动：布尔值看不出"命中了哪一行"，
    //   而 #1249 的四处假绿正是靠"看命中的是哪一行"才定位到的。
    const r = auditOf('log') as unknown as {
      evidence: Record<string, { file: string; line: number; snippet: string } | null>
    }
    for (const dim of ['upperBound', 'tableBound', 'backpressureBound', 'backpressureCounter', 'resourceLedger', 'explicitError']) {
      const ev = r.evidence[dim]
      expect(ev, `${dim} 必须给出证据（否则假绿看不出）`).toBeTruthy()
      expect(ev!.file, `${dim} 证据要指到文件`).toMatch(/\.(ts|java|swift|h)$/)
      expect(ev!.line, `${dim} 证据要指到行`).toBeGreaterThan(0)
      expect(ev!.snippet.length, `${dim} 证据要带片段`).toBeGreaterThan(0)
    }
  })

  it('⑥ 不许跨能力污染：ws 的证据里不得出现 sensor/capture 的常量', () => {
    // ★#1249 实测：websocket 的源列表曾包含装配文件 capability-app-device.ts，
    //   于是 SENSOR_MAX_* / CAPTURE_MAX_* 被算进 ws 的档位 ⇒ 删掉 ws 自己的连接上界后
    //   仍 ✅（别人的上界在撑着）。这是"证据来源"层面的假绿，最隐蔽。
    const r = auditOf('websocket') as unknown as { upperBoundNames: string[]; tableBoundNames: string[] }
    const all = [...r.upperBoundNames, ...r.tableBoundNames]
    expect(
      all.filter((n) => /^SENSOR_|^CAPTURE_/.test(n)),
      '★ws 的上界证据里出现了 sensor/capture 的常量 ⇒ 跨能力污染',
    ).toEqual([])
  })
})
})

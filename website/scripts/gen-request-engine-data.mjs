#!/usr/bin/env node
// website/scripts/gen-request-engine-data.mjs —— ★★★Phylax（请求治理层）产品页的**数据同源生成器**
//
// 【为什么（与 gen-css-engine-data.mjs 同一纪律）】`/phylax` 产品页要展示判据条数、
//   痛点覆盖、包结构、两条通道——这些是**机器产物**（`docs/generated/request-engine-numbers.json`，
//   由 `scripts/gen-request-engine-numbers.mjs` 从各源读出）。
//   页面若手写数字，产物一动页面就"说谎"（本仓亲历：白皮书三处数字静默漂移、无门禁覆盖）。
//   ⇒ SSOT = 上面那份 json；本脚本产出 `website/src/data/request-engine-page.ts`（生成物，勿手改）；
//     `--check` 供 CI/verify 防漂移。
//
// 用法：node website/scripts/gen-request-engine-data.mjs          # 生成
//       node website/scripts/gen-request-engine-data.mjs --check  # 门禁（漂移 exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const NUMBERS = path.join(ROOT, 'docs/generated/request-engine-numbers.json')
const OUT_TS = path.join(ROOT, 'website/src/data/request-engine-page.ts')
const CHECK = process.argv.includes('--check')

if (!fs.existsSync(NUMBERS)) {
  console.error(`✗ 缺 ${path.relative(ROOT, NUMBERS)}——先跑 node scripts/gen-request-engine-numbers.mjs`)
  process.exit(1)
}

const N = JSON.parse(fs.readFileSync(NUMBERS, 'utf8'))

/**
 * 页面叙事骨架（**非数字**部分，手写是允许的——它讲的是"为什么"，不是"多少"）。
 * ★数字一律从 N 取，这里不出现任何计数。
 */
const PAGE = {
  numbers: N,
  /**
   * ★★★#1404：**性能读数**（来自 docs/generated/request-perf-report.json）
   * ★只放"能对外宣称"的部分；"不证明什么"清单原样带上（页面必须和它一起展示）。
   */
  perf: (() => {
    // ★ESM：本文件已有顶层 `fs`/`path` import（见文件头）—— 不再 require
    const p = path.join(ROOT, 'docs/generated/request-perf-report.json')
    if (!fs.existsSync(p)) return null
    const r = JSON.parse(fs.readFileSync(p, 'utf8'))
    return {
      jsLayer: r.jsLayer ? {
        concurrency: r.jsLayer.params.concurrency,
        bareP50Ms: r.jsLayer.bare.p50Ms,
        fullP50Ms: r.jsLayer.full.p50Ms,
        p50Ratio: r.jsLayer.overhead.p50Ratio,
        noiseFloorP50Ms: r.jsLayer.overhead.noiseFloorP50Ms,
        belowNoiseFloor: r.jsLayer.overhead.belowNoiseFloor,
        qpsDropPct: r.jsLayer.overhead.qpsDropPct,
        p99Unstable: r.jsLayer.p99Stability?.p99Unstable ?? false,
      } : null,
      /**
       * ★★★#1404：逐端吞吐（`ends`）+ 平台期归属（`attribution`）。
       *   ★页面必须逐端渲染并标注通路（iOS WiFi / Android USB 回环）——
       *     只给出一个 QPS 而不说哪一端、哪条通路，是最容易被误引用的形态。
       *   ★保留顶层 points/best/knee（兼容旧字段）：消费方若只读旧字段不会变成空白。
       */
      throughput: r.throughput?.measured ? {
        points: r.throughput.points,
        best: r.throughput.best,
        knee: r.throughput.knee,
        ends: (r.throughput.ends ?? []).map((e) => ({
          end: e.end,
          transportMode: e.transportMode,
          points: e.points,
          best: e.best ?? null,
          knee: e.knee ?? null,
          /** ★#1404 形状三分必须透出——页面靠它区分"平台期"与"仍在上升"（缺了就两种都显示成空的） */
          shape: e.shape ?? null,
        })),
        attribution: r.throughput.attribution ?? [],
      } : null,
      highPressure: r.highPressure ? {
        rateLimitPass: r.highPressure.rateLimit.pass,
        quotaPass: r.highPressure.quota.pass,
        quotaPeak: r.highPressure.quota.peakInflight,
        quotaConfigured: r.highPressure.quota.configuredConcurrency,
        auditPass: r.highPressure.audit.pass,
        auditWritten: r.highPressure.audit.written,
        auditAttempted: r.highPressure.audit.attempted,
        allPass: r.highPressure.allPass,
      } : null,
      devices: r.devices.map((d) => ({ end: d.end, verified: d.verified, ttfbMs: d.steadyTtfbMs ?? null, reason: d.reason ?? null })),
      notProven: r.notProven ?? [],
      deviceCaveats: r.deviceCaveats ?? [],
    }
  })(),
  /**
   * ★★★#1396：**闸门序列** —— 本页的主轴。一条请求依次穿过它们。
   * ★为什么是有序列表而不是并列卡片：请求治理是**一个运行时过程**，不是一组静态能力。
   *   页面的结构必须复现这个过程**顺序与分岔**，否则它就只是"一篇文章在讲一个流程"。
   */
  gates: [
    {
      no: '01', zh: '域名白名单', en: 'Domain allowlist',
      zhCheck: '目标 host 在平台配置的允许列表内？', enCheck: 'Is the target host on the platform allowlist?',
      zhOnFail: '拦下 · request.forbidden / websocket.forbidden', enOnFail: 'rejected · request.forbidden / websocket.forbidden',
      zhNote: 'HTTP 与 WebSocket 共用同一份 isHostAllowed —— 业务换 API 也逃不掉',
      enNote: 'HTTP and WebSocket share one isHostAllowed — switching APIs does not escape it',
      tone: 'bad',
    },
    {
      no: '02', zh: '业务配额', en: 'Business quota',
      zhCheck: '该 bizId 的并发/连接额度还有余量？', enCheck: 'Does this bizId still have concurrency/connection budget?',
      zhOnFail: '拦下 · quotaExceeded（WS 是长连接，排队等待无意义）', enOnFail: 'rejected · quotaExceeded (a long-lived WS cannot sensibly queue)',
      zhNote: '一业务打满不阻塞另一业务；WS 额度直到连接真正关闭才释放',
      enNote: 'One tenant saturating never blocks another; WS quota is held until the socket actually closes',
      tone: 'bad',
    },
    {
      no: '03', zh: '幂等键', en: 'Idempotency key',
      zhCheck: '这个逻辑请求有稳定的幂等键吗？', enCheck: 'Does this logical request carry a stable idempotency key?',
      zhOnFail: '降级 · 非幂等且无 key ⇒ 本次不重试（防重复提交）', enOnFail: 'degraded · non-idempotent without a key ⇒ no retry (prevents duplicate writes)',
      zhNote: '键在同一逻辑请求的所有重试间复用；服务端按它去重',
      enNote: 'The key is reused across every retry of one logical request; the server deduplicates on it',
      tone: 'warn',
    },
    {
      no: '04', zh: '重试门禁', en: 'Retry gate',
      zhCheck: '方法允许重试吗？（只有幂等方法可无条件重试）', enCheck: 'Is the method retryable? (only idempotent methods retry unconditionally)',
      zhOnFail: '拒绝 · POST 无 key ⇒ retryRefused 如实写进 meta', enOnFail: 'refused · POST without a key ⇒ retryRefused recorded in meta',
      zhNote: '被拒不是静默跳过 —— 业务必须能看出"不是没重试，是不允许"',
      enNote: 'Refusal is never silent — the business must see "not retried because disallowed", not "retry broke"',
      tone: 'warn',
    },
    {
      no: '05', zh: '去重身份', en: 'Dedupe identity',
      zhCheck: '这个在飞请求与别的请求"真的相同"吗？', enCheck: 'Is this in-flight request truly identical to another?',
      zhOnFail: '合并 · 键含身份/租户头；跨租户绝不合并', enOnFail: 'merged · key includes identity/tenant headers; never merged across tenants',
      zhNote: '配了请求拦截器 ⇒ 干脆不去重（键代表不了最终身份），并在 meta 说明',
      enNote: 'With request interceptors configured, dedupe is skipped entirely (the key cannot represent final identity) and said so in meta',
      tone: 'ok',
    },
  ],
  /** 出口告示（边界不是列表节，是管道尽头的告示牌） */
  boundaries: [
    { zh: '不接支付渠道 SDK（微信/支付宝/Apple IAP）——只管请求可靠性语义', en: 'No payment SDK integration (WeChat Pay / Alipay / Apple IAP) — reliability semantics only' },
    { zh: '不做 schema / OpenAPI 代码生成', en: 'No schema / OpenAPI code generation' },
    { zh: '断路器与配额是进程内状态，跨进程共享需宿主支持', en: 'Breaker and quota are in-process; cross-process sharing needs host support' },
    { zh: '脱敏是字段名匹配，不是内容识别', en: 'Redaction is field-name matching, not content detection' },
    { zh: 'unknown 之后能否正确处置是业务的责任——本层只保证状态诚实', en: "Whether code handles unknown correctly is the business's responsibility — this layer only keeps the state honest" },
  ],
}

const header =
  '// ⚠️ AUTO-GENERATED by website/scripts/gen-request-engine-data.mjs — DO NOT EDIT.\n'
  + '// SSOT：docs/generated/request-engine-numbers.json\n'
  + '// 重新生成：node website/scripts/gen-request-engine-data.mjs · 防漂移门禁：pnpm check:request-engine-data\n'

const ts = header + 'export const REQUEST_ENGINE_PAGE = ' + JSON.stringify(PAGE, null, 2) + ' as const\n'

if (CHECK) {
  if (!fs.existsSync(OUT_TS)) {
    console.error(`✗ 缺 ${path.relative(ROOT, OUT_TS)}——先跑 node website/scripts/gen-request-engine-data.mjs`)
    process.exit(1)
  }
  if (fs.readFileSync(OUT_TS, 'utf8') !== ts) {
    console.error('✗ Phylax 产品页数据与 SSOT 不一致（页面数字会谎报）')
    console.error('    修复：node website/scripts/gen-request-engine-data.mjs')
    process.exit(1)
  }
  console.log(`✅ Phylax 产品页数据与 SSOT 一致（判据 ${N.criteria.total} 条）`)
} else {
  fs.mkdirSync(path.dirname(OUT_TS), { recursive: true })
  fs.writeFileSync(OUT_TS, ts)
  console.log(`✅ 已生成 ${path.relative(ROOT, OUT_TS)}（判据 ${N.criteria.total} 条 · ${N.criteria.files} 组）`)
}

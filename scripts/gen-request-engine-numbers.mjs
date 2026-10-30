#!/usr/bin/env node
// scripts/gen-request-engine-numbers.mjs —— ★★★Phylax（请求治理层）产品页的**数字单一事实源**生成器
//
// 【为什么需要（本仓既有纪律：每个数字都可追溯，不手抄）】`/phylax` 产品页要展示
//   判据条数、痛点覆盖、包结构、三态、两条出网通道——这些全是**机器事实**
//   （测试文件里的 `it(` 计数、计划文档里的痛点表、源码目录里的文件清单）。
//   页面若手写数字，代码一动页面就"说谎"（本仓亲历：白皮书三处数字静默漂移、无门禁覆盖）。
//   ⇒ SSOT = `docs/generated/request-engine-numbers.json`；本脚本从**产物**读出；
//     `--check` 供 CI/verify 防漂移。
//
// 【为什么"判据条数"不手写】它是本层最硬的可信度指标。手写一个 172 意味着
//   下次有人删 3 条判据、页面还在吹 172 —— 而**没有任何机制会提醒**。
//   ⇒ 直接数 `tests/request-*.test.ts` 里的 `it(` 才是诚实的。
//
// 用法：node scripts/gen-request-engine-numbers.mjs          # 生成
//       node scripts/gen-request-engine-numbers.mjs --check  # 门禁（漂移 exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs/generated/request-engine-numbers.json')
const CHECK = process.argv.includes('--check')

/** 判据来源：请求库全部判据文件（新增判据文件必须登记——否则页面数字会低报） */
const TEST_FILES = [
  'tests/request-client.test.ts',
  'tests/request-reliability.test.ts',
  'tests/request-security.test.ts',
  'tests/request-tenant.test.ts',
  'tests/request-engineering.test.ts',
  'tests/request-offline-autoflush.test.ts',
  'tests/fetch-pipeline.test.ts',
  'tests/websocket-security-chain.test.ts',
  'tests/request-vue-composables.test.ts',
]

/** 每个判据文件守什么（页面按这个分组展示——比"共 172 条"有信息量） */
const GROUPS = [
  { file: 'tests/request-reliability.test.ts', zh: '可靠性内核', en: 'Reliability kernel', what: '幂等键跨重试稳定 · 未知态三态 · 非幂等不重试 · 真随机抖动 · 断路器状态机 · 离线队列只收幂等 · Retry-After', whatEn: 'stable idempotency keys · tri-state unknown · no retry for non-idempotent · real jitter · breaker state machine · offline queue accepts only idempotent · Retry-After' },
  { file: 'tests/request-security.test.ts', zh: '安全通道', en: 'Security channel', what: '默认黑名单 · header/query/body 三级脱敏 · 规范化串可复算 · 篡改检测 · nonce 真随机 · 签名失败不发送 · 头注入防护', whatEn: 'default denylist · three-level redaction · recomputable canonical string · tamper detection · real-random nonce · no send on signing failure · header injection guard' },
  { file: 'tests/request-tenant.test.ts', zh: '多业务隔离', en: 'Multi-tenant isolation', what: '通配只匹配一级 · 未配不拦 · 闸门排队/幂等释放/取消退出 · 一业务打满不阻塞另一业务 · 审计脱敏', whatEn: 'wildcard matches one level only · no policy means no block · gate queue/idempotent release/cancel exit · one tenant saturating does not block another · audit redaction' },
  { file: 'tests/request-client.test.ts', zh: '门面装配', en: 'Facade assembly', what: '白名单先于网络 · 断路器后续不发 · 三态贯通 · 门面字段不污染 FetchConfig · 凭证托管 · abort ⇒ unknown', whatEn: 'allowlist before network · breaker stops later calls · tri-state carried through · facade fields never pollute FetchConfig · credential custody · abort yields unknown' },
  { file: 'tests/request-engineering.test.ts', zh: '数据获取层', en: 'Data fetching', what: '缓存键含 body · 去重含完整身份 · 真 SWR · 乐观更新回滚', whatEn: 'cache key includes body · dedupe uses full identity · real SWR · optimistic rollback' },
  { file: 'tests/request-offline-autoflush.test.ts', zh: '离线队列驱动线', en: 'Offline queue driver', what: '网络恢复自动重放 · 防重入 · dispose 释放订阅 · 抖动不并发重放', whatEn: 'auto-replay on reconnect · reentrancy guard · dispose releases subscription · network flapping does not replay concurrently' },
  { file: 'tests/fetch-pipeline.test.ts', zh: '管线安全语义', en: 'Pipeline safety', what: '方法门禁（POST 不重试）· 真随机抖动 · 去重身份（多租户不串号）· 拦截器时跳过去重 · 退避可精确断言', whatEn: 'method gate (no POST retry) · real jitter · dedupe identity (no cross-tenant merge) · dedupe skipped with interceptors · exact backoff assertion' },
  { file: 'tests/websocket-security-chain.test.ts', zh: 'WS 与 HTTP 同套策略', en: 'WS shares HTTP policy', what: '域名白名单 · 白名单先于连接 · 审计（开/关/条数，不含正文）· bizId · 配额在关闭时释放 · 幂等', whatEn: 'domain allowlist · allowlist before connect · audit (open/close/counts, no content) · bizId · quota released on close · idempotent' },
  { file: 'tests/request-vue-composables.test.ts', zh: 'Vue 产品层', en: 'Vue product layer', what: '真响应式（watchEffect 触发）· 竞态裁决 · 失败不清空数据 · unknown 不回滚 · useRequest 不自动发', whatEn: 'true reactivity (watchEffect fires) · race adjudication · failure keeps data · unknown not rolled back · useRequest does not auto-fire' },
]

function countIts(rel) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) throw new Error(`判据文件缺失：${rel}（数字 SSOT 硬失败，不静默低报）`)
  const src = fs.readFileSync(abs, 'utf8')
  // ★只数真正的用例声明（`it(` / `it.only(` / `it.skip(`），且必须在行首缩进内
  return (src.match(/^\s+it(?:\.\w+)?\(/gm) ?? []).length
}

/** 痛点表：从计划文档的数表里数行数（20 条痛点 → 已落地的策略面） */
function countPainPoints() {
  const p = path.join(ROOT, 'docs/request-client-plan/01-pain-points.md')
  if (!fs.existsSync(p)) throw new Error('缺 docs/request-client-plan/01-pain-points.md')
  const src = fs.readFileSync(p, 'utf8')
  // 痛点表形如 `| 1 | **重试不看方法与幂等性**…`
  const rows = src.match(/^\|\s*\d+\s*\|/gm) ?? []
  return rows.length
}

/** 包结构（真实文件清单） */
function listPackageFiles(dir, ext = '.ts') {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) throw new Error(`包目录缺失：${dir}`)
  return fs.readdirSync(abs).filter((f) => f.endsWith(ext)).sort()
}

const groups = GROUPS.map((g) => ({ ...g, count: countIts(g.file) }))
const total = groups.reduce((n, g) => n + g.count, 0)

const numbers = {
  note:
    'Phylax（请求治理层）对外数字单一事实源 —— 由 scripts/gen-request-engine-numbers.mjs 从已入库产物读出；'
    + '产品页与文档只读本件，不得手写数字。',
  generatedFrom: {
    criteria: 'tests/{request-*,fetch-pipeline,websocket-security-chain}.test.ts 的 it( 计数',
    painPoints: 'docs/request-client-plan/01-pain-points.md 的痛点表行数',
    packages: 'packages/request/src/*.ts + packages/api/src/request/*.ts',
  },
  version: 1,
  criteria: {
    total,
    files: groups.length,
    groups,
  },
  painPoints: {
    total: countPainPoints(),
    // ★诚实口径：20 条里"由本层给出答案"的是全部 20 条；但 #15 的 WS 部分与 #9 的
    //   身份维度是后续补完的（决策 #1386），这里不区分——页面只说"20 条痛点各有答案"。
    answered: countPainPoints(),
  },
  outcomes: {
    states: ['success', 'failed', 'unknown'],
    // ★核心差异化的那一句：主流库把超时当失败，本层把"判不出来"归入 unknown
    unknownIsNotFailure: true,
  },
  channels: {
    http: true,
    websocket: true,
    note: '两条出网通道共用同一套策略链（白名单 / 审计 / 配额 / bizId）',
  },
  packages: {
    kernel: {
      dir: 'packages/api/src/request',
      files: listPackageFiles('packages/api/src/request'),
      note: '平台中立 · 零 vue 依赖（要能跑小程序逻辑层 / Node）',
    },
    vueLayer: {
      dir: 'packages/request/src',
      files: listPackageFiles('packages/request/src'),
      note: 'Vue 产品层 · vue 为 peerDependency',
    },
  },
  gates: [
    { cmd: 'npx vitest run tests/request-*.test.ts tests/fetch-pipeline.test.ts tests/websocket-security-chain.test.ts', what: '判据' },
    { cmd: 'pnpm test:coupled', what: '内核改动 → 配套断言真跑' },
    { cmd: 'node scripts/check-deps.mjs', what: '依赖声明完整性' },
    { cmd: 'node scripts/check-package-health.js', what: '包可发布形态' },
  ],
}

const json = JSON.stringify(numbers, null, 2) + '\n'

if (CHECK) {
  if (!fs.existsSync(OUT)) { console.error(`✗ 缺 ${path.relative(ROOT, OUT)}——先跑 node scripts/gen-request-engine-numbers.mjs`); process.exit(1) }
  const old = fs.readFileSync(OUT, 'utf8')
  if (old !== json) {
    console.error('✗ Phylax 数字 SSOT 与产物不一致（页面数字会谎报）')
    console.error(`    修复：node scripts/gen-request-engine-numbers.mjs`)
    // 指出差异字段（不打印整份文件）
    try {
      const a = JSON.parse(old); const b = JSON.parse(json)
      if (a.criteria?.total !== b.criteria?.total) console.error(`    criteria.total: ${a.criteria?.total} → ${b.criteria?.total}`)
      if (a.painPoints?.total !== b.painPoints?.total) console.error(`    painPoints.total: ${a.painPoints?.total} → ${b.painPoints?.total}`)
    } catch { /* 旧文件损坏，修复建议已给 */ }
    process.exit(1)
  }
  console.log(`✅ Phylax 数字 SSOT 与产物一致（判据 ${total} 条 / 痛点 ${numbers.painPoints.total} 条 / ${groups.length} 组）`)
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, json)
  console.log(`✅ 已生成 ${path.relative(ROOT, OUT)}`)
  console.log(`   判据 ${total} 条（${groups.length} 组）· 痛点 ${numbers.painPoints.total} 条`)
  for (const g of groups) console.log(`     ${g.count.toString().padStart(3)}  ${g.zh}  ← ${g.file}`)
}

#!/usr/bin/env node
// scripts/check-request-governance-wiring.mjs
// ★★★#1344：**请求治理层的"承诺 ↔ 驱动"门禁**（防"类型有、实现无"这一类缺陷）。
//
// 【为什么必须有这条门禁（本轮实证）】
//   `OfflineQueuePolicy` 的文档写着"恢复后按序重放"，而 `flushOfflineQueue()`
//   **没有任何调用方** —— 断网时入队的请求永久躺在队列里（"离线黑洞"）。
//   这个缺陷：
//     · 单元测试看不见（`OfflineQueue` 自己的测试全绿：构造/入队/去重/淘汰都对）
//     · TypeScript 看不见（类型与 API 都在，编译通过）
//     · 代码评审容易漏（`flushOfflineQueue` 的实现看起来完全正确）
//   只有"逐项去问**谁在调用它**"才暴露。
//   ★本仓反复抓的同一形态："接口存在"从来不是"功能生效"的证据。
//   ⇒ 把它做成门禁：**每项机制都必须有一个可指认的调用点**。
//
// 【判据形态（两项，互补）】
//   ① **有驱动**（`driver`）：该机制的入口函数在 `client.ts` 里**至少被调用一次**（非定义处）。
//      —— 抓"实现了但没人调"。
//   ② **有产出点**（`producer`）：错误码/字段真的在代码里被写过。
//      —— 抓"文档承诺了这个码/状态，但没有任何地方产生它"。
//
// 【为什么用源码静态检查而不是运行时】运行时需要一个能跑全链路（含断网）的环境，
//   而本仓的 CI 没有设备/浏览器；静态检查能在**零环境**下拦住这类漏接。
//   ★它的局限要如实写在下面：它证明"有调用"，不证明"调用发生在正确时机"——
//     后者由各自的 vitest 判据守（见 `WHY_TESTS`）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = 'packages/api/src/request/client.ts'
const RELIABILITY = 'packages/api/src/request/reliability.ts'
const TYPES = 'packages/api/src/request/types.ts'
const QUERY = 'packages/api/src/request/query.ts'

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
  } catch {
    return ''
  }
}

/**
 * 请求治理层的机制清单（**唯一事实来源**）。
 *
 * 每条回答 20 条痛点对照里的一个能力，并声明：
 *   · `promise`  —— 文档/类型里的承诺（人话，报错时打印）
 *   · `driver`   —— 驱动入口在该文件里必须出现的**调用**形态（正则；会排除定义处）
 *   · `tests`    —— 守"时机/语义"的 vitest 判据（静态查不了的部分）
 */
const MECHANISMS = [
  {
    id: 'unknown-state',
    promise: '超时/取消后业务能区分"确定失败"与"结果未知"（支付级可靠性的起点）',
    producer: { file: CLIENT, pattern: /'fetch\.unknown'/g, what: 'fetch.unknown 产出点' },
    tests: 'request-client.test.ts',
  },
  {
    id: 'circuit-breaker',
    promise: '下游挂了要停止打（closed → open → halfOpen）',
    driver: { file: CLIENT, pattern: /breaker\.(allow|onSuccess|onFailure)\(/g, min: 3, what: '断路器三个调用点（准入/成功/失败）' },
    tests: 'request-client.test.ts',
  },
  {
    id: 'idempotency-key',
    promise: '幂等键跨重试**稳定**（每次 attempt 新生成 = 没幂等）',
    producer: { file: CLIENT, pattern: /'Idempotency-Key'/g, what: '幂等键下发抖（作为业务头）' },
    tests: 'request-reliability.test.ts',
  },
  {
    id: 'offline-autoflush',
    promise: '断网时入队，网络恢复后**自动**按序重放',
    driver: { file: CLIENT, pattern: /doFlush\(\)/g, min: 2, what: '重放驱动（手动 flush 之外还要有自动触发）' },
    producer: { file: CLIENT, pattern: /autoFlush === true/g, what: 'autoFlush 的开关判定' },
    tests: 'request-offline-autoflush.test.ts',
  },
  {
    id: 'signing',
    promise: '签名与防重放由 client 统一注入（业务绕不过）',
    driver: { file: CLIENT, pattern: /signRequest\(|makeAntiReplayHeaders\(/g, what: '签名/防重放注入点' },
    tests: 'request-security.test.ts',
  },
  {
    id: 'redact',
    promise: '凭据不落日志（脱敏在**通道层**，不靠调用方自觉）',
    driver: { file: CLIENT, pattern: /redactUrl\(|redactHeaders\(/g, what: '脱敏调用点' },
    tests: 'request-security.test.ts',
  },
  {
    id: 'audit',
    promise: '按 bizId 记录"哪个业务访问了什么"（脱敏后）',
    driver: { file: CLIENT, pattern: /audit\(/g, min: 2, what: '审计上报点' },
    tests: 'request-tenant.test.ts',
  },
  {
    id: 'tenant-allowlist',
    promise: '多业务域名白名单（业务无法通过换 API 绕过 —— 见 #1344 P4 WS 同链）',
    driver: { file: CLIENT, pattern: /checkHost\(/g, what: '域名白名单判定点' },
    tests: 'request-tenant.test.ts',
  },
  {
    id: 'optimistic-rollback',
    promise: '乐观更新内建回滚（回滚失败也不假装成功）',
    driver: { file: QUERY, pattern: /opts\.rollback/g, what: '回滚调用点' },
    tests: 'request-client.test.ts',
  },
]

/** 统计某文件里 pattern 的命中数；★定义处（`function xxx` / `class xxx`）不计入"调用" */
function countCalls(src, pattern) {
  const all = [...src.matchAll(pattern)]
  let calls = 0
  for (const m of all) {
    const at = m.index ?? 0
    // 往前看一行内是否有 `function ` / `const xxx =` 之类定义形态
    const lineStart = src.lastIndexOf('\n', at) + 1
    const before = src.slice(lineStart, at)
    if (/\b(function|class|interface|type)\s+$/.test(before)) continue
    calls++
  }
  return calls
}

const problems = []

for (const m of MECHANISMS) {
  if (m.driver) {
    const src = read(m.driver.file)
    if (src.length === 0) {
      problems.push(`[${m.id}] 找不到文件 ${m.driver.file}（路径变了？本门禁需更新）`)
      continue
    }
    const n = countCalls(src, m.driver.pattern)
    const min = m.driver.min ?? 1
    if (n < min) {
      problems.push(
        `[${m.id}] **承诺无驱动**：${m.promise}\n` +
          `       期望 ${m.driver.file} 里至少 ${min} 处「${m.driver.what}」，实际 ${n} 处。\n` +
          `       ★这是"类型/API 都在、缺最后一根驱动线"的形态（#1344 离线队列就是它）。\n` +
          `       ★若这是有意为之（如"只能手动触发"），把该条从 MECHANISMS 移除并写明理由——` +
          `         不要留着承诺却不驱动。`,
      )
    }
  }

  if (m.producer) {
    const src = read(m.producer.file)
    if (src.length === 0) {
      problems.push(`[${m.id}] 找不到文件 ${m.producer.file}（路径变了？本门禁需更新）`)
      continue
    }
    const n = countCalls(src, m.producer.pattern)
    if (n < 1) {
      problems.push(
        `[${m.id}] **承诺无产出点**：${m.promise}\n` +
          `       期望 ${m.producer.file} 里出现「${m.producer.what}」，实际 0 处。`,
      )
    }
  }

  // ★判据文件必须真实存在（防"表里写了测试名、那个测试早被删/改名"⇒ 静默失去保护）
  if (m.tests) {
    const p = path.join(ROOT, 'tests', m.tests)
    if (!fs.existsSync(p)) {
      problems.push(`[${m.id}] 声明的判据文件不存在：tests/${m.tests}（改名/删除后本表未更新）`)
    }
  }
}

// ★反向检查：types.ts 里声明的 policy 字段，必须在 client.ts 里被**读过**（防"加了选项但没人用"）
const typesSrc = read(TYPES)
const clientSrc = read(CLIENT)
const policyFields = [
  'circuitBreaker',
  'offlineQueue',
  'idempotency',
  'tenant',
  'auth',
  'signing',
  'antiReplay',
  'redact',
  'retry',
  'timeout',
]
for (const f of policyFields) {
  const declared = new RegExp(`^\\s*${f}\\?:`, 'm').test(typesSrc)
  if (!declared) continue // 该字段不在此文件（可能挪走了）⇒ 跳过，不误报
  const used = new RegExp(`options\\.${f}\\b`).test(clientSrc)
  if (!used) {
    problems.push(
      `[policy:${f}] RequestClientOptions.${f} 在 types.ts 里声明了，但 client.ts **从没读过它**。\n` +
        `       ★"加了选项但没接线"= 业务配了也不生效（最坏的假承诺形态）。`,
    )
  }
}

const total = MECHANISMS.length * 2 + policyFields.length
if (problems.length === 0) {
  console.log(
    `✅ 请求治理层接线完整（${MECHANISMS.length} 项机制 · 每项都有可指认的驱动/产出点 · ${policyFields.length} 个 policy 字段都被读过）`,
  )
  console.log('   覆盖：' + MECHANISMS.map((m) => m.id).join(' · '))
  process.exit(0)
}

console.error(`❌ 请求治理层发现 ${problems.length} 个"承诺 ↔ 实现"缺口（共检查 ${total} 项）：\n`)
for (const p of problems) console.error('  ' + p + '\n')
console.error('  正确做法：')
console.error('   ① 补上驱动/产出点（这才是"能力真的生效"）；')
console.error('   ② 或从 MECHANISMS / types.ts 里**删掉那个承诺**（不留假承诺）。')
console.error('   ★不要只改本门禁让它变绿 —— 那等于把"没接线"合法化。')
process.exit(1)

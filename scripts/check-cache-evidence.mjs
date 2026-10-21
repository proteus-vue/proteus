#!/usr/bin/env node
// scripts/check-cache-evidence.mjs —— ★★★HTTP 条件请求缓存的双端真机证据门禁（#1149）
//
// 【为什么需要（与 #1148 同族，但这次是**能力**而非"文件丢了"）】
//   `tests/fetch-cache.test.ts` 跑在 Node 的 undici 上——undici **自己不实现 HTTP 缓存**，
//   所以它只能证明"框架层语义正确"。真机上是另一回事，而且两端**根本不同**：
//     · Android：裸 `HttpURLConnection`（未装 `ResponseCache`）⇒ 平台不缓存，全看框架层；
//     · iOS：`URLSessionConfiguration.default` ⇒ 系统 `URLCache` 会自己发条件请求、
//       **把 304 合成 200**、甚至直接回本地副本 ⇒ 不测就不知道"谁在服务这次请求"。
//   实测（2026-10-21，两端真机）：不做 `bypassPlatformCache` 时 iOS 的
//   `meta.cache.status` 恒为 `miss`（因为框架层永远看不到 304）——这正是本门禁要守的形态。
//
// 【判据（每条都以**服务端记账**闭环，不信客户端自述）】
//   ① 两端证据文件存在且**已入库**
//   ② 新鲜命中：`meta.cache.status='hit'` 且服务端 hits **不增加**（"省了网络"的唯一硬证据）
//   ③ 条件请求：服务端**收到** `If-None-Match`，且 `status=revalidated` + 拿回**同一份 body**
//      （`gen` 不变 ⇒ 真的是 304 复用，不是重新生成）
//   ④ 304 不上浮：业务看到的 `status` 必须是 200
//   ⑤ `no-store` 不缓存（服务端 hits **递增**）
//   ⑥ 零回归：未开框架缓存时 `meta.cache` 不出现，且两次请求都成功
//
// 【★刻意**不**判的（避免假红）】
//   "未开框架缓存时服务端 hits 必须递增"——**iOS 会因系统 `URLCache` 而不递增**（实测）。
//   那是平台既有行为，不是缺陷；它恰恰是"缓存必须收进框架层"的立论证据。
//   ⇒ 只作为**端差异读数**打印（`off_platform_cache_intervened`）。
//
// 【诚实边界】鸿蒙端未接 `bypassPlatformCache` 的宿主消费（RCP 同步往返本就不做条件缓存，
//   只做内部头剔除）⇒ 本门禁只要求**两端**（Android / iOS），不拿做不到的端当判据。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIST_ONLY = process.argv.includes('--list')

/** 有框架层缓存的端（鸿蒙只剔除内部头、不做条件缓存 ⇒ 不进判据） */
const ENDS = [
  { id: 'android', rel: 'hosts/android/results/cache-probe.json', key: 'cache_probe' },
  { id: 'ios', rel: 'hosts/ios/results/cache-probe.json', key: 'cache_probe' },
]

function isTracked(rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const problems = []
const rows = []

for (const { id, rel, key } of ENDS) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    problems.push(`${id}: 缺证据 ${rel}——跑 \`bash hosts/${id}/run-cache-probe.sh\` 生成并提交`)
    rows.push({ id, rel, state: '缺失' })
    continue
  }
  if (!isTracked(rel)) {
    problems.push(`${id}: 证据 ${rel} 存在但未入库（提交后别人/CI 拿不到）——git add -f ${rel}`)
  }
  let d
  try {
    d = JSON.parse(fs.readFileSync(abs, 'utf-8'))
  } catch (e) {
    problems.push(`${id}: ${rel} JSON 解析失败：${e.message}`)
    rows.push({ id, rel, state: '解析失败' })
    continue
  }
  // ★两端载荷键名可能不同（#1148 的教训：Android `probe` / iOS `stream_probe`）
  //   ⇒ 按实际形态取，并在 --list 里打印用的是哪个键（判据读错字段会误报真缺陷）
  let p = d[key] ?? d.cache_probe ?? d.probe
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p)
    } catch {
      p = null
    }
  }
  p = p || {}

  // ② 新鲜命中且**服务端零请求**
  if (p.fresh_hit_ok !== true) problems.push(`${id}: fresh_hit_ok=${p.fresh_hit_ok}（新鲜期未命中缓存）`)
  if (p.fresh_no_network_ok !== true) {
    problems.push(
      `${id}: fresh_no_network_ok=${p.fresh_no_network_ok}` +
        `（hits ${p.fresh_hits_after_first}→${p.fresh_hits_after_second}）——` +
        `命中缓存却仍打了服务器 ⇒ 没有真的省网络`
    )
  }
  if (p.fresh_same_body_ok !== true) problems.push(`${id}: fresh_same_body_ok=${p.fresh_same_body_ok}（命中返回的不是同一份 body）`)

  // ③ 条件请求 + 304 复用
  if (p.etag_if_none_match_ok !== true) {
    problems.push(
      `${id}: etag_if_none_match_ok=${p.etag_if_none_match_ok}` +
        `（服务端收到：${p.etag_conditional_seen || '空'}）——条件头没发出去`
    )
  }
  if (p.etag_revalidated_ok !== true) {
    problems.push(
      `${id}: etag_revalidated_ok=${p.etag_revalidated_ok}` +
        `（实得 ${JSON.stringify(p.etag_second_cache || {})}）——` +
        `若是 miss：平台缓存抢先处理了 304（检查 bypassPlatformCache 通路）`
    )
  }
  if (p.etag_same_body_ok !== true) problems.push(`${id}: etag_same_body_ok=${p.etag_same_body_ok}（304 后拿到的不是缓存体）`)

  // ④ 304 不得上浮给业务
  if (p.etag_status_200_ok !== true) problems.push(`${id}: etag_second_status=${p.etag_second_status}（应为 200；304 泄漏给业务）`)

  // ⑤ no-store 必须不缓存
  if (p.nostore_ok !== true) {
    problems.push(
      `${id}: nostore_ok=${p.nostore_ok}（hits ${p.nostore_hits_after_first}→${p.nostore_hits_after_second}）` +
        `——Cache-Control:no-store 的响应被缓存了`
    )
  }

  // ⑥ 零回归
  if (p.off_meta_has_cache !== false) problems.push(`${id}: 未开缓存却出现 meta.cache（改变了既有形态）`)
  if (p.off_both_ok !== true) problems.push(`${id}: 未开缓存时请求失败（off_both_ok=${p.off_both_ok}）`)
  if (p.ok !== true) problems.push(`${id}: 探针整体 ok=${p.ok}`)

  rows.push({
    id,
    rel,
    state: problems.some((x) => x.startsWith(`${id}:`)) ? '不达标' : '通过',
    key: d[key] !== undefined ? key : 'probe',
    freshHits: `${p.fresh_hits_after_first}→${p.fresh_hits_after_second}`,
    cond: p.etag_conditional_seen || '',
    /** ★端差异读数（**不是判据**）：未开框架缓存时服务端 hits 未增 ⇒ 平台自带缓存在起作用 */
    platformCache: p.off_platform_cache_intervened === true,
  })
}

if (LIST_ONLY) {
  console.log(`HTTP 条件请求缓存双端证据（共 ${rows.length} 端）`)
  for (const r of rows) {
    const extra =
      r.freshHits === undefined
        ? ''
        : ` · 命中时 hits ${r.freshHits} · 条件头「${r.cond}」· 平台缓存介入=${r.platformCache}（键 ${r.key}）`
    console.log(`  ${r.state.padEnd(6)} ${r.id.padEnd(8)} ${r.rel}${extra}`)
  }
  if (problems.length) {
    console.log(`  ⚠ ${problems.length} 条问题（--list 只报告）：`)
    for (const p of problems) console.log(`     · ${p}`)
  }
  process.exit(0)
}

if (problems.length > 0) {
  console.error('✗ HTTP 条件请求缓存双端证据门禁未过：')
  for (const p of problems) console.error(`  · ${p}`)
  process.exit(1)
}
console.log(
  `✅ 条件请求缓存双端证据齐备（${rows
    .map((r) => `${r.id} 命中 hits ${r.freshHits} / 平台缓存介入=${r.platformCache}`)
    .join(' · ')}）`
)

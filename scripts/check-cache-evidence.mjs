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
//   ⑦ ★★★#1150 **RFC 5861 扩展**（证据文件 `stale-probe.json`）：SWR 立即回旧值 +
//      后台校验**真发出**（服务端收到条件头）+ 新值进缓存 + `Age` 头；
//      SWR 窗口=0 不得回 stale；`stale-if-error` 在 5xx 时用旧值兜底；
//      ★并回归"`responseType:json` + 非 JSON 错误体**不得挂起**"（真机抓出的僵尸请求缺陷）。
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

/**
 * ★★★#1150：**RFC 5861 扩展指令**的证据（同一能力族的第二批，与上面的基础缓存并列）。
 * 每个端各一份 `stale-probe.json`。
 */
const STALE_ENDS = [
  { id: 'android', rel: 'hosts/android/results/stale-probe.json', key: 'stale_probe' },
  { id: 'ios', rel: 'hosts/ios/results/stale-probe.json', key: 'stale_probe' },
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

// ── ★★★#1150：RFC 5861 扩展指令（SWR / SIE + 僵尸请求回归）──
const staleRows = []
for (const { id, rel, key } of STALE_ENDS) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    problems.push(`${id}: 缺证据 ${rel}——跑 \`bash hosts/${id}/run-stale-probe.sh\` 生成并提交`)
    staleRows.push({ id, rel, state: '缺失' })
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
    staleRows.push({ id, rel, state: '解析失败' })
    continue
  }
  let p = d[key] ?? d.probe
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p)
    } catch {
      p = null
    }
  }
  p = p || {}

  // ① SWR：立即回旧值（stale）+ 后台校验真发出（条件头为准）+ 新值进缓存 + Age
  if (p.swr_stale_ok !== true) problems.push(`${id}: swr_stale_ok=${p.swr_stale_ok}（SWR 窗口内未返回旧值）`)
  if (p.swr_immediate_ok !== true) {
    problems.push(`${id}: swr_immediate_ok=${p.swr_immediate_ok}（耗时 ${p.swr_second_elapsed_ms}ms）——SWR 没有立即返回，等于白等`)
  }
  if (p.swr_background_sent !== true) problems.push(`${id}: 后台校验未发出（SWR 会退化成"永远返回旧值"）`)
  if (p.swr_background_conditional_ok !== true) {
    problems.push(`${id}: 后台校验不是条件请求（服务端收到：${p.swr_conditional_seen || '空'}）——每次校验都整包回源`)
  }
  if (p.swr_refreshed_ok !== true) problems.push(`${id}: 后台校验结果没进缓存（第三次 ver=${p.swr_third_ver}）`)
  if (p.swr_age_ok !== true) problems.push(`${id}: 缓存生成的响应缺 Age 头（RFC 9111 §5.1 MUST）`)
  // ② 窗口=0 不得回 stale
  if (p.swr_zero_ok !== true) problems.push(`${id}: SWR 窗口=0 却仍返回 stale（实得 ${JSON.stringify(p.swr_zero_second_cache || {})}）`)
  // ③ SIE 兜底
  if (p.sie_rescued_ok !== true) {
    problems.push(`${id}: 源站 5xx 时未用旧值兜底（实得 ${JSON.stringify(p.sie_second_cache || {})}）`)
  }
  if (p.sie_same_body_ok !== true) problems.push(`${id}: SIE 兜底返回的不是同一份旧 body`)
  // ④ ★僵尸请求回归（#1150 真机抓出的真缺陷）
  if (p.sie_plain_503_ok !== true) problems.push(`${id}: 5xx 的 status/body 没能完整回到 JS（status=${p.sie_plain_503_status}）`)
  if (p.sie_json_503_no_hang !== true) {
    problems.push(`${id}: \`responseType:json\` + 非 JSON 错误体**挂起**了（#1150 修过的僵尸请求缺陷回归）`)
  }
  if (p.ok !== true) problems.push(`${id}: stale 探针整体 ok=${p.ok}`)

  staleRows.push({
    id,
    rel,
    state: problems.some((x) => x.startsWith(`${id}:`)) ? '不达标' : '通过',
    swr: p.swr_second_cache?.status ?? '',
    cond: p.swr_conditional_seen || '',
    ver: p.swr_third_ver,
  })
}

if (LIST_ONLY) {
  console.log(`HTTP 条件请求缓存双端证据（基础 ${rows.length} 端 + RFC 5861 扩展 ${staleRows.length} 端）`)
  for (const r of rows) {
    const extra =
      r.freshHits === undefined
        ? ''
        : ` · 命中时 hits ${r.freshHits} · 条件头「${r.cond}」· 平台缓存介入=${r.platformCache}（键 ${r.key}）`
    console.log(`  ${r.state.padEnd(6)} ${r.id.padEnd(8)} ${r.rel}${extra}`)
  }
  for (const r of staleRows) {
    const extra = r.swr === undefined ? '' : ` · SWR=${r.swr} · 条件头「${r.cond}」· 刷新后 ver=${r.ver}`
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
  `✅ 条件请求缓存双端证据齐备（基础：${rows
    .map((r) => `${r.id} 命中 hits ${r.freshHits}/平台缓存介入=${r.platformCache}`)
    .join(' · ')}；RFC 5861：${staleRows.map((r) => `${r.id} SWR=${r.swr} ver=${r.ver}`).join(' · ')}）`
)

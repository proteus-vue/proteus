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

/**
 * ★★★#1151：**持久层（L2）**证据（同一能力族第三批）。
 * 每个端两份：`persist-probe-write.json`（写入阶段）+ `persist-probe.json`（重启后读取阶段）。
 * ★★判据核心：**两个阶段是两个进程**（中间 force-stop / 进程自退）⇒ 内存 LRU 必然消失，
 *   所以"命中"只能来自盘上。配套断言：`loads>0`（读过盘）+ **服务端 hits 不增**（真的省了网络）。
 */
const PERSIST_ENDS = [
  { id: 'android', dir: 'hosts/android/results' },
  { id: 'ios', dir: 'hosts/ios/results' },
]

/**
 * 从报告里取探针载荷。
 * ★两端形态不同（#1148 的教训）：Android 存**对象**、iOS 的 `reportBody()` 存**字符串**（JSON 文本）。
 *   ⇒ 统一在取值处兼容，不要在两个门禁各写一套。
 */
function probeOf(doc, key) {
  let v = doc[key] ?? doc.probe
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  return v && typeof v === 'object' ? v : null
}

// ── ★★★#1151：持久层（两阶段跨进程）──
const persistRows = []
for (const { id, dir } of PERSIST_ENDS) {
  const writeRel = `${dir}/persist-probe-write.json`
  const readRel = `${dir}/persist-probe.json`
  const writeAbs = path.join(ROOT, writeRel)
  const readAbs = path.join(ROOT, readRel)
  if (!fs.existsSync(writeAbs) || !fs.existsSync(readAbs)) {
    problems.push(
      `${id}: 缺持久层证据（需要 ${writeRel} + ${readRel}）——跑 \`bash hosts/${id}/run-persist-probe.sh\``,
    )
    persistRows.push({ id, state: '缺失' })
    continue
  }
  for (const rel of [writeRel, readRel]) {
    if (!isTracked(rel)) problems.push(`${id}: 证据 ${rel} 存在但未入库——git add -f ${rel}`)
  }
  let W = null
  let R = null
  try {
    W = probeOf(JSON.parse(fs.readFileSync(writeAbs, 'utf-8')), 'persist_probe')
    R = probeOf(JSON.parse(fs.readFileSync(readAbs, 'utf-8')), 'persist_probe')
  } catch (e) {
    problems.push(`${id}: 持久层证据解析失败：${e.message}`)
    persistRows.push({ id, state: '解析失败' })
    continue
  }
  if (!W || !R) {
    problems.push(`${id}: 持久层证据里没有 persist_probe 载荷（形态变了？）`)
    persistRows.push({ id, state: '无载荷' })
    continue
  }

  // ① 写入阶段真的写盘了
  if (W.phase !== 'write') problems.push(`${id}: write 阶段报告 phase=${W.phase}（应为 write）`)
  if (W.backend_kind !== 'file') {
    problems.push(
      `${id}: 后端 = ${W.backend_kind}（${W.backend_reason}）——App 端**没有 getStorage**，应为 file`,
    )
  }
  if (W.degraded !== false) problems.push(`${id}: 持久化介质不可用（degraded=${W.degraded}）`)
  if (W.write_persisted_ok !== true) {
    problems.push(`${id}: 写盘未成功（stats=${JSON.stringify(W.persist_stats || {})}）`)
  }
  // ★★★#1152：淘汰必须真的生效（否则持久层无限增长 ⇒ Web/MP 平台配额写满后缓存静默失效，
  //   且会**挤占业务自己的存储**——配额是共享的）。
  const ev = W.evict_stats || {}
  if (W.evict_ok !== true) {
    problems.push(
      `${id}: 持久层**没有任何淘汰**（evicted=${ev.evicted}）——` +
        `磁盘会无限增长；平台配额（Web ~5MB / MP 10MB）写满后缓存静默失效且挤占业务存储`,
    )
  }
  if (W.budget_respected_ok !== true) {
    problems.push(
      `${id}: 持久层字节超出预算（${ev.persistBytes}B > ${W.persist_budget}B）——预算没生效`,
    )
  }
  // ② 重启后命中，且**来自盘上**
  if (R.phase !== 'read') problems.push(`${id}: read 阶段报告 phase=${R.phase}（应为 read）`)
  if (R.read_hit_ok !== true) problems.push(`${id}: 重启后**未命中**（cache=${JSON.stringify(R.read_cache || {})}）`)
  if (R.read_from_disk_ok !== true) {
    problems.push(`${id}: 命中但不是来自盘上（loads=${(R.persist_stats || {}).loads}）——装置可能没真重启`)
  }
  // ③ 体一致
  if (R.read_gen !== W.write_gen) problems.push(`${id}: 重启后体内容变了（gen ${W.write_gen} → ${R.read_gen}）`)
  // ④ ★防"读到旧残留"：年龄必须落在"本次运行"的量级（跨天残留是小时级）
  const ageMs = Number((R.read_cache || {}).ageMs ?? -1)
  if (!(ageMs >= 0 && ageMs < 300000)) {
    problems.push(
      `${id}: 命中的条目年龄 ${ageMs}ms 超出本次运行量级（>5min）——可能是**上一次残留**（清盘没生效）`,
    )
  }
  if (R.ok !== true) problems.push(`${id}: read 阶段整体 ok=${R.ok}`)

  /**
   * ★★**服务端 hits 不增**这条无法在本门禁复算（它需要 runner 运行时的服务端记账，
   *   而门禁只读静态产物）⇒ 在 runner 里断言，本门禁做**间接守**：
   *   要求 runner 确实把这条写成了判据（防止有人为了让结果变绿而删掉它）。
   *   ★这是"判据的判据"——本仓反复吃"删掉断言就静默通过"的亏（#1145 的早退即此形态）。
   */
  const runnerRel = `hosts/${id}/run-persist-probe.sh`
  const runnerAbs = path.join(ROOT, runnerRel)
  if (fs.existsSync(runnerAbs)) {
    const src = fs.readFileSync(runnerAbs, 'utf-8')
    if (!/hitsRead === hitsWrite/.test(src)) {
      problems.push(
        `${id}: ${runnerRel} 缺少「服务端 hits 不增」断言（hitsRead === hitsWrite）——` +
          `那是"重启后真省了网络"的唯一硬证据，删掉它本判据就只剩客户端自述`,
      )
    }
  } else {
    problems.push(`${id}: 缺 runner ${runnerRel}`)
  }

  persistRows.push({
    id,
    state: problems.some((x) => x.startsWith(`${id}:`)) ? '不达标' : '通过',
    backend: W.backend_kind,
    gen: W.write_gen,
    ageMs,
    loads: (R.persist_stats || {}).loads,
  })
}

/**
 * ★★★#1153：**TLS pinning** 证据（同一能力族第四批，与缓存无直接关系但同属网络能力矩阵）。
 * 每个端一份 `tls-probe.json`。
 * ★判据核心（缺一条都可能是"看起来钉了"）：
 *   ① pin **命中** ⇒ 成功（否则 pin 根本没用上）
 *   ② pin **未命中** ⇒ `fetch.tlsError`（★不是 failed/aborted——业务据此判断"该查 pin"）
 *   ③ **叠加模式真的叠加**：pin 对但不开 pinOnly ⇒ 自签被**系统信任**拒（⇒ 仍是 failed）
 *   ④ 无 pin ⇒ 自签被拒（基线）
 *   ⑤ 宿主记账显示 challenge 真的发生过（否则上面的"成功"无法归因）
 */
const TLS_ENDS = [
  { id: 'android', rel: 'hosts/android/results/tls-probe.json', key: 'tls_probe' },
  { id: 'ios', rel: 'hosts/ios/results/tls-probe.json', key: 'tls_probe' },
]

const tlsRows = []
for (const { id, rel, key } of TLS_ENDS) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    problems.push(`${id}: 缺证据 ${rel}——跑 \`bash hosts/${id}/run-tls-probe.sh\` 生成并提交`)
    tlsRows.push({ id, rel, state: '缺失' })
    continue
  }
  if (!isTracked(rel)) problems.push(`${id}: 证据 ${rel} 存在但未入库——git add -f ${rel}`)
  let p = null
  try {
    p = probeOf(JSON.parse(fs.readFileSync(abs, 'utf-8')), key)
  } catch (e) {
    problems.push(`${id}: ${rel} 解析失败：${e.message}`)
    tlsRows.push({ id, rel, state: '解析失败' })
    continue
  }
  if (!p) {
    problems.push(`${id}: ${rel} 里没有 ${key} 载荷（形态变了？）`)
    tlsRows.push({ id, rel, state: '无载荷' })
    continue
  }

  if (p.hit_secure !== true) problems.push(`${id}: 判据没用 https（明文测不了 pinning）`)
  if (p.hit_ok !== true) problems.push(`${id}: pin **命中**却请求失败（code=${p.hit_code}）——pin 没用上`)
  if (p.mismatch_is_tls_error !== true) {
    problems.push(
      `${id}: pin **未命中**没有报 \`fetch.tlsError\`（实得 ${p.mismatch_code || '成功'}）——` +
        `业务无法区分"证书不对"与"网络不好"`,
    )
  }
  if (p.stacked_failed !== true) {
    problems.push(
      `${id}: **叠加模式没做**（pin 对 + 不开 pinOnly 竟然成功了）——` +
        `那样 pin 就成了"替代系统信任"，安全性反而下降`,
    )
  }
  if (p.nopin_failed !== true) problems.push(`${id}: 无 pin 时自签没被拒（基线失效，装置可能放过了自签）`)
  if (p.b_ok !== true) problems.push(`${id}: B 服务不可达 ⇒ ②"未命中"可能是"连不上"的假通过`)
  const stats = p.host_tls_stats || {}
  if (Number(stats.challenges ?? 0) <= 0) {
    problems.push(`${id}: 宿主记账 challenges=${stats.challenges}——challenge 从未发生，上面的结果无法归因到 pinning`)
  }

  tlsRows.push({
    id,
    rel,
    state: problems.some((x) => x.startsWith(`${id}:`)) ? '不达标' : '通过',
    challenges: stats.challenges,
    rejected: stats.rejected,
    accepted: stats.accepted,
  })
}

/**
 * ★★★#1155：**传输层事实取证**证据（HTTP/2 协商 + 连接复用）。
 *
 * 【这条为什么重要（它决定了一项 P1 工作的必要性）】
 *   矩阵 P1 写着「HTTP/2 + 连接池：需 Android 引入 OkHttp（APK +Δ）」。
 *   ⇒ 实测就是为了回答：**为这两项把 APK 涨 1MB 值不值**。
 *   已取证（KLE-AL00U / API 37）：
 *     · **连接复用：已工作**（`requests > connections`；明文与 TLS 都复用）——
 *       而 #1154 的 pinning 首版**破坏了它**（每次请求新建 SSLContext ⇒ 连接池分桶失效），
 *       本轮修掉（缓存 factory）并有静态判据守着。
 *     · **HTTP/2：未协商**（设备侧全 `http/1.1`；AOSP 的 `HttpURLConnection` 默认不开 h2）
 *       ⇒ 这一项**确实**需要换栈（OkHttp + `Protocol.HTTP_2`），属独立大单。
 *   ⇒ 本段只断言**已取证到的形态**，不把"h2 未协商"判成红（那是**结论**不是缺陷）。
 */
const TRANSPORT_ENDS = [
  { id: 'android', rel: 'hosts/android/results/transport-probe.json', key: 'transport_probe' },
  { id: 'ios', rel: 'hosts/ios/results/transport-probe.json', key: 'transport_probe' },
  /**
   * ★★★#1156：**鸿蒙（第三端）**——`#1155` 曾把它登记为"鸿蒙端未跑"，真实原因是
   *   `hdc` 不在 PATH 被误判成无设备（设备一直连着）。本轮补齐，并在此之前抓出真缺陷：
   *   生产路径每请求建/关 RCP session + 用同步 `HMS_Rcp_FetchSync` ⇒ **零连接复用**
   *   （真机 `3 请求 / 3 TCP`）；改用异步 `HMS_Rcp_Fetch` + 进程级 session 后 `3 请求 / 1 TCP`。
   * ★形态差异（如实）：鸿蒙证据是**平铺**的（`server_requests` 在顶层，不是 `transport_probe` 子对象），
   *   因为它的 runner 把服务端记账直接并进同一份 JSON；`probeOf` 找不到 `transport_probe` 时
   *   会回落到文档本身（见下方 `p = probeOf(...) ?? doc`）。`http2_ok` 为 `null`（本轮未测）。
   */
  { id: 'harmony', rel: 'hosts/harmony/results/transport-probe.json', key: 'transport_probe' },
]

const transportRows = []
for (const { id, rel, key } of TRANSPORT_ENDS) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    problems.push(`${id}: 缺证据 ${rel}——跑 \`bash hosts/${id}/run-transport-probe.sh\` 生成并提交`)
    transportRows.push({ id, rel, state: '缺失' })
    continue
  }
  if (!isTracked(rel)) problems.push(`${id}: 证据 ${rel} 存在但未入库——git add -f ${rel}`)
  let doc = null
  let p = null
  try {
    doc = JSON.parse(fs.readFileSync(abs, 'utf-8'))
    // ★#1156：鸿蒙证据是**平铺**的（runner 把服务端记账并进同一份 JSON）⇒ 找不到子对象就用文档本身
    p = probeOf(doc, key) ?? doc
  } catch (e) {
    problems.push(`${id}: ${rel} 解析失败：${e.message}`)
    transportRows.push({ id, rel, state: '解析失败' })
    continue
  }
  if (!p) {
    problems.push(`${id}: ${rel} 里没有 ${key} 载荷（形态变了？）`)
    transportRows.push({ id, rel, state: '无载荷' })
    continue
  }

  // ① 请求必须真的成功（否则"连接数"是在测连不上）
  if (p.first_ok !== true) problems.push(`${id}: 传输层探针首轮请求失败（${p.req_error || '?'}）`)
  // ② ★**连接复用必须成立**（这是 #1154/#1156 两次实测抓出的性能回归，必须守住）
  if (p.conn_reused_ok !== true) {
    // ★按端给出**可执行的**归因线索（同一个现象，两端的成因完全不同——写混了会把人带错方向）
    const hint =
      id === 'harmony'
        ? '鸿蒙的成因是 **RCP session 生灭 + 取数 API**：`HMS_Rcp_CreateSession/FetchSync` 组合' +
          '每条请求都新建底层连接（真机实测 3 请求/3 TCP）。修法：session 进程级复用 + 改用**异步** ' +
          '`HMS_Rcp_Fetch`（`proteus_http.h`）；静态判据 `tests/harmony-session-reuse.test.ts`'
        : '若刚改过 pinning，检查是否每次请求都新建 SSLContext（连接池按 factory 分桶；' +
          '静态判据 `tests/tls-pinning-reuse.test.ts`）'
    problems.push(`${id}: **连接未被复用**（请求 ${p.server_requests} / TCP ${p.server_connections}）——${hint}`)
  }
  /**
   * ③ ★★★**证据必须由修正后的计量产出**（否则旧口径的绿色会冒充新结论）。
   *
   * 【为什么这条必须有（本轮实测两次假判，都是计量而不是被测对象的问题）】
   *   a) 首版把控制端点（`/__pin` 走 Node h2）算进样本 ⇒ Android 明明全 http/1.1 却判"已协商 h2"（假绿）；
   *   b) 首版连接身份用 `req.socket` ⇒ h2 兼容层**每流一个 socket 包装** ⇒ 同一条 TCP 连接被数成 3 条
   *      （iOS 的 `perConnection` 出现 c2/c3/c4 各 1 次，而 `connections` 只计到 2 ⇒ "3 > 2" 判成复用 = 巧合）。
   *   现口径：按通道分账（`channels.tls` / `channels.plain`）+ 连接身份 = **对端 socket**。
   *   ⇒ 证据里必须出现 `channels`，且所选通道的 `connections` 要对得上 `conns` 的键数；
   *     没有这两个字段 ⇒ 该证据是旧装置产出（重跑 `bash hosts/<端>/run-transport-probe.sh`）。
   *
   * ★#1156：**通道按端选**——Android/iOS 打 TLS 通道（自签 + `tlsPinOnly`，顺带验 pinning），
   *   鸿蒙打**明文**通道（宿主未接自定义 CA ⇒ 无法信任自签）。判据本身与通道无关：
   *   "请求数 vs 连接数"在两个通道上是同一个性质。
   */
  const channels = (p.server_stats || {}).channels
  const chanTag = id === 'harmony' ? 'plain' : 'tls'
  const ch = (channels || {})[chanTag]
  if (!channels || !ch) {
    problems.push(
      `${id}: 证据缺少按通道的记账（\`server_stats.channels.${chanTag}\`）——**旧装置产出**，` +
        `判据已修正（连接身份 = 对端 socket、只算 /__whoami）⇒ 必须重跑 \`bash hosts/${id}/run-transport-probe.sh\``,
    )
  } else {
    const connKeys = Object.keys(ch.conns || {}).length
    if (connKeys !== Number(ch.connections)) {
      problems.push(
        `${id}: 记账自相矛盾——\`connections=${ch.connections}\` 但 \`conns\` 有 ${connKeys} 个键` +
          `（连接身份必须按对端 socket 聚合：h2 下同一连接的所有流共享它）`,
      )
    }
    if (Number(ch.requests) !== Number(p.server_requests)) {
      problems.push(
        `${id}: 顶层 \`server_requests\`(${p.server_requests}) 与通道记账(${ch.requests}) 不一致——` +
          `说明证据来自"跨通道混算"的旧口径`,
      )
    }
  }
  // ④ 明文基线也必须复用（否则"不复用"是本端/装置问题，不是 pinning）
  /**
   * ④ 明文基线 = **端差异读数，不判红**（★注意：与 ③ 的"证据形态"是两件事）。
   *
   * 【为什么是读数】（真机首轮 5 请求/3 连接、再跑 3/3 —— 而修正计量后两轮都是 3/1）
   *   `HttpURLConnection` 的连接池会因"空闲超时 / keep-alive 过期 / 请求间隔"新建连接
   *   ⇒ 把基线当硬断言会产生**间歇性假红**。真正的判据是 TLS 通道也必须复用（②）：
   *     pinning 若每次新建 SSLContext，那条会在**同一轮**就红（这正是 #1154 首版被抓住的方式）。
   *   ★另一层保险是静态判据 `tests/tls-pinning-reuse.test.ts`（缓存入口唯一 + 命中即返回）。
   */
  if (p.plain_reused_ok === false) {
    console.log(
      `  ℹ ${id}: 明文基线本轮未复用（${p.plain_requests} 请求 / ${p.plain_connections} 连接）` +
        `——连接池空闲超时属正常波动，不作判据（TLS 通道的复用才是关键）`,
    )
  }
  /**
   * ⑥ ★★★#1158：**业务侧 `meta.transport` 真的拿到了读数**（"取证 → 产品化"的判据）。
   *
   * 【为什么必须有这一条】#1155/#1156 证明了"宿主能测"（服务端记账 + 探针直连），
   *   但那只是**取证**。`meta.transport` 要穿五段链路才到业务手里
   *   （宿主 → 线格式 → `settleFromFrame` → `appHttpRequest` → **`runFetch`** → 管线），
   *   任何一段漏了业务都拿不到——而**底层全绿**（本仓 #1122 栽过同一形态）。
   *   ⇒ 断言证据里的 `transport_first` / `transport_last` **至少有一轮非空**。
   *
   * ★两端可得性不同，**不要求字段齐**（那是各平台能力差异，不是缺陷）：
   *     iOS 全字段 · Android 只有 proto+ttfbMs · 鸿蒙只有四个毫秒项（无 proto/reused）。
   *   只要求"有对象且至少一个键"。
   */
  const tpFirst = p.transport_first
  const tpLast = p.transport_last
  const tpAny = tpLast ?? tpFirst
  const tpKeys = tpAny && typeof tpAny === 'object' ? Object.keys(tpAny) : []
  if (tpKeys.length === 0) {
    problems.push(
      `${id}: **业务侧 \`meta.transport\` 为空**（证据里 transport_first/last 都是 null）——` +
        `宿主能测 ≠ 业务拿得到：查五段链路（host 帧 → 线格式 Transport=22 → settleFromFrame → ` +
        `appHttpRequest → runFetch → 管线）。★不要用"该端不支持"解释——先看 \`host_stats.metrics\``,
    )
  }
  // ⑤ HTTP/2 只作**读数**（未协商是已取证结论，不是缺陷；换栈属独立大单）
  //   ★#1156：鸿蒙 `http2_ok === null` = **本轮未测**（明文端口 + 宿主未接 CA/pinning）——
  //     必须与"未协商"分开显示：`null` 是"没测"，`false` 是"测了但没有"。混为一谈会把
  //     "未知"当"已知不足"，也会让后续有了 pinning 之后仍显示旧的错误结论。
  const protos = p.server_protocols || {}
  const http2Text =
    p.http2_ok === true ? '已协商' : p.http2_ok === null || p.http2_ok === undefined ? '未测' : '未协商（需换栈）'
  transportRows.push({
    id,
    rel,
    state: problems.some((x) => x.startsWith(`${id}:`)) ? '不达标' : '通过',
    reused: p.conn_reused_ok,
    httpsConns: p.server_connections,
    httpsReqs: p.server_requests,
    http2: http2Text,
    protos,
    // ★#1158：业务侧拿到的读数（键名列表；空 = 没拿到）
    tpKeys,
  })
}

if (LIST_ONLY) {
  console.log(
    `HTTP 网络能力双端证据（基础 ${rows.length} 端 + RFC 5861 扩展 ${staleRows.length} 端 + 持久层 ${persistRows.length} 端 + TLS pinning ${tlsRows.length} 端 + 传输层 ${transportRows.length} 端）`,
  )
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
  for (const r of persistRows) {
    const extra =
      r.backend === undefined
        ? ''
        : ` · 后端=${r.backend} · 重启后命中（loads=${r.loads} · ageMs=${r.ageMs} · gen=${r.gen}）`
    console.log(`  ${r.state.padEnd(6)} ${r.id.padEnd(8)} hosts/${r.id}/results/persist-probe*.json${extra}`)
  }
  for (const r of tlsRows) {
    const extra =
      r.challenges === undefined
        ? ''
        : ` · challenge ${r.challenges} 次（accept ${r.accepted} / reject ${r.rejected}）`
    console.log(`  ${r.state.padEnd(6)} ${r.id.padEnd(8)} hosts/${r.id}/results/tls-probe.json${extra}`)
  }
  for (const r of transportRows) {
    const extra =
      r.reused === undefined
        ? ''
        : ` · 复用=${r.reused}（HTTPS ${r.httpsReqs} 请求 / ${r.httpsConns} 连接）· HTTP/2=${r.http2}`
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

/* ══════════ ★★★#1160：请求体证据（整包路径 POST/PUT 真的把体发出去） ══════════
 * 【为什么必须进 verify 链（不接门禁就静默腐烂）】#1160 第一版 `perform()` 漏了 `cfg.body`
 *   ⇒ Android 所有带 `data` 的 POST/PUT **静默发空体**，而当时 9 组真机回归全绿
 *   （探针全是 GET/上传/流式/落盘，**没有一条覆盖"整包路径 + 请求体"**）。
 *   `run-body-probe.sh` 补上了这个洞；但证据不接门禁 ⇒ 下一次改动又没人看。
 * 【判据】服务端收到的字节数必须**等于 JS 期望长度**（空体是 0 ⇒ 不等 ⇒ 红）；
 *   Content-Type 必须与调用方给的值**全等**（用 includes 会放过"charset 被抹掉"）。
 */
let bodyRow = { state: '未检查' }
{
  const rel = 'hosts/android/results/body-probe.json'
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    problems.push(`android: 缺请求体证据 ${rel}——跑 \`bash hosts/android/run-body-probe.sh\` 生成并提交`)
    bodyRow = { state: '缺失' }
  } else if (!isTracked(rel)) {
    problems.push(`android: 请求体证据 ${rel} 存在但未入库——git add -f ${rel}`)
    bodyRow = { state: '未入库' }
  } else {
    let p = null
    try { p = (JSON.parse(fs.readFileSync(abs, 'utf8')) || {}).probe || null } catch { p = null }
    if (!p) {
      problems.push(`android: ${rel} 解析失败或没有 probe 段（装置问题？）`)
      bodyRow = { state: '解析失败' }
    } else {
      const lenOk = p.post_len_ok === true && Number(p.post_len_server) === Number(p.post_len_expected)
      const notEmpty = p.post_not_empty === true && Number(p.post_len_server) > 0
      const ctOk = p.post_ct_ok === true
      const getOk = p.get_ok === true
      const putOk = p.put_len_ok === true
      // ★★★第三轮：**无体请求的显式 Content-Type 不得丢**（把 CT 一律搬进 cfg.contentType
      //   会让 GET/DELETE/空体 POST 的头整条消失，与旧实现及 iOS/鸿蒙不一致）
      const nobodyOk = p.nobody_no_body === true && p.nobody_ct_ok === true
      if (!lenOk) problems.push(`android: ★POST 体长不符（服务端 ${p.post_len_server} ≠ 期望 ${p.post_len_expected}）——整包路径可能又没装配 body`)
      if (!notEmpty) problems.push('android: ★POST 体为空——请求体没发出去（P0 形态）')
      if (!ctOk) problems.push(`android: ★Content-Type 与调用方给的不一致（实得 "${p.post_content_type}"，期望 "${p.post_content_type_expected}"）——encodeBody 的推导值可能覆盖了业务头`)
      if (!getOk) problems.push('android: ★GET（无体）失败——体可能被错挂到 GET（OkHttp 会抛 method GET must not have a request body）')
      if (!putOk) problems.push('android: ★PUT 带体失败（防"只对 POST 特判"）')
      if (!nobodyOk) problems.push(`android: ★无体请求的显式 Content-Type 丢了（实得 "${p.nobody_ct_server}"，期望 "${p.nobody_ct_expected}"）——无体时 CT 必须留在 headers 里发出`)
      bodyRow = {
        state: lenOk && notEmpty && ctOk && getOk && putOk && nobodyOk ? 'ok' : '不达标',
        len: p.post_len_server,
        ct: p.post_content_type,
        nobodyCt: p.nobody_ct_server,
      }
    }
  }
}

if (problems.length > 0) {
  console.error('✗ HTTP 条件请求缓存双端证据门禁未过（含请求体证据）：')
  for (const p of problems) console.error(`  · ${p}`)
  process.exit(1)
}
console.log(
  `✅ 条件请求缓存双端证据齐备（基础：${rows
    .map((r) => `${r.id} 命中 hits ${r.freshHits}/平台缓存介入=${r.platformCache}`)
    .join(' · ')}；RFC 5861：${staleRows.map((r) => `${r.id} SWR=${r.swr} ver=${r.ver}`).join(' · ')}；` +
    `持久层：${persistRows.map((r) => `${r.id} ${r.backend} 重启命中 ageMs=${r.ageMs}`).join(' · ')}；` +
    // ★#1156：传输层的三端读数也要出现在**成功摘要**里——否则"绿色"看不出鸿蒙是否真跑了
    `传输层：${transportRows.map((r) => `${r.id} 复用=${r.reused}（${r.httpsReqs}/${r.httpsConns}）h2=${r.http2}`).join(' · ')}；` +
    // ★#1160：请求体证据（整包路径 POST/PUT 真的发出去 & Content-Type 不被推导值覆盖 & 无体时 CT 不丢）
    `请求体：android ${bodyRow.state}（POST ${bodyRow.len}B · ct=${bodyRow.ct} · 无体 ct=${bodyRow.nobodyCt}））`,
)

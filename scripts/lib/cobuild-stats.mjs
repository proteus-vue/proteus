// scripts/lib/cobuild-stats.mjs —— 共建台账统计的**唯一实现**（verification_breakdown / 收口分桶）
//
// 为什么单列（2026-11-12）：
//   台账里的 `verification_breakdown` 长期是**手写快照**，没有任何门禁校验它与 entries 一致
//   ⇒ 实测漂移：条目早已 `unverified:2 / n_a:1`，快照仍写着 `unverified:1 / n_a:2`（统计时间停在 09-20）。
//   手写派生数据 = 迟早错的派生数据。改为**从 entries 重算**，并让 `ledger-check` 与
//   `sync-cobuild` 共用这一份实现——两处各写一份必然再次漂移。

/**
 * 收口分桶。**判据与 scripts/ledger-check.mjs 的 reconcile() 完全一致**（顺序也一致，
 * 因为 status=partial 优先于 verification 判断）：
 *   by_design → open → partial → fixed+worktree(未发布) → fixed+未通过验证 → resolved(收口)
 */
export function bucketEntries (entries) {
  const b = { resolved: [], unreleased: [], unverified: [], partial: [], open: [], by_design: [] }
  for (const e of entries) {
    if (e.status === 'by_design') b.by_design.push(e)
    else if (e.status === 'open') b.open.push(e)
    else if (e.status === 'partial') b.partial.push(e)
    else if (e.status === 'fixed' && e.fix_state === 'worktree') b.unreleased.push(e)
    else if (e.status === 'fixed' && e.verification !== 'passed') b.unverified.push(e)
    else b.resolved.push(e)
  }
  return b
}

/**
 * 重算 `verification_breakdown`。
 *
 * ★`by_verified_by` 的统计口径必须写清楚，否则同名字段两边算法不同（本次漂移的一半原因）：
 *   只统计 **verification=passed** 的条目——「谁验的」只在「验过了」的前提下有意义；
 *   passed 但没标 verified_by 的计入 `(未标注)`（这就是规范里那条告警的准确含义）。
 */
export function computeBreakdown (ledger, { date } = {}) {
  const entries = ledger.entries ?? []
  const b = bucketEntries(entries)
  const byVerification = {}
  for (const e of entries) byVerification[e.verification ?? '(空)'] = (byVerification[e.verification ?? '(空)'] ?? 0) + 1
  const byStatus = {}
  for (const e of entries) byStatus[e.status ?? '(空)'] = (byStatus[e.status ?? '(空)'] ?? 0) + 1
  const passed = entries.filter((e) => e.verification === 'passed')
  const byVerifiedBy = { external: 0, framework: 0, '(未标注)': 0 }
  for (const e of passed) {
    const k = e.verified_by === 'external' || e.verified_by === 'framework' ? e.verified_by : '(未标注)'
    byVerifiedBy[k] += 1
  }
  return {
    说明: '按 verification 字段统计（external=使用方独立复测通过；framework=框架自证；其他见字段说明）',
    统计时间: date ?? new Date().toISOString().slice(0, 10),
    total: entries.length,
    by_verification: byVerification,
    by_verified_by: byVerifiedBy,
    by_status: byStatus,
    resolved: b.resolved.length,
    真实收口率: entries.length ? Math.round((b.resolved.length / entries.length) * 100) : 0,
  }
}

/**
 * 比较「存储的快照」与「重算结果」是否实质一致。
 * `说明` / `统计时间` 属元信息，不参与比对（时间戳不同不代表数据错）。
 * 返回差异字段名数组（空 = 一致）。
 */
export function diffBreakdown (stored, computed) {
  if (!stored || typeof stored !== 'object') return ['(缺失)']
  const keys = ['total', 'by_verification', 'by_verified_by', 'by_status']
  const diffs = []
  for (const k of keys) {
    if (JSON.stringify(stored[k] ?? null) !== JSON.stringify(computed[k] ?? null)) diffs.push(k)
  }
  return diffs
}

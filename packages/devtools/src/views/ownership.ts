// packages/devtools/src/views/ownership.ts
// ★G-43 B4 所有权面板视图（第十视图）：概要 + 四类告警（🔴 无主/⚠️ 泄漏路径/🟡 长期借用/跨页强引用）
//   + 资源树（owner 分组 + 📍 源码位置）+ alloc/drop 时间线（未配对高亮）
//   数据源：collectOwnershipData（本地） / Proteus.ownership（远程）——JSON-safe OwnershipViewData
import type { OwnershipViewData } from '../ownership-info'

export type { OwnershipViewData }

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
  return n + ' B'
}

function card(parent: HTMLElement, cls: string, title: string): HTMLElement {
  const el = document.createElement('div')
  el.className = cls
  const t = document.createElement('div')
  t.className = 'pd-own-card-title'
  t.textContent = title
  el.appendChild(t)
  parent.appendChild(el)
  return el
}

/** ★G-43 B4：所有权视图渲染（纯数据 → DOM；空数据 → 空态提示） */
export function renderOwnership(container: HTMLElement, data: OwnershipViewData | undefined): void {
  container.replaceChildren()
  container.classList.add('pd-ownership')

  if (!data || !data.summary) {
    const empty = document.createElement('div')
    empty.className = 'pd-empty'
    empty.textContent = '暂无所有权数据（installProteusDevtools({ ownership: true }) 启用，或业务在创建 OwnershipGraph 时挂接）'
    container.appendChild(empty)
    return
  }

  // —— 概要卡 ——
  const summary = card(container, 'pd-own-summary', '所有权概要')
  const stats = document.createElement('div')
  stats.className = 'pd-own-stats'
  stats.textContent = `${data.summary.alive} alive / ${data.summary.total} total · ${fmtBytes(data.summary.bytesAlive)}`
  summary.appendChild(stats)
  const types = Object.entries(data.summary.byType)
  if (types.length > 0) {
    const typeLine = document.createElement('div')
    typeLine.className = 'pd-own-types'
    typeLine.textContent = types.map(([type, c]) => `${type}: ${c.alive}/${c.allocated}`).join(' · ')
    summary.appendChild(typeLine)
  }

  // —— 告警区（四类检测一次呈现；空则 ✅）——
  const d = data.diagnosis
  const alerts = card(container, 'pd-own-alerts', '检测')
  const alertCount = d.orphans.length + d.leaks.length + d.longBorrows.length + d.crossPageRefs.length
  if (alertCount === 0) {
    const ok = document.createElement('div')
    ok.className = 'pd-own-ok'
    ok.textContent = '✅ 无异常（无无主资源 / 泄漏路径 / 长期借用 / 跨页强引用）'
    alerts.appendChild(ok)
  } else {
    for (const o of d.orphans) {
      const row = document.createElement('div')
      row.className = 'pd-own-alert pd-own-alert-orphan'
      row.textContent = `🔴 无主资源 ${o.id}（${o.type}，${fmtBytes(o.byteSize)}）${o.sourceLocation ? '📍 ' + o.sourceLocation : ''}——必然泄漏（框架 bug 或未登记）`
      alerts.appendChild(row)
    }
    for (const l of d.leaks) {
      const row = document.createElement('div')
      row.className = 'pd-own-alert pd-own-alert-leak'
      row.textContent = `⚠️ 泄漏路径 ${l.resourceId}（${l.type}，${fmtBytes(l.byteSize)}）${l.sourceLocation ? '📍 ' + l.sourceLocation : ''}`
      alerts.appendChild(row)
      for (const hop of l.referenceChain) {
        const chain = document.createElement('div')
        chain.className = 'pd-own-chain'
        chain.textContent = '    ' + hop
        alerts.appendChild(chain)
      }
    }
    for (const b of d.longBorrows) {
      const row = document.createElement('div')
      row.className = 'pd-own-alert pd-own-alert-longborrow'
      row.textContent = `🟡 长期借用 ${b.resourceId} ← borrowed by ${b.borrowedBy}（owner ${b.owner ?? '无主'}）`
      alerts.appendChild(row)
    }
    for (const c of d.crossPageRefs) {
      const row = document.createElement('div')
      row.className = 'pd-own-alert pd-own-alert-crosspage'
      row.textContent = `⚠️ 跨页强引用 ${c.resourceId}（owner ${c.owner ?? '无主'}）← 强持有 by ${c.heldBy}——应 transferTo/weak`
      alerts.appendChild(row)
    }
  }

  // —— 资源树（owner 分组）——
  const resCard = card(container, 'pd-own-resources', '资源（按 owner）')
  if (data.resources.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'pd-empty'
    empty.textContent = '无存活资源'
    resCard.appendChild(empty)
  }
  for (const group of data.resources) {
    const ownerRow = document.createElement('div')
    ownerRow.className = 'pd-own-owner'
    const bytes = group.items.reduce((s, i) => s + i.byteSize, 0)
    ownerRow.textContent = `▼ ${group.owner}（${group.items.length} 资源，${fmtBytes(bytes)}）`
    resCard.appendChild(ownerRow)
    for (const item of group.items) {
      const row = document.createElement('div')
      row.className = 'pd-own-resource'
      const stateMark = group.owner === '（无主）' ? '🔴' : '🟢'
      const borrowInfo = item.borrowedBy.length > 0 ? ` ← 🟡 ${item.borrowedBy.join(', ')}` : ''
      row.textContent = `  ${stateMark} ${item.type} ${fmtBytes(item.byteSize)}${item.sourceLocation ? ' 📍 ' + item.sourceLocation : ''}${borrowInfo}`
      resCard.appendChild(row)
    }
  }

  // —— 时间线（alloc ↑ / drop ↓ 配对 + 未配对高亮）——
  const tlCard = card(container, 'pd-own-timeline', `时间线${data.timeline.truncated ? `（近 ${data.timeline.events.length} 条）` : ''}`)
  if (data.timeline.events.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'pd-empty'
    empty.textContent = '暂无 alloc/drop 记录'
    tlCard.appendChild(empty)
  }
  for (const e of data.timeline.events) {
    const row = document.createElement('div')
    if (e.kind === 'alloc') {
      const unpaired = data.timeline.unpairedIds.includes(e.id ?? '')
      row.className = 'pd-own-tl' + (unpaired ? ' pd-own-tl-unpaired' : '')
      row.textContent = `↑ alloc ${e.type ?? ''} ${fmtBytes(e.byteSize ?? 0)}${e.sourceLocation ? ' 📍 ' + e.sourceLocation : ''}${unpaired ? ' ⚠️ 未配对（可疑）' : ''}`
    } else if (e.kind === 'drop') {
      row.className = 'pd-own-tl'
      row.textContent = `↓ drop ${e.type ?? ''} ${fmtBytes(e.byteSize ?? 0)}${e.matchedAllocId ? `（↔ ${e.matchedAllocId}）` : ''}`
    } else if (e.kind === 'moved') {
      row.className = 'pd-own-tl'
      row.textContent = `→ moved ${e.type ?? ''}（owner ${e.owner ?? '—'}）`
    } else {
      row.className = 'pd-own-tl'
      row.textContent = `${e.kind} ${e.from ?? ''} → ${e.to ?? ''}`
    }
    tlCard.appendChild(row)
  }
}

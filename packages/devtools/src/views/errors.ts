// packages/devtools/src/views/errors.ts
// DevTools 异常根因视图：根因卡片（attribution 高亮 + 影响范围 chips + 复现脚本步骤）
import type { RootCauseReport } from '@proteus-vue/devtools-runtime'

export interface ErrorsViewData {
  reports: RootCauseReport[]
}

export function renderErrors(container: HTMLElement, data: ErrorsViewData): void {
  container.replaceChildren()
  const reports = data.reports
  if (reports.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'pd-empty'
    empty.textContent = '暂无异常（根因面板空闲）'
    container.appendChild(empty)
    return
  }
  for (const r of reports) {
    const card = document.createElement('div')
    card.className = 'pd-error-card'
    // 头部：根因 + attribution
    const head = document.createElement('div')
    head.className = 'pd-error-head'
    const title = document.createElement('div')
    title.className = 'pd-error-title'
    title.textContent = r.rootCause.source + '.' + r.rootCause.name + ' @ ' + r.rootCause.timestamp + 'ms'
    head.appendChild(title)
    if (r.attribution) {
      const attr = document.createElement('div')
      attr.className = 'pd-error-attr'
      attr.textContent = '⚑ ' + r.attribution
      head.appendChild(attr)
    }
    card.appendChild(head)
    // 调用链（causedBy 方向）
    const chain = document.createElement('div')
    chain.className = 'pd-error-chain'
    for (let i = r.chain.length - 1; i >= 0; i--) {
      const c = r.chain[i]
      const node = document.createElement('div')
      // ★根因匹配用键值（数据层 chain 与 rootCause 非同一对象引用）
      const isRoot = c.source === r.rootCause.source && c.name === r.rootCause.name && c.timestamp === r.rootCause.timestamp
      node.className = 'pd-chain-node' + (isRoot ? ' pd-chain-root' : '')
      node.textContent = c.source + '.' + c.name
      chain.appendChild(node)
      if (i > 0) {
        const up = document.createElement('div')
        up.className = 'pd-chain-up'
        up.textContent = '↑'
        chain.appendChild(up)
      }
    }
    card.appendChild(chain)
    // 影响范围
    const impact = document.createElement('div')
    impact.className = 'pd-error-impact'
    for (const s of r.impactSources) {
      const chip = document.createElement('span')
      chip.className = 'pd-chip'
      chip.textContent = s
      impact.appendChild(chip)
    }
    card.appendChild(impact)
    // 复现脚本
    const repro = document.createElement('ol')
    repro.className = 'pd-repro'
    for (const step of r.repro) {
      const li = document.createElement('li')
      li.textContent = step
      repro.appendChild(li)
    }
    card.appendChild(repro)
    container.appendChild(card)
  }
}

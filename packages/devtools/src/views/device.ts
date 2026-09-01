// packages/devtools/src/views/device.ts
// DevTools 设备面板（devtools-plan M8）：运行环境概览 + 能力表格 + 内存曲线
//   数据源：options.deviceInfo 钩子（本地面板：install 侧采集 navigator/screen + 能力注册表快照）/
//          Proteus.deviceInfo 命令（远程面板：应用侧上报经 relay 缓存）
//   内存曲线：面板进程 performance.memory 采样（本地面板与应用同进程数值准确；远程面板为面板宿主浏览器内存，标注局限）
//   纯函数：data → DOM
export interface DeviceScreenInfo {
  dpr: number
  width: number
  height: number
  /** 安全区（CSS env(safe-area-inset-*)；刘海屏；无则 undefined） */
  safeTop?: number
  safeBottom?: number
}

export interface DeviceMemoryInfo {
  jsHeapLimit: number
  totalJSHeapSize: number
  usedJSHeapSize: number
}

export interface DeviceCapabilityInfo {
  capability: string
  platform: string
  priority: number
  required: boolean
  fallback?: string
  supported: boolean
  runsInWorklet?: boolean
  platforms: string[]
}

export interface DeviceInfo {
  platform: string
  userAgent?: string
  /** 基础库版本（小程序；web 缺省） */
  libVersion?: string
  screen?: DeviceScreenInfo
  memory?: DeviceMemoryInfo
  capabilities: DeviceCapabilityInfo[]
}

export interface DeviceMemorySample {
  t: number
  used: number
  total: number
  limit: number
}

export interface DeviceViewData {
  info?: DeviceInfo
  memory: DeviceMemorySample[]
}

function fmtBytes(b: number): string {
  if (!b || b <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = b
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + units[i]
}

export function renderDevice(container: HTMLElement, data: DeviceViewData): void {
  container.replaceChildren()
  const info = data.info
  if (!info) {
    const empty = document.createElement('div')
    empty.className = 'pd-empty'
    empty.textContent = '暂无设备信息（Proteus.deviceInfo 注入后出现）'
    container.appendChild(empty)
    return
  }

  // ── 概览卡片：平台 + 基础库 + 屏幕 + 内存 ──────────────────────────────
  const overview = document.createElement('div')
  overview.className = 'pd-dev-overview'
  const cards: Array<{ label: string; value: string; hint?: string }> = [
    { label: '平台', value: info.platform || '—' },
    { label: '基础库', value: info.libVersion || '—' },
    { label: '屏幕', value: info.screen ? info.screen.width + '×' + info.screen.height + ' @' + info.screen.dpr + 'x' : '—' },
  ]
  if (info.memory) {
    const usedPct = info.memory.jsHeapLimit > 0 ? Math.round((info.memory.usedJSHeapSize / info.memory.jsHeapLimit) * 100) : 0
    cards.push({ label: 'JS 堆', value: fmtBytes(info.memory.usedJSHeapSize) + ' / ' + fmtBytes(info.memory.jsHeapLimit), hint: usedPct + '% 已用' })
  }
  for (const c of cards) {
    const card = document.createElement('div')
    card.className = 'pd-dev-card'
    const label = document.createElement('div')
    label.className = 'pd-dev-card-label'
    label.textContent = c.label
    const value = document.createElement('div')
    value.className = 'pd-dev-card-value'
    value.textContent = c.value
    card.appendChild(label)
    card.appendChild(value)
    if (c.hint) {
      const hint = document.createElement('div')
      hint.className = 'pd-dev-card-hint'
      hint.textContent = c.hint
      card.appendChild(hint)
    }
    overview.appendChild(card)
  }
  container.appendChild(overview)
  if (info.userAgent) {
    const ua = document.createElement('div')
    ua.className = 'pd-dev-ua'
    ua.textContent = info.userAgent
    ua.title = info.userAgent
    container.appendChild(ua)
  }

  // ── 内存曲线（录制期间采样；面板进程 performance.memory） ────────────────
  const samples = data.memory
  if (samples.length) {
    const box = document.createElement('div')
    box.className = 'pd-dev-memory'
    const head = document.createElement('div')
    head.className = 'pd-section-head'
    head.textContent = '内存曲线（' + samples.length + ' 采样 · 面板进程）'
    box.appendChild(head)
    const max = Math.max.apply(null, samples.map((s) => s.total)) || 1
    const chart = document.createElement('div')
    chart.className = 'pd-dev-mem-chart'
    for (const s of samples) {
      const col = document.createElement('div')
      col.className = 'pd-dev-mem-col'
      const usedH = Math.round((s.used / max) * 100)
      const used = document.createElement('div')
      used.className = 'pd-dev-mem-used'
      used.style.height = Math.max(1, usedH) + '%'
      used.title = 'used ' + fmtBytes(s.used)
      const total = document.createElement('div')
      total.className = 'pd-dev-mem-total'
      total.style.height = Math.round((s.total / max) * 100) + '%'
      total.title = 'total ' + fmtBytes(s.total)
      col.appendChild(total)
      col.appendChild(used)
      chart.appendChild(col)
    }
    box.appendChild(chart)
    const latest = samples[samples.length - 1] as DeviceMemorySample
    const stat = document.createElement('div')
    stat.className = 'pd-dev-mem-stat'
    stat.textContent = 'used ' + fmtBytes(latest.used) + ' / total ' + fmtBytes(latest.total) + ' / limit ' + fmtBytes(latest.limit)
    box.appendChild(stat)
    container.appendChild(box)
  }

  // ── 能力表格（按域分组；✅/❌ + 降级/required/平台覆盖标注） ──────────────
  const caps = Array.isArray(info.capabilities) ? info.capabilities : []
  if (caps.length) {
    const table = document.createElement('div')
    table.className = 'pd-dev-caps'
    const head = document.createElement('div')
    head.className = 'pd-section-head'
    head.textContent = '能力（' + caps.length + ' · ' + info.platform + '）'
    table.appendChild(head)
    for (const c of caps) {
      const row = document.createElement('div')
      row.className = 'pd-dev-cap' + (c.supported ? ' pd-dev-cap-ok' : ' pd-dev-cap-no')
      const mark = document.createElement('span')
      mark.className = 'pd-dev-cap-mark'
      mark.textContent = c.supported ? '✅' : '❌'
      const name = document.createElement('span')
      name.className = 'pd-dev-cap-name'
      name.textContent = c.capability
      const meta = document.createElement('span')
      meta.className = 'pd-dev-cap-meta'
      const parts: string[] = []
      parts.push(c.platforms.join('/'))
      if (c.required) parts.push('required')
      if (c.runsInWorklet) parts.push('worklet')
      if (c.fallback) parts.push('→ ' + c.fallback)
      if (c.priority) parts.push('p' + c.priority)
      meta.textContent = parts.join(' · ')
      row.appendChild(mark)
      row.appendChild(name)
      row.appendChild(meta)
      table.appendChild(row)
    }
    container.appendChild(table)
  }
}

// packages/devtools/src/plugins/network.ts
// devtools-plan M9 内置参考插件：API 瀑布视图（订阅 source=api 事件 → 列表展示耗时/状态，最新 200 条）
// 演示 addView + bus 订阅（第三方插件同构）；独立包 @proteus-vue/devtools-plugin-network 后续切出
import type { DevToolsPlugin } from '../plugins'

export function createNetworkPlugin(): DevToolsPlugin {
  return {
    name: '@proteus-vue/devtools-plugin-network',
    version: '0.1.0',
    setup(ctx) {
      interface Row {
        name: string
        ms: number
        ok: boolean
        ts: number
      }
      const rows: Row[] = []
      const inflight = new Map<string, number>()
      ctx.bus.on((e) => {
        if (e.source !== 'api') return
        if (e.phase === 'start') {
          inflight.set(e.traceId ?? e.name + '-' + e.timestamp, e.timestamp)
        } else if (e.phase === 'end' || e.phase === 'error') {
          const start = inflight.get(e.traceId ?? e.name + '-' + e.timestamp)
          rows.unshift({
            name: e.name,
            ms: start !== undefined ? Math.max(0, e.timestamp - start) : 0,
            ok: e.phase === 'end',
            ts: e.timestamp,
          })
          if (rows.length > 200) rows.pop()
        }
      })
      ctx.panel.addView('network', {
        label: 'network',
        icon: '⇅',
        render(container) {
          container.replaceChildren()
          if (rows.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'pd-empty'
            empty.textContent = '暂无 API 事件（source=api）'
            container.appendChild(empty)
            return
          }
          const list = document.createElement('div')
          list.className = 'pd-net'
          for (const r of rows.slice(0, 50)) {
            const row = document.createElement('div')
            row.className = 'pd-net-row' + (r.ok ? '' : ' pd-net-error')
            const name = document.createElement('span')
            name.className = 'pd-net-name'
            name.textContent = r.name
            const meta = document.createElement('span')
            meta.className = 'pd-net-meta'
            meta.textContent = r.ms + 'ms' + (r.ok ? '' : ' ✕')
            row.appendChild(name)
            row.appendChild(meta)
            list.appendChild(row)
          }
          container.appendChild(list)
        },
      })
    },
  }
}

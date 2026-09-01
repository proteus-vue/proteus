// examples/devtools-panel-mount.ts —— Web 端本地面板挂载（浮动窗口形态）
// ★双通道并存：Vue DevTools 浏览器扩展（Timeline/Inspectors）+ 本地面板（八视图）——同源 TraceBus，各自独立消费
// 用法：main.ts 开发模式调用 mountDevtoolsPanel(traceBus)；重复挂载有守卫（HMR 重跑不重复）
import { createDevtoolsPanel } from '@proteus-vue/devtools'
import type { TraceBus } from '@proteus-vue/devtools-runtime'
import { createTraceBusSource } from '@proteus-vue/devtools'
import { routes } from './router/auto-routes'

let mounted = false

export function mountDevtoolsPanel(bus: TraceBus): void {
  if (mounted) return
  mounted = true

  const btn = document.createElement('button')
  btn.className = 'pd-floating-toggle'
  btn.textContent = '◈'
  btn.title = 'Proteus DevTools'
  const host = document.createElement('div')
  host.className = 'pd-floating-host'
  host.style.display = 'none'
  document.body.appendChild(btn)
  document.body.appendChild(host)

  let panel: { destroy(): void; show(view: string): void } | null = null
  btn.addEventListener('click', () => {
    if (host.style.display !== 'none') {
      host.style.display = 'none'
      return
    }
    host.style.display = 'block'
    if (!panel) {
      // 首次点击创建：TraceBus 直连源 + pages 数据（路由表 → pages/依赖图面板）
      panel = createDevtoolsPanel(host, {
        source: createTraceBusSource(bus),
        pages: {
          routes: routes.map((r) => ({ name: r.name, path: r.path, meta: r.meta, subPackage: r.subPackage })),
        },
      })
    }
  })
}

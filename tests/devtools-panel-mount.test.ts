// tests/devtools-panel-mount.test.ts —— Web 端本地面板挂载（浮动窗口；与 Vue DevTools 扩展双通道并存）
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { createTraceBus } from '@proteus-vue/devtools-runtime'
import { mountDevtoolsPanel } from '../examples/devtools-panel-mount'

describe('Web 端本地面板挂载', () => {
  it('按钮出现 → 点击创建面板（8 视图 + pages 注入）→ 事件进面板 → 再点隐藏', async () => {
    const bus = createTraceBus({ enabled: true })
    mountDevtoolsPanel(bus)
    const btn = document.querySelector('.pd-floating-toggle') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect((document.querySelector('.pd-floating-host') as HTMLElement).style.display).toBe('none')
    // 点击 → 显示 + 创建面板（8 视图）
    btn.click()
    const host = document.querySelector('.pd-floating-host') as HTMLElement
    expect(host.style.display).toBe('block')
    expect(document.querySelectorAll('.pd-nav-item').length).toBe(8)
    // pages 数据注入（auto-routes 路由表 → pages/依赖图面板）
    const pagesView = document.querySelector('.pd-view[data-view="pages"]') as HTMLElement
    expect(pagesView.querySelector('.pd-page-row')).not.toBeNull()
    const graphView = document.querySelector('.pd-view[data-view="graph"]') as HTMLElement
    expect(graphView.querySelector('.pd-graph-node')).not.toBeNull()
    // 事件流 → 面板 timeline 更新（同源 TraceBus 独立消费）
    bus.emit('lifecycle', 'start', 'boot', undefined, 't1')
    bus.emit('lifecycle', 'end', 'boot', undefined, 't1')
    await new Promise((r) => setTimeout(r, 40))
    expect(document.querySelector('.pd-span')?.textContent).toContain('boot')
    // 再点 → 隐藏（复用已建面板）
    btn.click()
    expect(host.style.display).toBe('none')
  })
})

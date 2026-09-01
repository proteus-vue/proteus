// tests/devtools-panel-page.test.ts —— devtools 面板页面端点（devtoolsRelayPlugin 的 /proteus-devtools）
// 开发者浏览器直接打开面板（无需点 node_modules 里的 panel.html）；注入当前 host 的 /proteus-panel 默认 WS + 资源路径重写
import { describe, it, expect } from 'vitest'
import { createPanelPageHandler, resolveDevtoolsDir, printPanelUrl } from '@proteus-vue/plugin-vite'

function mockRes() {
  const headers: Record<string, string> = {}
  let body = ''
  return {
    headers,
    setHeader: (k: string, v: string) => {
      headers[k] = v
    },
    end: (d: string | Buffer) => {
      body = String(d)
    },
    get body() {
      return body
    },
  }
}

describe('createPanelPageHandler', () => {
  it('/proteus-devtools → panel.html（注入默认 WS ws://host/proteus-panel + 资源绝对路径重写）', () => {
    const handler = createPanelPageHandler(resolveDevtoolsDir())
    const res = mockRes()
    const hit = handler({ url: '/proteus-devtools', headers: { host: 'localhost:5173' } }, res)
    expect(hit).toBe(true)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('ws://localhost:5173/proteus-panel') // 默认 WS 注入当前 host
    expect(res.body).toContain('href="/proteus-devtools/style.css"')
    expect(res.body).toContain('src="/proteus-devtools/panel.js"')
    expect(res.body).not.toContain('./style.css') // 不再引用相对路径
  })

  it('资源端点：/proteus-devtools/style.css + /proteus-devtools/panel.js（读包内产物）', () => {
    const handler = createPanelPageHandler(resolveDevtoolsDir())
    const resCss = mockRes()
    expect(handler({ url: '/proteus-devtools/style.css' }, resCss)).toBe(true)
    expect(resCss.headers['content-type']).toContain('text/css')
    expect(resCss.body.length).toBeGreaterThan(100)
    const resJs = mockRes()
    expect(handler({ url: '/proteus-devtools/panel.js' }, resJs)).toBe(true)
    expect(resJs.headers['content-type']).toContain('javascript')
    expect(resJs.body.length).toBeGreaterThan(1000)
  })

  it('非面板路径 → 不处理（next 放行）', () => {
    const handler = createPanelPageHandler(resolveDevtoolsDir())
    const res = mockRes()
    expect(handler({ url: '/other' }, res)).toBe(false)
    expect(res.body).toBe('')
  })
})

describe('printPanelUrl', () => {
  it('listening 后打印面板地址（取实际端口）', () => {
    let cb: (() => void) | null = null
    const httpServer = {
      once: (event: string, fn: () => void) => {
        if (event === 'listening') cb = fn
      },
      address: () => ({ port: 5173 }),
    }
    const logs: string[] = []
    const logger = { info: (m: string) => logs.push(m) }
    printPanelUrl(httpServer, logger)
    expect(cb).not.toBeNull()
    cb?.()
    expect(logs[0]).toContain('http://localhost:5173/proteus-devtools')
  })

  it('无 httpServer（preview 场景无 listening）→ 静默不打印', () => {
    const logs: string[] = []
    printPanelUrl(null, { info: (m: string) => logs.push(m) })
    expect(logs.length).toBe(0)
  })
})

// tests/devtools-remote-time-travel.test.ts —— ★远程时间旅行端到端（面板拖滑块 → 命令 → relay → bridge → pinia $patch 真实恢复）
// 拓扑：bridge(应用侧) ↔ relay(source) ←路由→ relay(panel) ↔ ws-source(面板)
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { createProteusRelay } from '@proteus-vue/plugin-vite'
import { createTraceBus, createStoreTracer } from '@proteus-vue/devtools-runtime'
import { createTraceBusWsBridge, createDevtoolsPanel, createDevtoolsWsSource } from '@proteus-vue/devtools'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** relay 侧 socket（relay 用 on 接口注册 message）；send 由对端桥接覆写 */
function relaySock() {
  const handlers: Record<string, (data: unknown) => void> = {}
  return {
    send: () => {},
    readyState: 1,
    close: () => {},
    on: (event: string, cb: (data: unknown) => void) => {
      handlers[event] = cb
    },
    emit: (event: string, data: unknown) => handlers[event]?.(data),
  }
}

/** 应用侧 bridge socket：send → relay；relay.send → 本端 onmessage */
function bridgeSock(relay: ReturnType<typeof relaySock>) {
  const s = {
    send: (d: string) => relay.emit('message', d),
    onmessage: null as ((ev: { data: unknown }) => void) | null,
    onopen: null as (() => void) | null,
    close: () => {},
    readyState: 1,
  }
  relay.send = (d: string) => s.onmessage?.({ data: d })
  return s
}

/** 面板侧 ws-source socket：send → relay；relay.send → 本端 onmessage */
function panelSock(relay: ReturnType<typeof relaySock>) {
  const s = {
    send: (d: string) => relay.emit('message', d),
    onmessage: null as ((ev: { data: unknown }) => void) | null,
    onopen: null as (() => void) | null,
    onclose: null as (() => void) | null,
    close: () => {},
    readyState: 1,
  }
  relay.send = (d: string) => s.onmessage?.({ data: d })
  return s
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('远程时间旅行端到端', () => {
  it('面板拖滑块 → Proteus.restoreStores → relay 转发 → bridge → pinia $patch 真实恢复', async () => {
    const relay = createProteusRelay()
    const sRelay = relaySock()
    const pRelay = relaySock()
    relay.handleConnection('source', sRelay as never)
    relay.handleConnection('panel', pRelay as never)

    // ── 应用侧：pinia + bus + tracer + bridge（stub WebSocket → bridge socket）──
    const app = createApp({})
    const pinia = createPinia()
    app.use(pinia)
    setActivePinia(pinia)
    const bus = createTraceBus({ enabled: true })
    const bridgeWs = bridgeSock(sRelay)
    const Fake = vi.fn(() => bridgeWs) as unknown as typeof WebSocket
    Fake.OPEN = 1
    vi.stubGlobal('WebSocket', Fake)
    const bridge = createTraceBusWsBridge(bus, {
      url: 'ws://host/proteus-source',
      onRestoreStores: (stores) => {
        for (const s of stores) {
          const st = pinia._s.get(s.id)
          st?.$patch(s.state)
        }
      },
    })
    // ★store 在 bridge 连接后创建（tracer use 插件发 init → 上行 → 面板）
    const tracer = createStoreTracer(pinia, bus)
    const usePlayer = defineStore('player', {
      state: () => ({ playing: false, volume: 0.8 }),
      actions: {
        play() { this.playing = true },
        setVolume(v: number) { this.volume = v },
      },
    })
    const store = usePlayer()
    await wait(40) // init 上行

    // ── 面板侧：ws-source（createSocket → panel socket）+ 面板 ──
    const root = document.createElement('div')
    const pSock = panelSock(pRelay)
    const source = createDevtoolsWsSource('ws://host/proteus-panel', () => pSock as unknown as WebSocket)
    const panel = createDevtoolsPanel(root, { source })
    await wait(40)
    // 触发 ws-source onopen（enable/appInfo 下发 → relay → bridge 回放 + 响应）
    ;(pSock as unknown as { onopen: (() => void) | null }).onopen?.()
    await wait(40)

    // ── 应用侧变更 → 事件上行 → 面板步骤 ──
    store.play()
    store.setVolume(0.5)
    await wait(120)
    panel.show('state')
    const stateView = root.querySelector('.pd-view[data-view="state"]') as HTMLElement
    const range = stateView.querySelector('.pd-range') as HTMLInputElement
    expect(range).not.toBeNull()
    expect(store.playing).toBe(true)
    expect(store.volume).toBe(0.5)

    // ── 面板拖滑块（最左）→ 命令下行 → relay → bridge → $patch 恢复 ──
    range.value = '0'
    range.dispatchEvent(new Event('input'))
    await wait(120)
    expect(store.playing).toBe(false)
    expect(store.volume).toBe(0.8)

    tracer.dispose()
    bridge.close()
    panel.destroy()
    app.unmount()
  }, 30_000)
})

// tests/desktop-b4.test.ts
// ★G-24 B4（proteus-semantic-primitives-plan 01 §8 Lifecycle + 06-integration-batches B4）：生命周期/设备能力四件套
//   验证点：p-lifecycle（phaseOf + createLifecycleTracker 事件驱动）· p-state-restoration（token/白名单/capture/restore/clear）·
//   p-network-status（detectNetwork 归一 + tracker 订阅）· p-low-power（detectLowPower 注入 + tracker chargingchange）
import { describe, it, expect, vi } from 'vitest'
import {
  phaseOf,
  createLifecycleTracker,
  buildRestoreToken,
  filterRestorable,
  captureState,
  restoreState,
  clearRestoreState,
  detectNetwork,
  createNetworkTracker,
  detectLowPower,
  createLowPowerTracker,
} from '@proteus-vue/desktop'

describe('G-24 B4 p-lifecycle（前后台——UIApplicationDelegate 语义）', () => {
  it('phaseOf：hidden → background / 可见 → foreground', () => {
    expect(phaseOf(() => true)).toBe('background')
    expect(phaseOf(() => false)).toBe('foreground')
  })

  it('createLifecycleTracker：visibilitychange/focus 事件驱动 onPhase + destroy 注销', async () => {
    const listeners: Record<string, () => void> = {}
    let hidden = false
    const phases: string[] = []
    const tracker = createLifecycleTracker(
      { onPhase: (p) => phases.push(p) },
      {
        getHidden: () => hidden,
        on: (t, fn) => {
          listeners[t] = fn
        },
        off: (t) => {
          delete listeners[t]
        },
      },
    )
    expect(tracker.getPhase()).toBe('foreground')
    hidden = true
    listeners.visibilitychange?.()
    expect(tracker.getPhase()).toBe('background')
    expect(phases).toEqual(['background'])
    tracker.destroy()
    expect(listeners.visibilitychange).toBeUndefined()
  })
})

describe('G-24 B4 p-state-restoration（UIStateRestoration / SavedStateHandle 语义）', () => {
  it('buildRestoreToken：剔除 undefined/函数（可序列化白名单）+ filterRestorable 白名单过滤', () => {
    const token = buildRestoreToken({ scroll: 120, tab: 'a', skip: undefined, fn: () => 1 } as never)
    expect(JSON.parse(token)).toEqual({ scroll: 120, tab: 'a' })
    expect(filterRestorable({ token: 'secret', scroll: 5 }, ['scroll'])).toEqual({ scroll: 5 })
  })

  it('capture/restore/clear：注入 Map storage 往返 + 无记录 null + 非法 JSON null', () => {
    const store = new Map<string, string>()
    const storage = {
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string) => void store.set(k, v),
      remove: (k: string) => void store.delete(k),
    }
    const token = captureState('page', 'scroll', { scroll: 42 }, storage)
    expect(token).toContain('"scroll":42')
    expect(restoreState<{ scroll: number }>('page', 'scroll', storage)).toEqual({ scroll: 42 })
    expect(restoreState('page', 'missing', storage)).toBeNull()
    store.set('proteus-restore:page:bad', '{oops')
    expect(restoreState('page', 'bad', storage)).toBeNull() // 非法 JSON → null 不抛
    clearRestoreState('page', 'scroll', storage)
    expect(store.has('proteus-restore:page:scroll')).toBe(false)
  })

  it('restoreKey：命名空间化键', async () => {
    const { restoreKey } = await import('@proteus-vue/desktop')
    expect(restoreKey('page', 'scroll')).toBe('proteus-restore:page:scroll')
  })
})

describe('G-24 B4 p-network-status（NWPathMonitor / ConnectivityManager 语义）', () => {
  it('detectNetwork：wifi/ethernet/cellular/offline/unknown 归一 + effectiveType', () => {
    expect(detectNetwork({ onLine: () => true, connectionType: () => 'wifi', effectiveType: () => '4g' })).toEqual({ online: true, kind: 'wifi', effectiveType: '4g' })
    expect(detectNetwork({ onLine: () => true, connectionType: () => 'ethernet' }).kind).toBe('ethernet')
    expect(detectNetwork({ onLine: () => true, connectionType: () => 'cellular' }).kind).toBe('cellular')
    expect(detectNetwork({ onLine: () => false, connectionType: () => 'wifi' })).toMatchObject({ online: false, kind: 'none' })
    expect(detectNetwork({ onLine: () => true, connectionType: () => null }).kind).toBe('unknown')
  })

  it('createNetworkTracker：online/offline/change 事件订阅 → onChange + destroy', async () => {
    const listeners: Record<string, () => void> = {}
    let online = true
    let kind = 'wifi'
    const seen: string[] = []
    const tracker = createNetworkTracker(
      { onChange: (i) => seen.push(`${i.online}:${i.kind}`) },
      {
        onLine: () => online,
        connectionType: () => kind,
        on: (t, fn) => {
          listeners[t] = fn
        },
        off: (t) => {
          delete listeners[t]
        },
      },
    )
    expect(tracker.getInfo()).toMatchObject({ online: true, kind: 'wifi' })
    online = false
    listeners.offline?.()
    expect(seen).toEqual(['false:none'])
    tracker.destroy()
    expect(listeners.online).toBeUndefined()
  })
})

describe('G-24 B4 p-low-power（NSProcessInfo lowPowerMode / BatteryManager 语义）', () => {
  it('detectLowPower：≤20% 未充电 → lowPower；无 API → supported:false', async () => {
    const low = await detectLowPower({ getBattery: async () => ({ charging: false, level: 0.1 }) })
    expect(low).toMatchObject({ supported: true, lowPower: true, charging: false, level: 0.1 })
    const charging = await detectLowPower({ getBattery: async () => ({ charging: true, level: 0.1 }) })
    expect(charging.lowPower).toBe(false) // 充电中不判低电量
    const unsup = await detectLowPower()
    expect(unsup.supported).toBe(false)
  })

  it('createLowPowerTracker：chargingchange/levelchange 订阅 → onChange + refresh', async () => {
    const battery = { charging: false, level: 0.5, on: vi.fn(), off: vi.fn() }
    const seen: Array<{ level: number; charging: boolean }> = []
    const tracker = createLowPowerTracker(
      { onChange: (i) => seen.push({ level: i.level, charging: i.charging }) },
      { getBattery: async () => battery as never },
    )
    await new Promise((r) => setTimeout(r, 5))
    expect(tracker.getInfo()).toMatchObject({ supported: true, level: 0.5 })
    expect(battery.on).toHaveBeenCalledWith('chargingchange', expect.any(Function))
    battery.level = 0.1
    battery.charging = false
    const after = await tracker.refresh()
    expect(after.lowPower).toBe(true)
    tracker.destroy()
    expect(battery.off).toHaveBeenCalled()
  })
})

// packages/desktop/src/low-power.ts
// ★G-24 B4（proteus-semantic-primitives-plan 01 §8 p-low-power）：低电量/低数据纯逻辑（NSProcessInfo lowPowerMode / BatteryManager 语义）
//   · detectLowPower：Battery API 归一（supported/charging/level/lowPower——≤20% 且未充电）
//   · createLowPowerTracker：chargingchange/levelchange 订阅 → onChange（env 注入可单测）
//   诚实降级：无 Battery API（桌面浏览器多数不支持 navigator.getBattery）→ supported:false（宿主桥接原生电量后续）
export interface PowerInfo {
  /** Battery API 可用性 */
  supported: boolean
  lowPower: boolean
  charging: boolean
  level: number
}

export interface BatteryLike {
  charging: boolean
  level: number
  on?(type: 'chargingchange' | 'levelchange', fn: () => void): void
  off?(type: 'chargingchange' | 'levelchange', fn: () => void): void
}

export interface PowerEnv {
  getBattery?: () => Promise<BatteryLike | null>
}

const LOW_LEVEL = 0.2

function defaultGetBattery(): Promise<BatteryLike | null> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const g = nav as { getBattery?: () => Promise<BatteryLike | null> }
  if (typeof g.getBattery !== 'function') return Promise.resolve(null)
  return g.getBattery().catch(() => null)
}

function normalize(info: BatteryLike | null): PowerInfo {
  if (!info) return { supported: false, lowPower: false, charging: false, level: 0 }
  const level = Math.max(0, Math.min(1, info.level))
  return {
    supported: true,
    lowPower: level <= LOW_LEVEL && !info.charging,
    charging: info.charging,
    level,
  }
}

/** ★detectLowPower：即时电量状态（getBattery 注入；无 API → supported:false 诚实降级） */
export async function detectLowPower(env: PowerEnv = {}): Promise<PowerInfo> {
  const getBattery = env.getBattery ?? defaultGetBattery
  try {
    const info = await getBattery()
    return normalize(info)
  } catch {
    return { supported: false, lowPower: false, charging: false, level: 0 }
  }
}

export interface LowPowerTracker {
  /** 最近一次检测（未检测 → null） */
  getInfo(): PowerInfo | null
  /** 重新拉取 */
  refresh(): Promise<PowerInfo>
  destroy(): void
}

/** ★createLowPowerTracker：订阅 chargingchange/levelchange → onChange(PowerInfo) */
export function createLowPowerTracker(opts: { onChange: (info: PowerInfo) => void }, env: PowerEnv = {}): LowPowerTracker {
  let current: PowerInfo | null = null
  let battery: BatteryLike | null = null
  const getBattery = env.getBattery ?? defaultGetBattery
  const notify = (): void => {
    const info = normalize(battery)
    current = info
    opts.onChange(info)
  }
  void getBattery().then((b) => {
    battery = b
    if (b && typeof b.on === 'function') {
      b.on('chargingchange', notify)
      b.on('levelchange', notify)
    }
    notify()
  })
  return {
    getInfo: () => current,
    refresh: async () => {
      battery = await getBattery()
      notify()
      return current ?? normalize(battery)
    },
    destroy: () => {
      if (battery && typeof battery.off === 'function') {
        battery.off('chargingchange', notify)
        battery.off('levelchange', notify)
      }
    },
  }
}

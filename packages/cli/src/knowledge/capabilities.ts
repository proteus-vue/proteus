// packages/cli/src/knowledge/capabilities.ts
// ★★G-54 ⑤ `affectedDevices(spiId)`（决策 #1178）：「能力 → 设备等价类」影响面。
//
// 【为什么这一版能真做，而 #1153 当时判"数据源未就绪"】
//   #1153 的判断前提是"没有机器可读的 SPI → 宿主/端映射"。现在有了：
//   `@proteus-vue/capabilities` 的 `scanCapabilities(root)` 会扫 `capabilities/*.capability.ts`，
//   而 **adapters 的键名就是平台集合** ⇒ `{ id, tier, platforms, source }` 即真实映射。
//   同一份数据还被 `check:capability-golden` 冻结成跨语言 golden —— 来源唯一、有门禁守着。
//
// 【三条"不糊弄"的约定（每条都对应一种常见的假数据）】
//   1. **未加载清单 ≠ 查无此能力**：`loaded=false` 表示调用方没给数据；`known=false` 表示数据里没有。
//      两者都返回空设备列表，但语义必须分开——否则"没数据"会被读成"不影响任何端"。
//   2. **未知 id 不返回"全部设备"**：把"我不知道"说成"影响所有端"是最危险的假数据
//      （它会让"影响面"看起来永远最大，从而失去判别力）。
//   3. **platforms 缺失/空 ⇒ 空列表，不猜**：没有 adapter 就是没有（该能力当前只在部分端实现）。
//
// 【纯函数】本文件不做 IO：清单由调用方（CLI / 未来 daemon）扫描后传进来，
//   与 `loadManifests` 同一套分工（内核不持 IO，宿主各管各的加载策略）。

/** 已登记的端（与 `packages/types` 的 `Platform` 对齐：web / skyline / app） */
export const KNOWN_DEVICE_CLASSES = ['web', 'skyline', 'app'] as const
export type DeviceClass = (typeof KNOWN_DEVICE_CLASSES)[number] | string

/** 清单条目（对齐 `ManifestCapabilityEntry`，但**不 import 该包的类型**——内核不依赖扫描器实现） */
export interface CapabilityEntry {
  id: string
  tier: number
  name?: string
  platforms: DeviceClass[]
  fallback?: string
  /** 描述文件路径（相对扫描根）——"产物可追溯"铁律：每条结论都能指回源文件 */
  source: string
}

/** `affectedDevices` 的返回：三种状态显式分开，调用方不能把它们混为一谈 */
export interface AffectedDevices {
  spiId: string
  /** 清单是否加载（false = 调用方没给数据，不是"没有影响面"） */
  loaded: boolean
  /** 清单里是否有这个 id（false = 数据里查无此能力） */
  known: boolean
  deviceClasses: DeviceClass[]
  entry: CapabilityEntry | null
}

/**
 * 解析清单（容错 + 稳定排序）。
 * ★坏条目**不静默丢弃**：缺 `id` 的直接丢（无法索引），但 `platforms` 非数组会归一成 `[]`
 *   并在 `malformed` 里记一笔——让"数据坏了"可见，而不是看起来"这个能力没有端支持"。
 */
export function parseCapabilityManifest(raw: unknown): { entries: CapabilityEntry[]; malformed: string[] } {
  const list = (raw as { capabilities?: unknown })?.capabilities
  const malformed: string[] = []
  if (!Array.isArray(list)) return { entries: [], malformed: ['<root>: capabilities 不是数组'] }
  const entries: CapabilityEntry[] = []
  for (const item of list) {
    const e = item as Record<string, unknown>
    const id = typeof e?.id === 'string' ? e.id : ''
    if (!id) {
      malformed.push('<entry>: 缺 id')
      continue
    }
    const platforms = Array.isArray(e.platforms)
      ? [...new Set(e.platforms.filter((p): p is string => typeof p === 'string' && p.length > 0))].sort()
      : (malformed.push(`${id}: platforms 不是数组 ⇒ 归一为 []`), [])
    entries.push({
      id,
      tier: typeof e.tier === 'number' ? e.tier : -1,
      name: typeof e.name === 'string' ? e.name : undefined,
      platforms,
      fallback: typeof e.fallback === 'string' ? e.fallback : undefined,
      source: typeof e.source === 'string' ? e.source : '',
    })
  }
  entries.sort((a, b) => a.id.localeCompare(b.id))
  return { entries, malformed }
}

/**
 * ⑤ 设备等价类 → 影响面：`spiId` 改了，哪些端需要回归。
 * @param entries `parseCapabilityManifest().entries`
 * @param spiId 能力 id（如 `clipboard`）
 * @param loaded 清单是否真的加载过（调用方必须诚实传入）
 */
export function affectedDevicesOf(
  entries: readonly CapabilityEntry[],
  spiId: string,
  loaded = true,
): AffectedDevices {
  const entry = loaded ? (entries.find((e) => e.id === spiId) ?? null) : null
  return {
    spiId,
    loaded,
    known: entry !== null,
    deviceClasses: entry ? [...entry.platforms] : [],
    entry,
  }
}

/** 清单概览：按端统计 + 未登记端（信息位；不判红——端枚举的收紧属于 capabilities 包的事） */
export function summarizeCapabilities(entries: readonly CapabilityEntry[]): {
  total: number
  byDeviceClass: Record<string, number>
  unknownDeviceClasses: string[]
  ids: string[]
} {
  const byDeviceClass: Record<string, number> = {}
  const unknown = new Set<string>()
  for (const e of entries) {
    for (const p of e.platforms) {
      byDeviceClass[p] = (byDeviceClass[p] ?? 0) + 1
      if (!(KNOWN_DEVICE_CLASSES as readonly string[]).includes(p)) unknown.add(p)
    }
  }
  return {
    total: entries.length,
    byDeviceClass,
    unknownDeviceClasses: [...unknown].sort(),
    ids: entries.map((e) => e.id),
  }
}

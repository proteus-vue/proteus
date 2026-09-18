// packages/shared/src/storage/serialize.ts
// 统一序列化（docs/proteus-pinia-plan M1 §4）—— Date / Map / Set ↔ JSON，循环引用报错
// ★扩展点：自定义 class 需持久化时在 store 提供 hydrate() action，本层不复活 class 实例（保持通用性）
// ⚠ MP 产物安全（决策 #32/#36）：全文件无 ?? / 对象展开 / 数组解构（用 Array.from 替代展开）
// ★实现说明：JSON.stringify 的 replacer 在 Date.toJSON() 之后调用（拿不到 Date 实例）→
//   序列化前先自写 walk 打类型标记（Date/Map/Set），再 stringify；反序列化用 reviver 还原
// 循环引用：strict 模式抛错（默认）；非 strict 丢该字段

const TYPE_TAG = '__proteus_type__'

/** 开发模式标记：true 时循环引用直接抛错（默认）；false 时丢字段 */
let strictCircular = true
export function setStrictCircular(strict: boolean): void {
  strictCircular = strict
}

/** 递归打标（Date/Map/Set → 带类型标记对象；对象/数组递归；循环检测） */
function mark(value: unknown, seen: unknown[]): unknown {
  if (value instanceof Date) return { [TYPE_TAG]: 'Date', value: value.toISOString() }
  if (value instanceof Map) {
    const entries = Array.from(value.entries()).map(([k, v]) => [k, mark(v, seen)] as [unknown, unknown])
    return { [TYPE_TAG]: 'Map', value: entries }
  }
  if (value instanceof Set) {
    const items = Array.from(value.values()).map((v) => mark(v, seen))
    return { [TYPE_TAG]: 'Set', value: items }
  }
  if (Array.isArray(value)) {
    if (seen.indexOf(value) !== -1) {
      if (strictCircular) throw new Error('[proteus] 序列化失败：检测到循环引用（持久化数据需为纯 JSON 结构）')
      return undefined
    }
    seen.push(value)
    return value.map((v) => mark(v, seen))
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.indexOf(value) !== -1) {
      if (strictCircular) throw new Error('[proteus] 序列化失败：检测到循环引用（持久化数据需为纯 JSON 结构）')
      return undefined
    }
    seen.push(value)
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value)) out[k] = mark((value as Record<string, unknown>)[k], seen)
    return out
  }
  return value
}

/** 序列化：Date/Map/Set 带类型标记；循环引用按 strictCircular 策略处理 */
export function serialize(value: unknown): string {
  return JSON.stringify(mark(value, []))
}

/** 反序列化：还原 Date/Map/Set */
export function deserialize<T = unknown>(raw: string): T {
  return JSON.parse(raw, (_k, v) => {
    if (v && typeof v === 'object' && TYPE_TAG in v) {
      const tagged = v as { [TYPE_TAG]: string; value: unknown }
      switch (tagged[TYPE_TAG]) {
        case 'Date':
          return new Date(tagged.value as string)
        case 'Map':
          return new Map(tagged.value as Array<[unknown, unknown]>)
        case 'Set':
          return new Set(tagged.value as unknown[])
        default:
          return v
      }
    }
    return v
  }) as T
}

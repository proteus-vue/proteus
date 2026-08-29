// packages/runtime/src/pinia/persistence/migrate.ts
// 状态版本迁移（docs/proteus-pinia-plan M7.4）
// 超级应用迭代快，store schema 改版后用户本地旧数据必须能升级，否则白屏/崩溃
//   · 读取持久化数据时比对 version
//   · 逐条执行 from → to 迁移链（支持跨多版本：1→3 = 1→2→3）
//   · 迁移失败 → 丢弃该 store 数据（走初始值 + 告警，不崩溃）
// ⚠ MP 产物安全：全文件无 ?? / ?. / 对象展开 / 数组解构
import { deserialize, serialize } from '@proteus/shared'

/** 版本迁移声明：from 版本数据 → to 版本（up 就地修改 state 或返回新 state） */
export interface Migration {
  from: number
  to: number
  up: (state: Record<string, unknown>) => Record<string, unknown>
}

export interface VersionedOptions {
  /** 当前 schema 版本（默认 0） */
  version?: number
  /** 迁移链：按 from 排序，逐条执行 */
  migrations?: Migration[]
}

const VERSION_KEY = '__proteus_version__'

/** 序列化时携带版本标记（version > 0 才包裹；version 0 保持裸 state 格式，向后兼容 M2 契约） */
export function serializeWithVersion(value: unknown, version: number): string {
  if (version > 0) {
    return serialize({ [VERSION_KEY]: version, state: value })
  }
  return serialize(value)
}

/** 解析持久化数据：返回 { version, state }（无版本标记 → version 0） */
export function parseVersioned(raw: string): { version: number; state: Record<string, unknown> } {
  const parsed = deserialize<{ [VERSION_KEY]?: number; state: Record<string, unknown> }>(raw)
  const version = typeof parsed[VERSION_KEY] === 'number' ? (parsed[VERSION_KEY] as number) : 0
  return { version, state: parsed.state ?? parsed }
}

/**
 * 执行迁移链（version → targetVersion）
 * @returns 迁移后的 state；迁移失败返回 null（丢弃旧数据走初始值）
 */
export function runMigrations(
  parsed: { version: number; state: Record<string, unknown> },
  targetVersion: number,
  migrations: Migration[] | undefined,
): { state: Record<string, unknown>; migratedFrom: number } | null {
  if (parsed.version === targetVersion) {
    return { state: parsed.state, migratedFrom: parsed.version }
  }
  if (parsed.version > targetVersion) {
    // 降级（数据比当前 schema 新）：丢弃（不猜测旧格式）
    return null
  }
  const chain = (migrations ?? [])
    .filter((m) => m.from >= parsed.version && m.to <= targetVersion)
    .sort((a, b) => a.from - b.from)
  let state = parsed.state
  try {
    for (const m of chain) {
      state = m.up(state)
    }
  } catch (err) {
    console.warn('[proteus] 状态迁移失败（丢弃旧数据走初始值）', err)
    return null
  }
  return { state, migratedFrom: parsed.version }
}

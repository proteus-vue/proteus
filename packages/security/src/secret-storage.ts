// packages/security/src/secret-storage.ts
// ★security-plan M1：SecretStorage 敏感字段加密存储（字段级加解密 + volatile 跳过 + redact + migrate）
// FieldDescriptor：{ value, volatile? } 内存 only / { value, encrypted? } 加密落盘 / 默认明文
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构

import type { Cipher } from './cipher'

/** 字段描述符（pinia M7.6 encrypted/volatile 标记的归一化形态） */
export type FieldDescriptor<T = unknown> =
  | { value: T; volatile?: false; encrypted?: boolean }
  | { value: T; volatile: true }

/** 平台存储抽象（web localStorage / MP wx 封装 / 内存） */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SecretStorageOptions {
  storage: StorageLike
  /** 字段描述符（编译期归一化结果；运行时校验） */
  fields: Record<string, FieldDescriptor>
  /** 加密器（null = 加密不可用 → 明文存储 + warn，文档标注降级） */
  cipher: Cipher | null
}

export interface SerializedRecord {
  /** 迁移/版本标记：加密态 v1 */
  __v?: number
  [field: string]: unknown
}

export class SecretStorage {
  private storage: StorageLike
  private fields: Record<string, FieldDescriptor>
  private cipher: Cipher | null

  constructor(options: SecretStorageOptions) {
    this.storage = options.storage
    this.fields = options.fields
    this.cipher = options.cipher
  }

  /** 字段校验（M1 运行时版）：volatile 与 encrypted 互斥 + volatile 不写盘 */
  private isVolatile(field: string): boolean {
    const d = this.fields[field]
    return Boolean(d && d.volatile === true)
  }

  private isEncrypted(field: string): boolean {
    const d = this.fields[field]
    return Boolean(d && d.volatile !== true && d.encrypted === true)
  }

  /** 递归检测 Function（M1 校验：JSON.stringify 对函数静默丢弃，需显式检测） */
  private static hasFunction(value: unknown): boolean {
    if (typeof value === 'function') return true
    if (value === null || typeof value !== 'object') return false
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (SecretStorage.hasFunction(value[i])) return true
      }
      return false
    }
    const keys = Object.keys(value)
    for (let i = 0; i < keys.length; i++) {
      if (SecretStorage.hasFunction((value as Record<string, unknown>)[keys[i]])) return true
    }
    return false
  }

  /**
   * 写入（字段级）：volatile 跳过 / encrypted 加密 / 其余明文
   * 值经 JSON.stringify 序列化（可序列化校验：Function/Class 实例 → JSON 失败即抛错）
   */
  async setItem(key: string, state: Record<string, unknown>): Promise<void> {
    const out: SerializedRecord = { __v: 1 }
    for (const field of Object.keys(state)) {
      if (this.isVolatile(field)) continue // 不写盘
      if (SecretStorage.hasFunction(state[field])) {
        throw new Error(`[proteus-security] 字段 ${field} 含 Function 值（禁止，M1 校验）`)
      }
      let serialized: string
      try {
        serialized = JSON.stringify(state[field])
      } catch {
        throw new Error(`[proteus-security] 字段 ${field} 不可序列化（禁止 Function/Class 实例，M1 校验）`)
      }
      if (this.isEncrypted(field)) {
        if (!this.cipher) {
          console.warn(`[proteus-security] 字段 ${field} 标记 encrypted 但无 cipher——明文存储降级（生产禁止）`)
          out[field] = { __enc: false, value: state[field] }
        } else {
          const ct = await this.cipher.encrypt(serialized)
          out[field] = { __enc: true, value: ct }
        }
      } else {
        out[field] = state[field]
      }
    }
    this.storage.setItem(key, JSON.stringify(out))
  }

  /** 读取：加密字段解密还原；返回 null = 无数据 */
  async getItem(key: string): Promise<Record<string, unknown> | null> {
    const raw = this.storage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SerializedRecord
    const out: Record<string, unknown> = {}
    for (const field of Object.keys(this.fields)) {
      if (this.isVolatile(field)) continue // 内存 only，不还原
      const v = parsed[field]
      if (v === undefined) continue
      if (this.isEncrypted(field) && typeof v === 'object' && v !== null) {
        const box = v as { __enc?: boolean; value?: string }
        if (box.__enc === true && this.cipher) {
          const plain = await this.cipher.decrypt(box.value ?? '')
          out[field] = JSON.parse(plain)
        } else {
          out[field] = box.value
        }
      } else {
        out[field] = v
      }
    }
    return out
  }

  /** 脱敏（M1 §5）：encrypted 字段 → '***'，明文/volatile 保留（对接 trace/快照导出） */
  redact(state: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const field of Object.keys(state)) {
      out[field] = this.isEncrypted(field) ? '***' : state[field]
    }
    return out
  }

  /**
   * 迁移（M1 §4）：旧明文数据（__v 缺失或字段为 {__enc:false}）→ 加密写回 + 删旧
   * 失败（key 不可用）→ 清除该 key，不崩溃（触发重新登录由调用方处理）
   */
  async migrate(key: string): Promise<{ migrated: boolean; reason?: string }> {
    const raw = this.storage.getItem(key)
    if (!raw) return { migrated: false }
    let parsed: SerializedRecord
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { migrated: false, reason: 'parse-fail' }
    }
    if (parsed.__v === 1) return { migrated: false } // 已是加密态
    if (!this.cipher) return { migrated: false, reason: 'no-cipher' }
    try {
      // 逐字段重写（encrypted 字段若为旧明文 → 加密）
      const state: Record<string, unknown> = {}
      for (const field of Object.keys(parsed)) {
        if (field === '__v') continue
        state[field] = parsed[field]
      }
      await this.setItem(key, state)
      this.storage.removeItem(key + '.legacy') // 旧数据清理占位（setItem 已覆盖写）
      return { migrated: true }
    } catch {
      this.storage.removeItem(key) // 迁移失败 → 清除，不崩溃
      return { migrated: false, reason: 'crypto-fail' }
    }
  }
}

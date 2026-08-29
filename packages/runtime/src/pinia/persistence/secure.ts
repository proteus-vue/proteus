// packages/runtime/src/pinia/persistence/secure.ts
// 字段级敏感标记（docs/proteus-pinia-plan M7.6）
//   · volatile: ['phone'] → 内存保留、不落盘（会话级字段，合规要求如手机号）
//   · encrypted: ['token'] → 写入加密、读取解密（默认轻量混淆；生产可注入平台安全存储）
// 序列化标记：{ "__proteus_type__": "Encrypted", "value": "..." }（与 M1 serialize 的 type tag 体系一致）
// ⚠ 安全声明：内置 encrypt/decrypt 为轻量混淆（防明文存储），非高安全——生产环境请注入
//   平台安全存储（web: crypto.subtle+IndexedDB / mp: 后端下发密钥 / app: Keychain），详见 docs/proteus-pinia-plan 10-m7
// ⚠ MP 产物安全：全文件无 ?? / ?. / 对象展开 / 数组解构
import { deserialize } from '@proteus/shared'

export interface SecureFields {
  /** 白名单：仅加密这些字段 */
  fields: string[]
  /** 自定义加密（默认轻量混淆；生产注入平台安全实现） */
  encrypt?: (plain: string) => string
  /** 自定义解密（与 encrypt 配对） */
  decrypt?: (cipher: string) => string
}

export interface SecureOptions {
  /** 不落盘字段（内存保留，hydrate/persist 均跳过） */
  volatile?: string[]
  /** 加密字段：字符串数组（默认加密）或 { fields, encrypt, decrypt } 自定义 */
  encrypted?: string[] | SecureFields
}

const ENC_TAG = 'Encrypted'

/** 默认轻量混淆（XOR + base64；非高安全，防明文存储） */
function defaultEncrypt(plain: string): string {
  const salt = 0x5a
  let out = ''
  for (let i = 0; i < plain.length; i++) {
    out += String.fromCharCode(plain.charCodeAt(i) ^ salt)
  }
  return btoa(out)
}
function defaultDecrypt(cipher: string): string {
  const salt = 0x5a
  let out = ''
  const raw = atob(cipher)
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(raw.charCodeAt(i) ^ salt)
  }
  return out
}

function resolveEncrypted(opt: SecureOptions | undefined): { fields: string[]; encrypt: (s: string) => string; decrypt: (s: string) => string } {
  if (!opt || !opt.encrypted) return { fields: [], encrypt: defaultEncrypt, decrypt: defaultDecrypt }
  if (Array.isArray(opt.encrypted)) {
    return { fields: opt.encrypted, encrypt: defaultEncrypt, decrypt: defaultDecrypt }
  }
  return {
    fields: opt.encrypted.fields,
    encrypt: opt.encrypted.encrypt ?? defaultEncrypt,
    decrypt: opt.encrypted.decrypt ?? defaultDecrypt,
  }
}

/** 持久化前：剔除 volatile 字段 + 加密 encrypted 字段 */
export function prepareForPersist(state: Record<string, unknown>, opt: SecureOptions | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const enc = resolveEncrypted(opt)
  const volatileSet = new Set(opt?.volatile ?? [])
  for (const [k, v] of Object.entries(state)) {
    if (volatileSet.has(k)) continue // volatile 不落盘
    if (enc.fields.indexOf(k) !== -1) {
      // 加密字段：标记 + 密文
      out[k] = { __proteus_type__: ENC_TAG, value: enc.encrypt(JSON.stringify(v)) }
    } else {
      out[k] = v
    }
  }
  return out
}

/** hydrate 前：剔除 volatile + 解密 encrypted 字段（序列化标记由 deserialize 的 reviver 先还原为普通对象） */
export function restoreFromPersist(state: Record<string, unknown>, opt: SecureOptions | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const enc = resolveEncrypted(opt)
  const volatileSet = new Set(opt?.volatile ?? [])
  for (const [k, v] of Object.entries(state)) {
    if (volatileSet.has(k)) continue // volatile 不恢复（保持初始值）
    if (enc.fields.indexOf(k) !== -1 && typeof v === 'object' && v !== null && (v as { __proteus_type__?: string }).__proteus_type__ === ENC_TAG) {
      // 解密（密文是 JSON 字符串，恢复原结构）
      out[k] = deserialize(enc.decrypt((v as { value: string }).value))
    } else {
      out[k] = v
    }
  }
  return out
}

/** 检查持久化结果中是否残留敏感明文（合规扫描工具，M7.6 验收） */
export function hasVolatileLeak(persisted: string, volatileFields: string[]): boolean {
  if (volatileFields.length === 0) return false
  const parsed = serializeSafeParse(persisted)
  if (!parsed) return false
  const flat: string[] = []
  const walk = (v: unknown, path: string): void => {
    if (v === null || v === undefined) return
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        walk(val, path ? `${path}.${k}` : k)
      }
    } else if (typeof v === 'string') {
      flat.push(`${path}=${v}`)
    }
  }
  walk(parsed, '')
  return volatileFields.some((f) => flat.some((entry) => entry.startsWith(`${f}=`)))
}

function serializeSafeParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

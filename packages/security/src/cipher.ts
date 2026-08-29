// packages/security/src/cipher.ts
// ★security-plan M1：可插拔 Cipher（加解密层）
// WebCipher：crypto.subtle AES-GCM + PBKDF2（原生零依赖）；DemoCipher：XOR 演示级降级（非生产，文档标注）
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构（共享模块 _proteus/security 进 MP）

export interface Cipher {
  encrypt(plain: string): Promise<string>
  decrypt(cipherText: string): Promise<string>
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16)
    out += h.length === 1 ? '0' + h : h
  }
  return out
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out as Uint8Array<ArrayBuffer>
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/** 探测 WebCrypto 可用性（浏览器 / Node 20+；MP 无 crypto.subtle → false） */
export function hasWebCrypto(): boolean {
  const g = globalThis as { crypto?: unknown }
  const c = g.crypto as { subtle?: unknown } | undefined
  return typeof c !== 'undefined' && typeof c.subtle !== 'undefined'
}

/**
 * WebCipher：AES-GCM + PBKDF2（passphrase 派生 key，随机 IV，输出 hex(iv):hex(ct)）
 * 密钥不硬编码：来自登录口令/用户输入（M1 关键约束）
 */
export async function createWebCipher(passphrase: string, salt = 'proteus-salt-v1'): Promise<Cipher> {
  const c = globalThis.crypto as Crypto
  const encoder = new TextEncoder()
  const keyMaterial = await c.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  const key = await c.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return {
    async encrypt(plain: string): Promise<string> {
      const iv = c.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>
      const ct = await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plain))
      return bytesToHex(iv) + ':' + bytesToHex(new Uint8Array(ct))
    },
    async decrypt(cipherText: string): Promise<string> {
      const parts = cipherText.split(':')
      if (parts.length !== 2) throw new Error('[proteus-security] 密文格式非法（缺 iv 分隔）')
      const iv = hexToBytes(parts[0])
      const ct = hexToBytes(parts[1])
      const pt = await c.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
      return new TextDecoder().decode(pt)
    },
  }
}

/**
 * DemoCipher：XOR + hex（演示级降级——非生产！无 WebCrypto 平台（小程序）的兜底，
 * 生产应接 App Keystore / 服务端加密（v0.6+）；key 派生简单哈希，勿存高价值数据）
 */
export function createDemoCipher(passphrase: string): Cipher {
  function keyBytes(): Uint8Array {
    const out = new Uint8Array(32)
    let h = 0
    for (let i = 0; i < passphrase.length; i++) h = (h * 31 + passphrase.charCodeAt(i)) % 1000000
    for (let i = 0; i < 32; i++) {
      h = (h * 1103515245 + 12345) % 2147483648
      out[i] = h % 256
    }
    return out
  }
  const key = keyBytes()
  return {
    async encrypt(plain: string): Promise<string> {
      const bytes = new TextEncoder().encode(plain)
      const out = new Uint8Array(bytes.length)
      for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % key.length]
      return bytesToHex(out)
    },
    async decrypt(cipherText: string): Promise<string> {
      const bytes = hexToBytes(cipherText)
      const out = new Uint8Array(bytes.length)
      for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % key.length]
      return new TextDecoder().decode(out)
    },
  }
}

/** 便捷：按环境选 Cipher（有 WebCrypto → WebCipher；否则 DemoCipher 并提示） */
export async function createCipher(passphrase: string): Promise<{ cipher: Cipher; mode: 'web' | 'demo' }> {
  if (hasWebCrypto()) {
    return { cipher: await createWebCipher(passphrase), mode: 'web' }
  }
  console.warn('[proteus-security] 当前环境无 WebCrypto（小程序），使用 DemoCipher 演示级加密——生产请接 Keystore/服务端加密（security-plan v2 §1）')
  return { cipher: createDemoCipher(passphrase), mode: 'demo' }
}
